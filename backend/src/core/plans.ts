import { getDb } from "./db.js";
import { withTrackingCode } from "./tracking.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";
import { paginate, type Page } from "./pagination.js";

// Document/DocType/DocStatus 체계와 완전히 별도로 관리되는 독립
// 엔티티(설계자 지시) - Claude가 작업 중 "이건 나중에 따로 계획을
// 잡아야 한다"고 판단한 항목을 모아두는 체크리스트. DocStatus는
// 프로젝트마다 커스터마이즈할 수 없는 6개 표준 코드로 고정돼 있어
// (docTypes.ts의 STANDARD_DOC_STATUSES) 이 기능이 원하는 상태 어휘를
// 표현할 수 없다 - 대신 Question처럼 자기만의 고정 상태 문자열을
// 갖는다. 전이 그래프는 강제하지 않고(칸반 카드가 컬럼을 자유
// 이동하는 것과 같은 원칙) 화이트리스트 검증만 한다.

export const PLAN_TYPE_CODE = "PN";

export const PLAN_STATUSES: { code: string; label: string }[] = [
  { code: "planned", label: "계획됨" },
  { code: "pending_approval", label: "승인대기" },
  { code: "in_review", label: "검토중" },
  { code: "scheduled", label: "예정" },
  { code: "completed", label: "완료" },
  { code: "rejected", label: "거부" },
];

const PLAN_STATUS_CODES = new Set(PLAN_STATUSES.map((s) => s.code));

function assertValidStatus(status: string): void {
  if (!PLAN_STATUS_CODES.has(status)) {
    throw new Error(`status는 ${PLAN_STATUSES.map((s) => s.code).join("/")} 중 하나여야 합니다: ${status}`);
  }
}

export interface PlanDetail {
  trackingCode: string;
  projectId: string;
  title: string;
  body: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  refs: string[];
  dependencies: string[];
}

interface PlanRow {
  trackingCode: string;
  projectId: string;
  title: string;
  body: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  refs: { trackingCode: string }[];
  dependencies: { dependsOn: { trackingCode: string } }[];
}

const PLAN_INCLUDE = { refs: true, dependencies: { include: { dependsOn: { select: { trackingCode: true } } } } } as const;

// 목록 기본 정렬 - "의존도(선행 조건 개수)가 가장 낮은 순"으로 고정한다
// (설계자 지시, #plan-list-dependency-sort) - 지금 바로 시작할 수
// 있는(선행 조건이 없거나 적은) 계획이 위로 오게. 개수가 같으면 예전
// 기본값이던 최근 수정순으로 묶는다(tie-break). 웹 UI(PlansView.vue)는
// 예전 그대로의 "최근 수정순"을 원해 `sort=updatedAt:desc`를 명시적으로
// 넘긴다 - CLI/MCP가 sort를 안 넘기면 이 새 기본값을 그대로 받는다.
export type PlanSortKey = "dependencyCount:asc" | "updatedAt:desc";
const DEFAULT_PLAN_SORT: PlanSortKey = "dependencyCount:asc";

function planOrderBy(sort: PlanSortKey) {
  if (sort === "updatedAt:desc") return [{ updatedAt: "desc" as const }];
  return [{ dependencies: { _count: "asc" as const } }, { updatedAt: "desc" as const }];
}

function toPlanDetail(row: PlanRow): PlanDetail {
  return {
    trackingCode: row.trackingCode,
    projectId: row.projectId,
    title: row.title,
    body: row.body,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    refs: row.refs.map((r) => r.trackingCode),
    dependencies: row.dependencies.map((d) => d.dependsOn.trackingCode),
  };
}

async function assertDocumentsExist(refTrackingCodes: string[]): Promise<void> {
  const db = getDb();
  for (const ref of refTrackingCodes) {
    const doc = await db.document.findUnique({ where: { trackingCode: ref } });
    if (!doc) throw new Error(`관련 문서를 찾을 수 없습니다: ${ref}`);
  }
}

/** 선행 조건으로 지정된 계획들이 실제로 존재하는지 확인하고, 그
 * id(planId)를 trackingCode와 함께 반환한다 - addPlanDependency/
 * createPlan이 공유. selfTrackingCode를 생략하면(createPlan 경로 -
 * 아직 트래킹 코드가 발급되기 전이라 자기 참조 자체가 불가능) 자기
 * 참조 검사를 건너뛴다. */
async function resolveDependencyPlanIds(
  dependsOnTrackingCodes: string[],
  selfTrackingCode?: string,
): Promise<{ trackingCode: string; id: string }[]> {
  const db = getDb();
  const resolved: { trackingCode: string; id: string }[] = [];
  for (const dep of dependsOnTrackingCodes) {
    if (selfTrackingCode !== undefined && dep === selfTrackingCode) {
      throw new Error("계획은 자기 자신을 선행 조건으로 가질 수 없습니다");
    }
    const plan = await db.plan.findUnique({ where: { trackingCode: dep } });
    if (!plan) throw new Error(`선행 조건 계획을 찾을 수 없습니다: ${dep}`);
    resolved.push({ trackingCode: dep, id: plan.id });
  }
  return resolved;
}

export async function createPlan(
  projectId: string,
  title: string,
  body: string,
  createdBy: string,
  refTrackingCodes?: string[],
  status?: string,
  dependsOnTrackingCodes?: string[],
): Promise<PlanDetail> {
  if (!title.trim()) throw new Error("제목이 필요합니다");
  // POST /api/projects/:projectId/plans는 라우트 단계에서 이미
  // body===undefined를 걸러주지만, bulkCreatePlans()처럼 요청 본문의
  // 배열 항목 하나하나가 타입 단언(as)만 거친 채 그대로 들어오는
  // 경로에선 이 가드가 없으면 Prisma의 원본 스택 트레이스가 그대로
  // 항목별 에러 메시지에 노출된다(실측 확인) - title과 동일한
  // 원칙으로 여기서도 방어한다.
  if (body === undefined || body === null) throw new Error("본문이 필요합니다");
  const initialStatus = status ?? "planned";
  assertValidStatus(initialStatus);
  const db = getDb();

  const refs = refTrackingCodes?.filter(Boolean) ?? [];
  await assertDocumentsExist(refs);

  const dependsOn = dependsOnTrackingCodes?.filter(Boolean) ?? [];
  const dependencyPlans = await resolveDependencyPlanIds(dependsOn);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await withTrackingCode<any>(projectId, PLAN_TYPE_CODE, "plan", (trackingCode) =>
    db.plan.create({
      data: { projectId, trackingCode, title, body, status: initialStatus, createdBy },
    }),
  );

  if (refs.length > 0) {
    await db.planDocumentRef.createMany({
      data: refs.map((trackingCode) => ({ planId: row.id, trackingCode })),
    });
  }
  if (dependencyPlans.length > 0) {
    await db.planDependency.createMany({
      data: dependencyPlans.map((d) => ({ planId: row.id, dependsOnPlanId: d.id })),
    });
  }

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "plan",
    action: "create",
    id: row.id,
    trackingCode: row.trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return toPlanDetail({
    ...row,
    refs: refs.map((trackingCode) => ({ trackingCode })),
    dependencies: dependencyPlans.map((d) => ({ dependsOn: { trackingCode: d.trackingCode } })),
  });
}

export async function getPlanByTrackingCode(trackingCode: string): Promise<PlanDetail | null> {
  const db = getDb();
  const row = await db.plan.findUnique({ where: { trackingCode }, include: PLAN_INCLUDE });
  return row ? toPlanDetail(row) : null;
}

export async function getPlanProjectId(trackingCode: string): Promise<string | null> {
  const db = getDb();
  const row = await db.plan.findUnique({ where: { trackingCode }, select: { projectId: true } });
  return row?.projectId ?? null;
}

export async function listPlansPaged(
  projectId: string,
  opts: { status?: string; q?: string; page: number; pageSize: number; sort?: PlanSortKey },
): Promise<Page<PlanDetail>> {
  const db = getDb();
  const q = opts.q?.trim();
  const where = {
    projectId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { body: { contains: q } }] } : {}),
  };
  const orderBy = planOrderBy(opts.sort ?? DEFAULT_PLAN_SORT);
  const result = await paginate<PlanRow>(
    (args) => db.plan.findMany({ where, include: PLAN_INCLUDE, orderBy, ...args }),
    () => db.plan.count({ where }),
    opts.page,
    opts.pageSize,
  );
  return { ...result, items: result.items.map(toPlanDetail) };
}

/** listPlansPaged와 달리 페이지 없이 조건에 맞는 계획 전체를 한 번에
 * 반환한다 - "계획을 하나의 파일로 bulk"(설계자 표현)할 때, 200건
 * 페이지 상한에 걸려 일부만 내보내지는 일이 없도록 별도 함수로 둔다
 * (listDocuments()가 비슷한 이유로 non-paged 버전을 따로 둔 것과
 * 같은 원칙 - 다만 계획은 프로젝트당 보통 소수라 1000건 상한 에러
 * 없이 그냥 전부 반환). */
export async function listAllPlans(
  projectId: string,
  opts: { status?: string; q?: string; sort?: PlanSortKey } = {},
): Promise<PlanDetail[]> {
  const db = getDb();
  const q = opts.q?.trim();
  const where = {
    projectId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { body: { contains: q } }] } : {}),
  };
  const rows = await db.plan.findMany({ where, include: PLAN_INCLUDE, orderBy: planOrderBy(opts.sort ?? DEFAULT_PLAN_SORT) });
  return rows.map(toPlanDetail);
}

export interface PlanImportItem {
  title: string;
  body: string;
  status?: string;
  refs?: string[];
  dependsOn?: string[];
}

export interface BulkPlanResult {
  ok: boolean;
  trackingCode?: string;
  error?: string;
}

/** bulkCreateRelations(codeRelations.ts)와 같은 패턴 - 새 검증 로직
 * 없이 기존 단건 createPlan()을 항목마다 그대로 반복 호출하고,
 * 항목별 성공/실패 결과 배열을 반환한다(부분 성공 허용). refs/
 * dependsOn은 createPlan과 마찬가지로 이미 존재하는 문서/계획의
 * trackingCode만 가리킬 수 있다 - 같은 배치 안의 다른 항목을
 * 가리키는 건 지원하지 않는다(그 항목의 trackingCode는 생성 전엔
 * 알 수 없음 - 필요하면 가져오기 이후 plan_depend/plan_link로
 * 2단계에 걸쳐 연결한다). */
export async function bulkCreatePlans(projectId: string, createdBy: string, items: PlanImportItem[]): Promise<BulkPlanResult[]> {
  return Promise.all(
    items.map(async (item): Promise<BulkPlanResult> => {
      try {
        const plan = await createPlan(projectId, item.title, item.body, createdBy, item.refs, item.status, item.dependsOn);
        return { ok: true, trackingCode: plan.trackingCode };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

export async function updatePlan(trackingCode: string, input: { title?: string; body?: string }): Promise<PlanDetail> {
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  if (input.title !== undefined && !input.title.trim()) throw new Error("제목이 필요합니다");
  const row = await db.plan.update({
    where: { trackingCode },
    data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}) },
    include: PLAN_INCLUDE,
  });
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "plan",
    action: "update",
    id: row.id,
    trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
  return toPlanDetail(row);
}

export async function setPlanStatus(trackingCode: string, status: string): Promise<PlanDetail> {
  assertValidStatus(status);
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  const row = await db.plan.update({ where: { trackingCode }, data: { status }, include: PLAN_INCLUDE });
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "plan",
    action: "update",
    id: row.id,
    trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
  return toPlanDetail(row);
}

export async function deletePlan(trackingCode: string): Promise<void> {
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  await db.plan.delete({ where: { trackingCode } });
  await realtimePublish(projectChangesTopic(existing.projectId), {
    entity: "plan",
    action: "delete",
    id: existing.id,
    trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);
}

export async function addPlanDocumentRef(trackingCode: string, docTrackingCode: string): Promise<PlanDetail> {
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  await assertDocumentsExist([docTrackingCode]);
  await db.planDocumentRef.upsert({
    where: { planId_trackingCode: { planId: existing.id, trackingCode: docTrackingCode } },
    create: { planId: existing.id, trackingCode: docTrackingCode },
    update: {},
  });
  const row = await db.plan.findUnique({ where: { trackingCode }, include: PLAN_INCLUDE });
  return toPlanDetail(row!);
}

export async function removePlanDocumentRef(trackingCode: string, docTrackingCode: string): Promise<PlanDetail> {
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  await db.planDocumentRef.deleteMany({ where: { planId: existing.id, trackingCode: docTrackingCode } });
  const row = await db.plan.findUnique({ where: { trackingCode }, include: PLAN_INCLUDE });
  return toPlanDetail(row!);
}

/** 선행 조건(의존성) 추가 - dependsOnTrackingCode 계획이 끝나야 이
 * 계획을 시작할 수 있다는 뜻. 자기 자신은 거부, 순환은 막지 않는다
 * (코드 관계도와 같은 원칙 - 실행 순서를 강제하는 그래프가 아니라
 * 참조 목록일 뿐이라 순회 시 안전 처리가 필요한 대상이 아님). */
export async function addPlanDependency(trackingCode: string, dependsOnTrackingCode: string): Promise<PlanDetail> {
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  const [dep] = await resolveDependencyPlanIds([dependsOnTrackingCode], trackingCode);
  await db.planDependency.upsert({
    where: { planId_dependsOnPlanId: { planId: existing.id, dependsOnPlanId: dep.id } },
    create: { planId: existing.id, dependsOnPlanId: dep.id },
    update: {},
  });
  const row = await db.plan.findUnique({ where: { trackingCode }, include: PLAN_INCLUDE });
  return toPlanDetail(row!);
}

export async function removePlanDependency(trackingCode: string, dependsOnTrackingCode: string): Promise<PlanDetail> {
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  const dependsOnPlan = await db.plan.findUnique({ where: { trackingCode: dependsOnTrackingCode } });
  if (dependsOnPlan) {
    await db.planDependency.deleteMany({ where: { planId: existing.id, dependsOnPlanId: dependsOnPlan.id } });
  }
  const row = await db.plan.findUnique({ where: { trackingCode }, include: PLAN_INCLUDE });
  return toPlanDetail(row!);
}
