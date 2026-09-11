import { getDb } from "./db.js";

// 옛 concept 브랜치는 SP/PL/DC/RV/FX 같은 타입 분류가 코드에 하드코딩돼
// 있었다("분류 코드가 수동적이고 단순하다"는 설계자 지적) - v2는 타입/
// 상태/전이 전부 DB 레코드라 설치 후 관리자가 자유롭게 새 타입을
// 정의하거나 기존 타입의 상태 흐름을 바꿀 수 있다. 여기 있는 건 그
// 시스템을 구현하는 core 함수와, 새 프로젝트가 빈 손으로 시작하지
// 않도록 심어주는 기본값 몇 가지뿐 - 하드코딩된 분기 로직이 아니라
// "기본값으로 심어진 레코드"라는 점이 핵심.

export interface DocType {
  id: string;
  code: string;
  label: string;
  guideline: string | null;
}

export interface DocStatus {
  id: string;
  code: string;
  label: string;
  guideline: string | null;
  isTerminal: boolean;
}

// 문서 "상태"는 DocType과 달리 관리자가 자유롭게 정의하는 대상이
// 아니다(설계자 확인 - "타입 분류 체계를 관리자가 자유롭게 정의"는
// DocType에 대한 원칙이지 상태에는 적용되지 않음) - 시스템 전역에서
// 고정된 의미를 갖는 6개 표준 코드만 허용한다. archived는 폐기가
// 아니라 보관, deprecated는 프로젝트 내에서 더 이상 인용되지 않는다는
// 뜻일 뿐 상황에 따라 다른 상태로 되돌릴 수 있다(다만 draft로는 어떤
// 상태에서도 되돌아갈 수 없다 - addDocStatusTransition[ByCode]에서
// 강제).
export const STANDARD_DOC_STATUSES: { code: string; label: string; guideline: string; isTerminal: boolean }[] = [
  { code: "draft", label: "초안", guideline: "아직 작업 중인 단계 - 검토 전 자유롭게 고칠 수 있다.", isTerminal: false },
  { code: "review", label: "검토 중", guideline: "다른 설계자나 AI의 확인을 기다리는 단계.", isTerminal: false },
  { code: "pending", label: "보류", guideline: "추가 결정이나 외부 조건을 기다리며 잠시 멈춘 단계.", isTerminal: false },
  { code: "approved", label: "승인됨", guideline: "확정되어 적용 중인 최종 버전.", isTerminal: false },
  {
    code: "deprecated",
    label: "더 이상 인용되지 않음",
    guideline: "폐기가 아니라, 프로젝트 안에서 더 이상 참고·인용 대상이 아니라는 뜻 - 상황에 따라 다시 다른 상태로 되돌릴 수 있다.",
    isTerminal: false,
  },
  { code: "archived", label: "보관됨", guideline: "폐기가 아니라 보관 - 더 이상 활성 작업 대상은 아니지만 기록으로 남긴다.", isTerminal: true },
];

function findStandardStatus(code: string): (typeof STANDARD_DOC_STATUSES)[number] | undefined {
  return STANDARD_DOC_STATUSES.find((s) => s.code === code.toLowerCase());
}

export interface DocStatusTransition {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  label: string | null;
}

export async function createDocType(projectId: string, code: string, label: string, guideline?: string): Promise<DocType> {
  if (!/^[A-Za-z]{2}$/.test(code)) {
    throw new Error(`타입 코드는 영문 2글자여야 합니다: ${code}`);
  }
  const db = getDb();
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`);
  const row = await db.docType.create({
    data: {
      projectId,
      code: code.toUpperCase(),
      label,
      guideline: guideline?.trim() || null,
    },
  });
  return { id: row.id, code: row.code, label: row.label, guideline: row.guideline };
}

/** DocType 생성 후 지침을 새로 쓰거나 수정한다 - 빈 문자열은 "지침
 * 지우기"로 취급(null 정규화, createDocType과 같은 관례). */
export async function setDocTypeGuideline(docTypeId: string, guideline: string): Promise<DocType> {
  const db = getDb();
  const row = await db.docType.update({
    where: { id: docTypeId },
    data: { guideline: guideline.trim() || null },
  });
  return { id: row.id, code: row.code, label: row.label, guideline: row.guideline };
}

/** code는 STANDARD_DOC_STATUSES 6개 중 하나여야 한다(대소문자 무관) -
 * 라벨/지침/종료 여부는 입력받지 않고 항상 표준값으로 고정된다("특수
 * 상태 코드는 정해져 있다" - 설계자 확인). */
export async function addDocStatus(docTypeId: string, code: string): Promise<DocStatus> {
  const std = findStandardStatus(code);
  if (!std) {
    throw new Error(
      `상태 코드는 draft/review/pending/approved/deprecated/archived 중 하나여야 합니다: ${code}`,
    );
  }
  const db = getDb();
  const row = await db.docStatus.create({
    data: { docTypeId, code: std.code, label: std.label, guideline: std.guideline, isTerminal: std.isTerminal },
  });
  return { id: row.id, code: row.code, label: row.label, guideline: row.guideline, isTerminal: row.isTerminal };
}

export async function addDocStatusTransition(
  docTypeId: string,
  fromStatusId: string,
  toStatusId: string,
  label?: string,
): Promise<DocStatusTransition> {
  const db = getDb();
  const to = await db.docStatus.findUnique({ where: { id: toStatusId } });
  if (to?.code === "draft") {
    throw new Error("draft 상태로는 어떤 상태에서도 되돌아갈 수 없습니다");
  }
  const row = await db.docStatusTransition.create({
    data: { docTypeId, fromStatusId, toStatusId, label: label ?? null },
  });
  return { id: row.id, fromStatusId: row.fromStatusId, toStatusId: row.toStatusId, label: row.label };
}

export async function listDocTypes(projectId: string): Promise<DocType[]> {
  const db = getDb();
  const rows = await db.docType.findMany({ where: { projectId } });
  return rows.map((r: DocType) => ({ id: r.id, code: r.code, label: r.label, guideline: r.guideline }));
}

export async function listDocStatuses(docTypeId: string): Promise<DocStatus[]> {
  const db = getDb();
  const rows = await db.docStatus.findMany({ where: { docTypeId } });
  return rows.map((r: DocStatus) => ({ id: r.id, code: r.code, label: r.label, guideline: r.guideline, isTerminal: r.isTerminal }));
}

/** 문서 타입은 이제 항상 그 프로젝트 자신에게만 정의된다(팀/그룹
 * 단위로 획일화해 정하는 기능은 없음 - 설계자 확인). */
export async function findDocTypeByCode(projectId: string, code: string): Promise<DocType | null> {
  const db = getDb();
  const row = await db.docType.findFirst({ where: { projectId, code: code.toUpperCase() } });
  if (!row) return null;
  return { id: row.id, code: row.code, label: row.label, guideline: row.guideline };
}

export async function findDocStatusByCode(docTypeId: string, code: string): Promise<DocStatus | null> {
  const db = getDb();
  const row = await db.docStatus.findUnique({ where: { docTypeId_code: { docTypeId, code } } });
  if (!row) return null;
  return { id: row.id, code: row.code, label: row.label, guideline: row.guideline, isTerminal: row.isTerminal };
}

/** API/CLI가 소유권(어느 프로젝트 소속인지) 확인할 때 쓴다. */
export async function getDocTypeById(docTypeId: string): Promise<(DocType & { projectId: string }) | null> {
  const db = getDb();
  const row = await db.docType.findUnique({ where: { id: docTypeId } });
  if (!row) return null;
  return { id: row.id, code: row.code, label: row.label, guideline: row.guideline, projectId: row.projectId };
}

/** addDocStatusTransition()은 id 기반(seedDefaultDocTypes 내부용) -
 * API/CLI는 다른 곳(`docs transition <trackingCode> <toStatusCode>`
 * 등)과 마찬가지로 상태 코드로 다뤄야 하므로 이 래퍼를 통한다. */
export async function addDocStatusTransitionByCode(
  docTypeId: string,
  fromCode: string,
  toCode: string,
  label?: string,
): Promise<DocStatusTransition> {
  const from = await findDocStatusByCode(docTypeId, fromCode);
  if (!from) throw new Error(`"${fromCode}" 상태가 이 타입에 정의돼 있지 않습니다`);
  const to = await findDocStatusByCode(docTypeId, toCode);
  if (!to) throw new Error(`"${toCode}" 상태가 이 타입에 정의돼 있지 않습니다`);
  return addDocStatusTransition(docTypeId, from.id, to.id, label);
}

export async function listDocStatusTransitions(docTypeId: string): Promise<DocStatusTransition[]> {
  const db = getDb();
  const rows = await db.docStatusTransition.findMany({ where: { docTypeId } });
  return rows.map((r: DocStatusTransition) => ({
    id: r.id,
    fromStatusId: r.fromStatusId,
    toStatusId: r.toStatusId,
    label: r.label,
  }));
}

/** 그 상태에서 실제로 갈 수 있는 다음 상태 id 목록(DocStatusTransition
 * 기준) - "터미널 상태가 아니면 무조건 다음 상태로" 같은 임의 규칙이
 * 아니라, 정의된 전이만 허용한다. */
export async function allowedNextStatuses(docTypeId: string, fromStatusId: string): Promise<DocStatus[]> {
  const db = getDb();
  const transitions = await db.docStatusTransition.findMany({
    where: { docTypeId, fromStatusId },
    include: { toStatus: true },
  });
  return transitions.map((t: { toStatus: DocStatus }) => t.toStatus);
}

/** 새 문서를 만들 때 쓸 "시작 상태" - 어떤 전이의 도착점(toStatusId)도
 * 아닌 상태를 찾는다(전이 그래프상 진입점). 여러 개거나 하나도 없으면
 * (전이가 아예 없는 단일 상태 타입 등) 첫 번째로 조회된 상태로 폴백. */
export async function initialStatusFor(docTypeId: string): Promise<DocStatus> {
  const db = getDb();
  const statuses = await listDocStatuses(docTypeId);
  if (statuses.length === 0) {
    throw new Error(`docType(${docTypeId})에 정의된 상태가 없습니다`);
  }
  const transitions = await db.docStatusTransition.findMany({ where: { docTypeId } });
  const targets = new Set(transitions.map((t: { toStatusId: string }) => t.toStatusId));
  const entryPoints = statuses.filter((s) => !targets.has(s.id));
  return entryPoints[0] ?? statuses[0];
}

/** 표준 6개 상태를 전부 추가하고, draft를 도착지로 하는 것만 제외한
 * 모든 순서쌍(25개)으로 전이를 완전 연결한다 - 관리자가 하나씩 안
 * 그어도 문서 편집기가 항상 유연하게 다음 상태를 고를 수 있다. 이미
 * 있는 상태/전이는 건너뛴다(재호출해도 안전). */
export async function seedStandardStatusFlow(docTypeId: string): Promise<void> {
  const existing = await listDocStatuses(docTypeId);
  const existingCodes = new Set(existing.map((s) => s.code));
  const statusIdByCode = new Map<string, string>(existing.map((s) => [s.code, s.id]));
  for (const std of STANDARD_DOC_STATUSES) {
    if (existingCodes.has(std.code)) continue;
    const status = await addDocStatus(docTypeId, std.code);
    statusIdByCode.set(std.code, status.id);
  }
  const existingTransitions = await listDocStatusTransitions(docTypeId);
  const existingPairs = new Set(existingTransitions.map((t) => `${t.fromStatusId}->${t.toStatusId}`));
  for (const from of STANDARD_DOC_STATUSES) {
    for (const to of STANDARD_DOC_STATUSES) {
      if (from.code === to.code || to.code === "draft") continue;
      const fromId = statusIdByCode.get(from.code);
      const toId = statusIdByCode.get(to.code);
      if (!fromId || !toId || existingPairs.has(`${fromId}->${toId}`)) continue;
      await addDocStatusTransition(docTypeId, fromId, toId);
    }
  }
}

// ---------------------------------------------------------------- 기본값 시딩

interface SeedSpec {
  code: string;
  label: string;
  guideline: string;
}

// 6개 기본 DocType 전부 표준 상태 어휘(draft/review/pending/approved/
// deprecated/archived)를 동일하게 쓴다("일반화되어야 한다" - 설계자
// 확인, 유형마다 제각각이던 흐름을 하나로 통일) - 타입 간 차이는 코드/
// 라벨/지침(분류 자체)에만 남는다.
const DEFAULT_TYPES: SeedSpec[] = [
  { code: "SP", label: "설계 명세", guideline: "지금 만들고 있는 것이 무엇인지, 어떻게 동작해야 하는지 명세한다." },
  { code: "DC", label: "결정 요구사항 및 요청", guideline: "설계자의 확인/선택이 필요한 사항을 등록한다 - 답변되면 반영 완료까지 추적한다." },
  { code: "PL", label: "실행 계획", guideline: "무엇을, 어떤 순서로 할지 계획을 기록한다." },
  { code: "PD", label: "실행 결과 보고", guideline: "작업을 마친 뒤 무엇을 했는지, 어떻게 검증했는지 요약해 남긴다." },
  { code: "RM", label: "지시 사항/지침", guideline: "설계자가 내린 지시나 지켜야 할 지침을 기록한다 - 필요 없어지면 보관 처리한다." },
  { code: "DS", label: "설계 결정", guideline: "설계 결정과 그 근거를 기록한다 - 왜 이렇게 만들기로 했는지 나중에 되짚어볼 수 있도록." },
];

/** createProject() 직후 호출 - 새 프로젝트가 타입 체계 없이 시작하지
 * 않도록 기본 타입 몇 개를 그 프로젝트 스코프로 심어준다. 관리자는
 * 이후 자유롭게 추가/수정 가능(하드코딩 아님, 그냥 첫 데이터). */
export async function seedDefaultDocTypes(projectId: string): Promise<void> {
  for (const spec of DEFAULT_TYPES) {
    const docType = await createDocType(projectId, spec.code, spec.label, spec.guideline);
    await seedStandardStatusFlow(docType.id);
  }
}
