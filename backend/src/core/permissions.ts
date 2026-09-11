import { getDb } from "./db.js";
import { getMemberRole, isProjectAllowedByActiveScope } from "./members.js";

export interface EffectivePermission {
  read: boolean;
  write: boolean;
  delete: boolean;
  overridden: boolean;
  notice: string | null;
}

export interface AccessScope {
  docTypeId?: string;
  documentId?: string;
}

function roleDefault(role: string | null): { read: boolean; write: boolean; delete: boolean } {
  if (role === "owner") return { read: true, write: true, delete: true };
  if (role === "editor") return { read: true, write: true, delete: false };
  if (role === "viewer") return { read: true, write: false, delete: false };
  return { read: false, write: false, delete: false };
}

function formatPermissionBanner(effective: { read: boolean; write: boolean; delete: boolean }): string {
  const yn = (b: boolean) => (b ? "가능" : "불가");
  return `이 문서에 대한 회원님의 권한 — 읽기: ${yn(effective.read)}, 쓰기: ${yn(effective.write)}, 삭제: ${yn(effective.delete)}(프로젝트 소유자가 설정)`;
}

/** 문서/문서타입/프로젝트 공통 3단계 오버라이드 체인(문서가 가장
 * 구체적) - owner 자신을 대상으로 한 오버라이드는 무시한다(자기 자신을
 * 실수로 잠그는 사고 방지). 폴더는 개인 소유 정리용 기능이라 이 권한
 * 체인과 무관 - core/folders.ts가 소유권(createdBy)만으로 직접 판단. */
export async function resolveEffectivePermission(
  projectId: string,
  userId: string,
  scope: { docTypeId?: string; documentId?: string },
): Promise<EffectivePermission> {
  // 방어적 이중 장치 - getMemberRole()도 스코프를 확인해 out-of-scope면
  // role을 null로 주지만, 그 경우에도 아래 오버라이드 조회는 멤버십과
  // 무관하게(비멤버에게도 걸 수 있는 설계) 돌아갈 수 있다. 스코프
  // 밖이면 오버라이드 조회 자체를 건너뛰어, "다른 프로젝트 전용" 키가
  // 그 프로젝트의 비멤버-오버라이드를 통해 접근하는 우회를 원천 차단.
  if (!(await isProjectAllowedByActiveScope(projectId))) {
    return { read: false, write: false, delete: false, overridden: false, notice: null };
  }
  const db = getDb();
  const role = await getMemberRole(projectId, userId);
  const base = roleDefault(role);
  if (role === "owner") {
    return { ...base, overridden: false, notice: null };
  }

  let effective = { ...base };
  let overridden = false;

  const common = await db.docAccessOverride.findFirst({
    where: { projectId, userId, docTypeId: null, documentId: null },
  });
  if (common) {
    effective = applyOverride(effective, common);
    overridden = true;
  }

  if (scope.docTypeId) {
    const docTypeOverride = await db.docAccessOverride.findFirst({
      where: { projectId, userId, docTypeId: scope.docTypeId, documentId: null },
    });
    if (docTypeOverride) {
      effective = applyOverride(effective, docTypeOverride);
      overridden = true;
    }
  }

  if (scope.documentId) {
    const documentOverride = await db.docAccessOverride.findFirst({
      where: { projectId, userId, documentId: scope.documentId },
    });
    if (documentOverride) {
      effective = applyOverride(effective, documentOverride);
      overridden = true;
    }
  }

  return { ...effective, overridden, notice: overridden ? formatPermissionBanner(effective) : null };
}

function applyOverride(
  current: { read: boolean; write: boolean; delete: boolean },
  override: { canRead: boolean | null; canWrite: boolean | null; canDelete: boolean | null },
): { read: boolean; write: boolean; delete: boolean } {
  return {
    read: override.canRead ?? current.read,
    write: override.canWrite ?? current.write,
    delete: override.canDelete ?? current.delete,
  };
}

export interface SetAccessOverrideInput {
  canRead?: boolean;
  canWrite?: boolean;
  canDelete?: boolean;
}

/** scope 중 최대 하나만 채워짐(docTypeId/documentId), 둘 다 없으면
 * "프로젝트 공통" 레벨 - null 스코프 유니크 문제(TemplateFile과 같은
 * 이유)로 DB 제약이 아니라 findFirst 후 update/create. */
export async function setAccessOverride(
  projectId: string,
  userId: string,
  scope: AccessScope,
  patch: SetAccessOverrideInput,
): Promise<void> {
  const db = getDb();
  const where = {
    projectId,
    userId,
    docTypeId: scope.docTypeId ?? null,
    documentId: scope.documentId ?? null,
  };
  const existing = await db.docAccessOverride.findFirst({ where });
  const data = {
    canRead: patch.canRead ?? existing?.canRead ?? null,
    canWrite: patch.canWrite ?? existing?.canWrite ?? null,
    canDelete: patch.canDelete ?? existing?.canDelete ?? null,
  };
  if (existing) {
    await db.docAccessOverride.update({ where: { id: existing.id }, data });
  } else {
    await db.docAccessOverride.create({ data: { ...where, ...data } });
  }
}

export interface AccessOverrideRow {
  id: string;
  userId: string;
  docTypeId: string | null;
  documentId: string | null;
  canRead: boolean | null;
  canWrite: boolean | null;
  canDelete: boolean | null;
}

export async function listAccessOverrides(projectId: string): Promise<AccessOverrideRow[]> {
  const db = getDb();
  const rows = await db.docAccessOverride.findMany({ where: { projectId } });
  return rows.map((r: AccessOverrideRow) => ({
    id: r.id,
    userId: r.userId,
    docTypeId: r.docTypeId,
    documentId: r.documentId,
    canRead: r.canRead,
    canWrite: r.canWrite,
    canDelete: r.canDelete,
  }));
}
