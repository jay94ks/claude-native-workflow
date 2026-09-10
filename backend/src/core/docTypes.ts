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
}

export interface DocStatus {
  id: string;
  code: string;
  label: string;
  isTerminal: boolean;
}

export interface DocStatusTransition {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  label: string | null;
}

export interface ScopeInput {
  institutionId?: string;
  projectGroupId?: string;
  projectId?: string;
}

function assertExactlyOneScope(scope: ScopeInput): void {
  const set = [scope.institutionId, scope.projectGroupId, scope.projectId].filter(Boolean);
  if (set.length !== 1) {
    throw new Error("institutionId/projectGroupId/projectId 중 정확히 하나만 지정해야 합니다");
  }
}

export async function createDocType(scope: ScopeInput, code: string, label: string): Promise<DocType> {
  assertExactlyOneScope(scope);
  if (!/^[A-Za-z]{2}$/.test(code)) {
    throw new Error(`타입 코드는 영문 2글자여야 합니다: ${code}`);
  }
  const db = getDb();
  const row = await db.docType.create({
    data: {
      institutionId: scope.institutionId ?? null,
      projectGroupId: scope.projectGroupId ?? null,
      projectId: scope.projectId ?? null,
      code: code.toUpperCase(),
      label,
    },
  });
  return { id: row.id, code: row.code, label: row.label };
}

export async function addDocStatus(
  docTypeId: string,
  code: string,
  label: string,
  isTerminal = false,
): Promise<DocStatus> {
  const db = getDb();
  const row = await db.docStatus.create({ data: { docTypeId, code, label, isTerminal } });
  return { id: row.id, code: row.code, label: row.label, isTerminal: row.isTerminal };
}

export async function addDocStatusTransition(
  docTypeId: string,
  fromStatusId: string,
  toStatusId: string,
  label?: string,
): Promise<DocStatusTransition> {
  const db = getDb();
  const row = await db.docStatusTransition.create({
    data: { docTypeId, fromStatusId, toStatusId, label: label ?? null },
  });
  return { id: row.id, fromStatusId: row.fromStatusId, toStatusId: row.toStatusId, label: row.label };
}

export async function listDocTypes(scope: ScopeInput): Promise<DocType[]> {
  const db = getDb();
  const rows = await db.docType.findMany({
    where: {
      institutionId: scope.institutionId ?? undefined,
      projectGroupId: scope.projectGroupId ?? undefined,
      projectId: scope.projectId ?? undefined,
    },
  });
  return rows.map((r: DocType) => ({ id: r.id, code: r.code, label: r.label }));
}

export async function listDocStatuses(docTypeId: string): Promise<DocStatus[]> {
  const db = getDb();
  const rows = await db.docStatus.findMany({ where: { docTypeId } });
  return rows.map((r: DocStatus) => ({ id: r.id, code: r.code, label: r.label, isTerminal: r.isTerminal }));
}

export async function findDocTypeByCode(projectId: string, code: string): Promise<DocType | null> {
  const db = getDb();
  const row = await db.docType.findFirst({ where: { projectId, code: code.toUpperCase() } });
  if (!row) return null;
  return { id: row.id, code: row.code, label: row.label };
}

export async function findDocStatusByCode(docTypeId: string, code: string): Promise<DocStatus | null> {
  const db = getDb();
  const row = await db.docStatus.findUnique({ where: { docTypeId_code: { docTypeId, code } } });
  if (!row) return null;
  return { id: row.id, code: row.code, label: row.label, isTerminal: row.isTerminal };
}

/** API/CLI가 소유권(어느 프로젝트 소속인지) 확인할 때 쓴다 - DocType은
 * institutionId/projectGroupId/projectId 중 하나만 채워지는 스코프라
 * projectId가 null일 수도 있다(기관/그룹 단위 타입). */
export async function getDocTypeById(docTypeId: string): Promise<(DocType & { projectId: string | null }) | null> {
  const db = getDb();
  const row = await db.docType.findUnique({ where: { id: docTypeId } });
  if (!row) return null;
  return { id: row.id, code: row.code, label: row.label, projectId: row.projectId };
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

// ---------------------------------------------------------------- 기본값 시딩

interface SeedSpec {
  code: string;
  label: string;
  statuses: { code: string; label: string; isTerminal?: boolean }[];
  transitions: [string, string][]; // [fromCode, toCode]
}

const DEFAULT_TYPES: SeedSpec[] = [
  {
    code: "SP",
    label: "설계 명세",
    statuses: [
      { code: "draft", label: "초안" },
      { code: "active", label: "적용 중" },
      { code: "archived", label: "보관", isTerminal: true },
    ],
    transitions: [
      ["draft", "active"],
      ["active", "archived"],
    ],
  },
  {
    code: "DC",
    label: "결정 요청",
    statuses: [
      { code: "open", label: "미답변" },
      { code: "answered", label: "답변됨" },
      { code: "applied", label: "반영 완료", isTerminal: true },
    ],
    transitions: [
      ["open", "answered"],
      ["answered", "applied"],
    ],
  },
  {
    code: "DN",
    label: "결과 보고",
    statuses: [{ code: "final", label: "완료", isTerminal: true }],
    transitions: [],
  },
];

/** createProject() 직후 호출 - 새 프로젝트가 타입 체계 없이 시작하지
 * 않도록 기본 타입 몇 개를 그 프로젝트 스코프로 심어준다. 관리자는
 * 이후 자유롭게 추가/수정 가능(하드코딩 아님, 그냥 첫 데이터). */
export async function seedDefaultDocTypes(projectId: string): Promise<void> {
  for (const spec of DEFAULT_TYPES) {
    const docType = await createDocType({ projectId }, spec.code, spec.label);
    const statusIdByCode = new Map<string, string>();
    for (const s of spec.statuses) {
      const status = await addDocStatus(docType.id, s.code, s.label, s.isTerminal ?? false);
      statusIdByCode.set(s.code, status.id);
    }
    for (const [fromCode, toCode] of spec.transitions) {
      const fromId = statusIdByCode.get(fromCode);
      const toId = statusIdByCode.get(toCode);
      if (!fromId || !toId) continue;
      await addDocStatusTransition(docType.id, fromId, toId);
    }
  }
}
