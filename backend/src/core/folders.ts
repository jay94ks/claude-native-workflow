import { getDb } from "./db.js";
import { getMemberRole, roleSatisfies } from "./members.js";
import { resolveFolderWritePermission } from "./permissions.js";

// 문서 정리용 폴더 - 실제 git 파일 트리와 무관하게 DB 안에서만 존재하는
// 설계자의 관리 편의 기능이다. AI(CLI/MCP)는 이 개념 자체를 모른다(설계자
// 확인 - "인간이 편한 방식의 분류 체계를 AI가 알 필요가 없다") - 이 모듈은
// 웹 전용 라우트에서만 호출된다.

export interface FolderDetail {
  id: string;
  projectId: string;
  parentFolderId: string | null;
  name: string;
  createdBy: string;
}

async function assertCanWriteFolder(projectId: string, userId: string, parentFolderId: string | null): Promise<void> {
  const role = await getMemberRole(projectId, userId);
  if (!roleSatisfies(role, "editor")) {
    throw new Error("이 작업은 최소 editor 권한이 필요합니다");
  }
  if (parentFolderId) {
    const canWrite = await resolveFolderWritePermission(projectId, userId, parentFolderId);
    if (!canWrite) throw new Error("상위 폴더에 대한 쓰기 권한이 없습니다");
  }
}

async function assertNoSiblingWithName(projectId: string, parentFolderId: string | null, name: string, excludeId?: string): Promise<void> {
  const db = getDb();
  const sibling = await db.folder.findFirst({ where: { projectId, parentFolderId, name } });
  if (sibling && sibling.id !== excludeId) {
    throw new Error(`같은 위치에 이미 "${name}" 폴더가 있습니다`);
  }
}

export async function createFolder(projectId: string, name: string, parentFolderId: string | undefined, userId: string): Promise<FolderDetail> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("폴더 이름이 필요합니다");
  const parent = parentFolderId || null;
  await assertCanWriteFolder(projectId, userId, parent);
  if (parent) {
    const db = getDb();
    const parentRow = await db.folder.findUnique({ where: { id: parent } });
    if (!parentRow || parentRow.projectId !== projectId) throw new Error(`상위 폴더를 찾을 수 없습니다: ${parent}`);
  }
  await assertNoSiblingWithName(projectId, parent, trimmedName);
  const db = getDb();
  const row = await db.folder.create({ data: { projectId, parentFolderId: parent, name: trimmedName, createdBy: userId } });
  return { id: row.id, projectId: row.projectId, parentFolderId: row.parentFolderId, name: row.name, createdBy: row.createdBy };
}

export async function renameFolder(folderId: string, newName: string, userId: string): Promise<FolderDetail> {
  const trimmedName = newName.trim();
  if (!trimmedName) throw new Error("폴더 이름이 필요합니다");
  const db = getDb();
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) throw new Error(`폴더를 찾을 수 없습니다: ${folderId}`);
  const canWrite = await resolveFolderWritePermission(folder.projectId, userId, folderId);
  if (!canWrite) throw new Error("이 폴더에 대한 쓰기 권한이 없습니다");
  await assertNoSiblingWithName(folder.projectId, folder.parentFolderId, trimmedName, folderId);
  const row = await db.folder.update({ where: { id: folderId }, data: { name: trimmedName } });
  return { id: row.id, projectId: row.projectId, parentFolderId: row.parentFolderId, name: row.name, createdBy: row.createdBy };
}

export async function deleteFolder(folderId: string, userId: string): Promise<void> {
  const db = getDb();
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) throw new Error(`폴더를 찾을 수 없습니다: ${folderId}`);
  const canWrite = await resolveFolderWritePermission(folder.projectId, userId, folderId);
  if (!canWrite) throw new Error("이 폴더에 대한 쓰기 권한이 없습니다");
  const [childCount, docCount] = await Promise.all([
    db.folder.count({ where: { parentFolderId: folderId } }),
    db.document.count({ where: { folderId } }),
  ]);
  if (childCount > 0 || docCount > 0) {
    throw new Error("비어있지 않은 폴더는 삭제할 수 없습니다 - 먼저 하위 폴더/문서를 옮기거나 지우세요");
  }
  await db.folder.delete({ where: { id: folderId } });
}

export async function getFolderById(folderId: string): Promise<FolderDetail | null> {
  const db = getDb();
  const row = await db.folder.findUnique({ where: { id: folderId } });
  if (!row) return null;
  return { id: row.id, projectId: row.projectId, parentFolderId: row.parentFolderId, name: row.name, createdBy: row.createdBy };
}

export async function listFolders(projectId: string): Promise<FolderDetail[]> {
  const db = getDb();
  const rows = await db.folder.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return rows.map((r: FolderDetail) => ({
    id: r.id,
    projectId: r.projectId,
    parentFolderId: r.parentFolderId,
    name: r.name,
    createdBy: r.createdBy,
  }));
}

export interface FolderDocumentSummary {
  trackingCode: string;
  title: string;
  docTypeId: string;
}

export async function listFolderDocuments(folderId: string): Promise<FolderDocumentSummary[]> {
  const db = getDb();
  const rows = await db.document.findMany({ where: { folderId } });
  return rows.map((r: { trackingCode: string; title: string; docTypeId: string }) => ({
    trackingCode: r.trackingCode,
    title: r.title,
    docTypeId: r.docTypeId,
  }));
}

/** 문서 자신에 대한 write는 호출부(server.ts)가 이미 resolveEffectivePermission으로
 * 확인했다고 가정 - 여기선 "대상 폴더에 대한 쓰기 권한"만 추가로 확인한다. */
export async function moveDocumentToFolder(trackingCode: string, folderId: string | null, userId: string): Promise<void> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  if (folderId) {
    const folder = await db.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.projectId !== document.projectId) throw new Error(`폴더를 찾을 수 없습니다: ${folderId}`);
  }
  const canWrite = await resolveFolderWritePermission(document.projectId, userId, folderId);
  if (!canWrite) throw new Error("대상 폴더에 대한 쓰기 권한이 없습니다");
  await db.document.update({ where: { trackingCode }, data: { folderId } });
}
