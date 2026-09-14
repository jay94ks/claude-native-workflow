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
  };
}

async function assertDocumentsExist(refTrackingCodes: string[]): Promise<void> {
  const db = getDb();
  for (const ref of refTrackingCodes) {
    const doc = await db.document.findUnique({ where: { trackingCode: ref } });
    if (!doc) throw new Error(`관련 문서를 찾을 수 없습니다: ${ref}`);
  }
}

export async function createPlan(
  projectId: string,
  title: string,
  body: string,
  createdBy: string,
  refTrackingCodes?: string[],
  status?: string,
): Promise<PlanDetail> {
  if (!title.trim()) throw new Error("제목이 필요합니다");
  const initialStatus = status ?? "planned";
  assertValidStatus(initialStatus);
  const db = getDb();

  const refs = refTrackingCodes?.filter(Boolean) ?? [];
  await assertDocumentsExist(refs);

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

  await realtimePublish(projectChangesTopic(projectId), {
    entity: "plan",
    action: "create",
    id: row.id,
    trackingCode: row.trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return toPlanDetail({ ...row, refs: refs.map((trackingCode) => ({ trackingCode })) });
}

export async function getPlanByTrackingCode(trackingCode: string): Promise<PlanDetail | null> {
  const db = getDb();
  const row = await db.plan.findUnique({ where: { trackingCode }, include: { refs: true } });
  return row ? toPlanDetail(row) : null;
}

export async function getPlanProjectId(trackingCode: string): Promise<string | null> {
  const db = getDb();
  const row = await db.plan.findUnique({ where: { trackingCode }, select: { projectId: true } });
  return row?.projectId ?? null;
}

export async function listPlansPaged(
  projectId: string,
  opts: { status?: string; q?: string; page: number; pageSize: number },
): Promise<Page<PlanDetail>> {
  const db = getDb();
  const q = opts.q?.trim();
  const where = {
    projectId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { body: { contains: q } }] } : {}),
  };
  const result = await paginate<PlanRow>(
    (args) => db.plan.findMany({ where, include: { refs: true }, orderBy: { updatedAt: "desc" }, ...args }),
    () => db.plan.count({ where }),
    opts.page,
    opts.pageSize,
  );
  return { ...result, items: result.items.map(toPlanDetail) };
}

export async function updatePlan(trackingCode: string, input: { title?: string; body?: string }): Promise<PlanDetail> {
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  if (input.title !== undefined && !input.title.trim()) throw new Error("제목이 필요합니다");
  const row = await db.plan.update({
    where: { trackingCode },
    data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}) },
    include: { refs: true },
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
  const row = await db.plan.update({ where: { trackingCode }, data: { status }, include: { refs: true } });
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
  const row = await db.plan.findUnique({ where: { trackingCode }, include: { refs: true } });
  return toPlanDetail(row!);
}

export async function removePlanDocumentRef(trackingCode: string, docTrackingCode: string): Promise<PlanDetail> {
  const db = getDb();
  const existing = await db.plan.findUnique({ where: { trackingCode } });
  if (!existing) throw new Error(`계획을 찾을 수 없습니다: ${trackingCode}`);
  await db.planDocumentRef.deleteMany({ where: { planId: existing.id, trackingCode: docTrackingCode } });
  const row = await db.plan.findUnique({ where: { trackingCode }, include: { refs: true } });
  return toPlanDetail(row!);
}
