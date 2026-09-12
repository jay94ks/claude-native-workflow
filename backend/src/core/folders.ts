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

// moveFolder()의 순환 방지 검사(isDescendantOf)는 트리를 "읽고" 그
// 결과를 근거로 나중에 "쓰는" 두 단계라, 같은 설계자가 폴더 A를 B
// 밑으로, B를 A 밑으로 옮기는 요청을 거의 동시에 보내면(빠른 연속
// 드래그, 여러 탭/스크립트) 두 요청 모두 상대의 쓰기가 반영되기 전의
// 트리를 보고 통과해버려 실제로 순환(A->B->A)이 만들어질 수 있다
// (동시성 QA로 실제 재현). 이 앱은 단일 설치형 - 백엔드가 항상 프로세스
// 하나로 뜬다(README 명시) - 이므로 여러 DB 프로바이더(SQLite/Postgres/
// MySQL)에 걸쳐 SERIALIZABLE 트랜잭션이나 행 잠금을 이식성 있게 구현하는
// 대신, 같은 설계자의 폴더 이동 요청을 프로세스 안에서 순서대로만
// 처리되게 줄 세우는 게 훨씬 간단하고 완전하다 - 폴더는 개인 소유라
// 잠금 범위를 설계자 단위로 잡아도 다른 설계자의 이동을 조금도 막지
// 않는다.
const userFolderLocks = new Map<string, Promise<unknown>>();

function withUserFolderLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prior = userFolderLocks.get(userId) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  userFolderLocks.set(userId, run.catch(() => {}));
  return run;
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

// 프론트(FolderTree.vue)가 이 정확한 문자열로 "빈 폴더가 아니라
// mode 선택이 필요하다"를 구분한다(GitRepoPanel.vue의 git_auth_required
// 정확 일치 분기와 같은 패턴) - 메시지를 바꾸면 그쪽도 같이 바꿔야 함.
export const FOLDER_NOT_EMPTY_MESSAGE =
  "비어있지 않은 폴더는 삭제할 수 없습니다 - 재귀 삭제(recursive)나 상위로 끌어올리기(promote) 중 하나를 선택하세요";

export type FolderDeleteMode = "recursive" | "promote";

/** mode 없이 호출하면 비어있을 때만 삭제(기존 동작 그대로). 비어있지
 * 않은데 mode가 없으면 FOLDER_NOT_EMPTY_MESSAGE로 거부한다.
 *
 * - "recursive": 가드 없이 바로 지운다 - Folder.parentFolder와
 *   DocumentFolderEntry.folder 둘 다 onDelete: Cascade라 DB가 하위
 *   폴더/문서 배치를 전부 재귀적으로 정리한다(문서 자신은 안 지워짐,
 *   배치 메타데이터만 사라짐). 폴더는 항상 단일 소유자 트리라(하위
 *   폴더/배치를 만들려면 항상 상위 폴더 소유권이 필요) 다른 설계자의
 *   데이터를 건드릴 수 없다.
 * - "promote": 직속 하위 폴더/직속 문서 배치를 이 폴더의 부모로 한
 *   단계 끌어올린 뒤 빈 폴더가 된 대상을 지운다. 대상이 최상위였다면
 *   하위 폴더는 새 최상위가 되고, 직속 문서 배치는
 *   DocumentFolderEntry.folderId가 NOT NULL이라 옮길 곳이 없어 배치
 *   자체가 삭제된다("폴더 없음" 상태 - moveDocumentToFolder(folderId:
 *   null)와 동일한 결과, 문서는 안 지워짐). */
export async function deleteFolder(folderId: string, userId: string, mode?: FolderDeleteMode): Promise<void> {
  const folder = await assertOwnsFolder(folderId, userId);
  const db = getDb();
  const [childCount, entryCount] = await Promise.all([
    db.folder.count({ where: { parentFolderId: folderId } }),
    db.documentFolderEntry.count({ where: { folderId } }),
  ]);

  if (childCount === 0 && entryCount === 0) {
    await db.folder.delete({ where: { id: folderId } });
    return;
  }
  if (!mode) {
    throw new Error(FOLDER_NOT_EMPTY_MESSAGE);
  }
  if (mode === "recursive") {
    await db.folder.delete({ where: { id: folderId } });
    return;
  }

  // mode === "promote"
  const destParentId = folder.parentFolderId;
  const [children, siblingCountAtDest] = await Promise.all([
    db.folder.findMany({ where: { parentFolderId: folderId } }),
    db.folder.count({ where: { projectId: folder.projectId, createdBy: userId, parentFolderId: destParentId } }),
  ]);
  for (const child of children) {
    await assertNoSiblingWithName(folder.projectId, userId, destParentId, child.name, child.id);
  }
  await db.$transaction([
    ...children.map((child: { id: string }, i: number) =>
      db.folder.update({ where: { id: child.id }, data: { parentFolderId: destParentId, order: siblingCountAtDest + i } }),
    ),
    ...(destParentId
      ? [db.documentFolderEntry.updateMany({ where: { folderId }, data: { folderId: destParentId } })]
      : [db.documentFolderEntry.deleteMany({ where: { folderId } })]),
    db.folder.delete({ where: { id: folderId } }),
  ]);
}

// candidateId(=옮기려는 새 부모)가 ancestorId(=옮기려는 폴더)의 하위
// 트리에 있는지 - 있으면 그 밑으로 옮기는 순간 순환이 생기므로
// 거부해야 한다. candidateId부터 parentFolderId를 타고 루트까지
// 거슬러 올라가며 ancestorId와 일치하는지 확인한다.
async function isDescendantOf(candidateId: string, ancestorId: string): Promise<boolean> {
  const db = getDb();
  let current: string | null = candidateId;
  const visited = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const row: { parentFolderId: string | null } | null = await db.folder.findUnique({
      where: { id: current },
      select: { parentFolderId: true },
    });
    current = row?.parentFolderId ?? null;
  }
  return false;
}

/** 폴더를 다른 부모 밑으로 옮기고(같은 부모 안에서 순서만 바꾸는
 * 것도 parentFolderId를 그대로 넘기면 이 함수로 처리된다), 이동 후
 * 그 부모 밑에 있어야 할 형제 전체의 순서를 siblingOrder가 넘겨준
 * 배열 순서대로 다시 매긴다(칸반 컬럼 순서 변경과 동일한 패턴 -
 * 드래그 UI가 로컬에서 이미 재배열한 최종 배열을 그대로 보낸다).
 * siblingOrder에 이 사용자 소유가 아니거나 같은 프로젝트가 아닌 id가
 * 섞여 있으면 조용히 걸러내고(다른 설계자의 폴더 order를 함부로
 * 바꾸지 못하게), 걸러진 id들만 순서대로 재배정한다. */
export async function moveFolder(
  folderId: string,
  userId: string,
  parentFolderId: string | null,
  siblingOrder: string[],
): Promise<FolderDetail> {
  return withUserFolderLock(userId, () => moveFolderLocked(folderId, userId, parentFolderId, siblingOrder));
}

async function moveFolderLocked(
  folderId: string,
  userId: string,
  parentFolderId: string | null,
  siblingOrder: string[],
): Promise<FolderDetail> {
  const folder = await assertOwnsFolder(folderId, userId);
  if (parentFolderId === folderId) {
    throw new Error("폴더를 자기 자신 아래로 옮길 수 없습니다");
  }
  if (parentFolderId) {
    const target = await assertOwnsFolder(parentFolderId, userId);
    if (target.projectId !== folder.projectId) {
      throw new Error(`상위 폴더를 찾을 수 없습니다: ${parentFolderId}`);
    }
    if (await isDescendantOf(parentFolderId, folderId)) {
      throw new Error("하위 폴더 아래로는 옮길 수 없습니다");
    }
  }
  if (parentFolderId !== folder.parentFolderId) {
    await assertNoSiblingWithName(folder.projectId, userId, parentFolderId, folder.name, folderId);
  }
  const db = getDb();
  const validRows = await db.folder.findMany({
    where: { id: { in: siblingOrder }, projectId: folder.projectId, createdBy: userId },
    select: { id: true },
  });
  const validIds = new Set(validRows.map((f: { id: string }) => f.id));
  const ordered = siblingOrder.filter((id) => validIds.has(id));
  await db.$transaction([
    db.folder.update({ where: { id: folderId }, data: { parentFolderId } }),
    ...ordered.map((id: string, i: number) => db.folder.update({ where: { id }, data: { order: i } })),
  ]);
  return assertOwnsFolder(folderId, userId);
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

/** 이 설계자 기준으로 DocumentFolderEntry가 하나도 없는(= 어느 폴더에도
 * 안 담긴) 문서 - 트리의 가상 "최상위 폴더" 노드가 보여주는 목록.
 * 다른 설계자가 같은 문서를 자기 폴더에 담아뒀어도 이 설계자에게는
 * 여전히 미분류로 보인다(폴더는 개인 소유라 서로 안 섞임). */
export async function listUnfiledDocuments(projectId: string, userId: string): Promise<FolderDocumentSummary[]> {
  const db = getDb();
  const docs = await db.document.findMany({
    where: { projectId, folderEntries: { none: { userId } } },
    select: { trackingCode: true, title: true, docTypeId: true },
  });
  return docs;
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

