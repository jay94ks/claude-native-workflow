import { getDb } from "./db.js";
import { getMemberRole } from "./members.js";
import { isSuperAdmin } from "./auth.js";

// 문서 정리용 폴더 - 실제 git 파일 트리와 무관하게 DB 안에서만 존재하는
// 설계자 개인 소유의 정리 편의 기능이다. 폴더는 만든 설계자 한 명의
// 것이고(createdBy가 곧 소유자), 다른 설계자는 그 존재 자체를 조회하지
// 못한다 - 프로젝트 공통 리소스가 아니므로 소유자 확인만으로 쓰기 권한이
// 결정된다(resolveFolderWritePermission/DocAccessOverride.folderId 축은
// 폐기됨). AI(CLI/MCP)는 이 개념 자체를 모른다 - 이 모듈은 웹 전용
// 라우트에서만 호출된다.

export interface FolderDetail {
  id: string;
  projectId: string;
  parentFolderId: string | null;
  name: string;
  order: number;
  createdBy: string;
}

async function assertIsProjectMember(projectId: string, userId: string): Promise<void> {
  const role = await getMemberRole(projectId, userId);
  if (!role) throw new Error("이 프로젝트의 멤버만 폴더를 관리할 수 있습니다");
}

async function assertOwnsFolder(folderId: string, userId: string): Promise<{ id: string; projectId: string; parentFolderId: string | null; name: string; order: number; createdBy: string }> {
  const db = getDb();
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) throw new Error(`폴더를 찾을 수 없습니다: ${folderId}`);
  if (folder.createdBy !== userId && !(await isSuperAdmin(userId))) {
    throw new Error("본인이 만든 폴더만 관리할 수 있습니다");
  }
  return folder;
}

async function assertNoSiblingWithName(
  projectId: string,
  userId: string,
  parentFolderId: string | null,
  name: string,
  excludeId?: string,
): Promise<void> {
  const db = getDb();
  const sibling = await db.folder.findFirst({ where: { projectId, createdBy: userId, parentFolderId, name } });
  if (sibling && sibling.id !== excludeId) {
    throw new Error(`같은 위치에 이미 "${name}" 폴더가 있습니다`);
  }
}

export async function createFolder(
  projectId: string,
  name: string,
  parentFolderId: string | undefined,
  userId: string,
): Promise<FolderDetail> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("폴더 이름이 필요합니다");
  await assertIsProjectMember(projectId, userId);
  const parent = parentFolderId || null;
  const db = getDb();
  if (parent) {
    // 다른 설계자의 폴더 밑에는 못 만든다 - 폴더 트리는 항상 자기
    // 자신의 것으로만 이어진다.
    await assertOwnsFolder(parent, userId);
    const parentRow = await db.folder.findUnique({ where: { id: parent } });
    if (!parentRow || parentRow.projectId !== projectId) throw new Error(`상위 폴더를 찾을 수 없습니다: ${parent}`);
  }
  await assertNoSiblingWithName(projectId, userId, parent, trimmedName);
  const siblingCount = await db.folder.count({ where: { projectId, createdBy: userId, parentFolderId: parent } });
  const row = await db.folder.create({
    data: { projectId, parentFolderId: parent, name: trimmedName, order: siblingCount, createdBy: userId },
  });
  return { id: row.id, projectId: row.projectId, parentFolderId: row.parentFolderId, name: row.name, order: row.order, createdBy: row.createdBy };
}

export async function renameFolder(folderId: string, newName: string, userId: string): Promise<FolderDetail> {
  const trimmedName = newName.trim();
  if (!trimmedName) throw new Error("폴더 이름이 필요합니다");
  const folder = await assertOwnsFolder(folderId, userId);
  await assertNoSiblingWithName(folder.projectId, userId, folder.parentFolderId, trimmedName, folderId);
  const db = getDb();
  const row = await db.folder.update({ where: { id: folderId }, data: { name: trimmedName } });
  return { id: row.id, projectId: row.projectId, parentFolderId: row.parentFolderId, name: row.name, order: row.order, createdBy: row.createdBy };
}

export async function deleteFolder(folderId: string, userId: string): Promise<void> {
  await assertOwnsFolder(folderId, userId);
  const db = getDb();
  const [childCount, entryCount] = await Promise.all([
    db.folder.count({ where: { parentFolderId: folderId } }),
    db.documentFolderEntry.count({ where: { folderId } }),
  ]);
  if (childCount > 0 || entryCount > 0) {
    throw new Error("비어있지 않은 폴더는 삭제할 수 없습니다 - 먼저 하위 폴더/문서를 옮기거나 지우세요");
  }
  await db.folder.delete({ where: { id: folderId } });
}

/** 인접한 형제(같은 부모+소유자)와 order 값을 맞바꾼다 - 맨 위/맨
 * 아래에서 더 이상 움직일 수 없으면 조용히 아무 일도 안 한다(에러
 * 아님). */
export async function reorderFolder(folderId: string, direction: "up" | "down", userId: string): Promise<void> {
  const folder = await assertOwnsFolder(folderId, userId);
  const db = getDb();
  const siblings = await db.folder.findMany({
    where: { projectId: folder.projectId, createdBy: userId, parentFolderId: folder.parentFolderId },
    orderBy: { order: "asc" },
  });
  const idx = siblings.findIndex((s: { id: string }) => s.id === folderId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;
  const other = siblings[idx];
  const target = siblings[swapIdx];
  await db.$transaction([
    db.folder.update({ where: { id: other.id }, data: { order: target.order } }),
    db.folder.update({ where: { id: target.id }, data: { order: other.order } }),
  ]);
}

/** 호출자 자신이 만든 폴더만 반환한다 - 다른 설계자의 폴더는 존재
 * 자체가 이 목록에 안 걸린다(개인 소유 원칙). */
export async function listFolders(projectId: string, userId: string): Promise<FolderDetail[]> {
  const db = getDb();
  const rows = await db.folder.findMany({ where: { projectId, createdBy: userId }, orderBy: { order: "asc" } });
  return rows.map((r: FolderDetail) => ({
    id: r.id,
    projectId: r.projectId,
    parentFolderId: r.parentFolderId,
    name: r.name,
    order: r.order,
    createdBy: r.createdBy,
  }));
}

export interface FolderDocumentSummary {
  trackingCode: string;
  title: string;
  docTypeId: string;
}

export async function listFolderDocuments(folderId: string, userId: string): Promise<FolderDocumentSummary[]> {
  await assertOwnsFolder(folderId, userId);
  const db = getDb();
  const entries = await db.documentFolderEntry.findMany({ where: { folderId }, include: { document: true } });
  return entries.map((e: { document: { trackingCode: string; title: string; docTypeId: string } }) => ({
    trackingCode: e.document.trackingCode,
    title: e.document.title,
    docTypeId: e.document.docTypeId,
  }));
}

/** 문서 자신에 대한 읽기 권한은 호출부(server.ts)가 이미
 * resolveEffectivePermission으로 확인했다고 가정한다 - 개인 폴더 배치는
 * 문서 내용을 바꾸지 않으므로 그 이상의 권한(write)은 요구하지 않는다.
 * folderId가 null이면 "미분류로 되돌림"(그 설계자의 배치 행을 삭제). */
export async function moveDocumentToFolder(trackingCode: string, folderId: string | null, userId: string): Promise<void> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);

  if (!folderId) {
    await db.documentFolderEntry.deleteMany({ where: { documentId: document.id, userId } });
    return;
  }

  const folder = await assertOwnsFolder(folderId, userId);
  if (folder.projectId !== document.projectId) throw new Error(`폴더를 찾을 수 없습니다: ${folderId}`);

  const existing = await db.documentFolderEntry.findFirst({ where: { documentId: document.id, userId } });
  if (existing) {
    await db.documentFolderEntry.update({ where: { id: existing.id }, data: { folderId } });
  } else {
    await db.documentFolderEntry.create({ data: { documentId: document.id, userId, folderId } });
  }
}

