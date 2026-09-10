import { getDb } from "./db.js";
import { getMemberRole } from "./members.js";

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
  folderId?: string;
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
 * 실수로 잠그는 사고 방지). folder 스코프는 이 체인과 별개로 독립
 * 취급(문서의 상위 스코프가 아니므로 - core/folders.ts가 직접 조회). */
export async function resolveEffectivePermission(
  projectId: string,
  userId: string,
  scope: { docTypeId?: string; documentId?: string },
): Promise<EffectivePermission> {
  const db = getDb();
  const role = await getMemberRole(projectId, userId);
  const base = roleDefault(role);
  if (role === "owner") {
    return { ...base, overridden: false, notice: null };
  }

  let effective = { ...base };
  let overridden = false;

  const common = await db.docAccessOverride.findFirst({
    where: { projectId, userId, docTypeId: null, documentId: null, folderId: null },
  });
  if (common) {
    effective = applyOverride(effective, common);
    overridden = true;
  }

  if (scope.docTypeId) {
    const docTypeOverride = await db.docAccessOverride.findFirst({
      where: { projectId, userId, docTypeId: scope.docTypeId, documentId: null, folderId: null },
    });
    if (docTypeOverride) {
      effective = applyOverride(effective, docTypeOverride);
      overridden = true;
    }
  }

  if (scope.documentId) {
    const documentOverride = await db.docAccessOverride.findFirst({
      where: { projectId, userId, documentId: scope.documentId, folderId: null },
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

/** 폴더 스코프 write 권한 - core/folders.ts가 "상위 폴더에 쓰기 권한이
 * 있는가"를 확인할 때 쓴다. 문서 체인과 완전히 독립(폴더는 문서의 상위
 * 스코프가 아니므로 project-common과 합성하지 않고 폴더 단위 오버라이드
 * 하나만 본다 - 없으면 프로젝트 기본 role의 write). */
export async function resolveFolderWritePermission(projectId: string, userId: string, folderId: string | null): Promise<boolean> {
  const db = getDb();
  const role = await getMemberRole(projectId, userId);
  const base = roleDefault(role).write;
  if (!folderId || role === "owner") return base;
  const override = await db.docAccessOverride.findFirst({
    where: { projectId, userId, folderId, docTypeId: null, documentId: null },
  });
  if (!override || override.canWrite === null) return base;
  return override.canWrite;
}

export interface SetAccessOverrideInput {
  canRead?: boolean;
  canWrite?: boolean;
  canDelete?: boolean;
}

/** scope 중 최대 하나만 채워짐(docTypeId/documentId/folderId), 셋 다
 * 없으면 "프로젝트 공통" 레벨 - null 스코프 유니크 문제(TemplateFile과
 * 같은 이유)로 DB 제약이 아니라 findFirst 후 update/create. */
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
    folderId: scope.folderId ?? null,
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
  folderId: string | null;
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
    folderId: r.folderId,
    canRead: r.canRead,
    canWrite: r.canWrite,
    canDelete: r.canDelete,
  }));
}
