import { getDb } from "./db.js";
import type { FullTreeEntry, RepoKind as GiteaRepoKind } from "./gitea.js";

// git 트리/블롭 조회 캐시 - #git-cache-and-staging. 프로젝트 단위 DB
// 테이블로 구성한다(설계자 지시 - 프로세스 내 메모리 캐시는 백엔드
// 재시작이나 다중 인스턴스 스케일 시 무효화가 전파되지 않음). 무효화는
// 이 파일이 아니라 호출부(commitChanges류, pushHooks.ts)가 write 시점에
// 직접 한다 - 여기는 순수 읽기/쓰기 접근자만 제공.

const BLOB_CACHE_CAP_PER_PROJECT = 500;

export async function getCachedTree(
  projectId: string,
  repoKind: GiteaRepoKind,
  ref = "HEAD",
): Promise<FullTreeEntry[] | null> {
  const db = getDb();
  const row = await db.gitTreeCache.findUnique({
    where: { projectId_repoKind_ref: { projectId, repoKind, ref } },
  });
  if (!row) return null;
  return JSON.parse(row.treeJson) as FullTreeEntry[];
}

export async function setCachedTree(
  projectId: string,
  repoKind: GiteaRepoKind,
  ref: string,
  tree: FullTreeEntry[],
): Promise<void> {
  const db = getDb();
  const treeJson = JSON.stringify(tree);
  await db.gitTreeCache.upsert({
    where: { projectId_repoKind_ref: { projectId, repoKind, ref } },
    create: { projectId, repoKind, ref, treeJson },
    update: { treeJson },
  });
}

/** ref를 생략하면 그 repoKind의 모든 ref 캐시를 지운다(브랜치별로
 * 흩어진 캐시를 일일이 알 필요 없이 통째로 무효화할 때). */
export async function invalidateTree(
  projectId: string,
  repoKind: GiteaRepoKind,
  ref?: string,
): Promise<void> {
  const db = getDb();
  await db.gitTreeCache.deleteMany({
    where: ref ? { projectId, repoKind, ref } : { projectId, repoKind },
  });
}

/** 트리 캐시에서 path→sha를 찾는다 - 캐시가 없으면 null(호출부가
 * fetch 후 setCachedTree로 채우는 부수효과를 겸하도록 유도). */
export async function lookupShaInCachedTree(
  projectId: string,
  repoKind: GiteaRepoKind,
  path: string,
  ref = "HEAD",
): Promise<string | null> {
  const tree = await getCachedTree(projectId, repoKind, ref);
  if (!tree) return null;
  return tree.find((e) => e.path === path)?.sha ?? null;
}

export async function getCachedBlob(projectId: string, sha: string): Promise<string | null> {
  const db = getDb();
  const row = await db.gitBlobCache.findUnique({ where: { projectId_sha: { projectId, sha } } });
  return row?.content ?? null;
}

export async function getCachedBlobsBatch(projectId: string, shas: string[]): Promise<Map<string, string>> {
  if (shas.length === 0) return new Map();
  const db = getDb();
  const rows = await db.gitBlobCache.findMany({ where: { projectId, sha: { in: shas } } });
  return new Map(rows.map((r: { sha: string; content: string }) => [r.sha, r.content]));
}

/** content-addressed라 같은 sha는 항상 같은 내용 - upsert가 충돌 없이
 * 멱등하다. 쓰기 시점에 사이즈 캡을 넘겼으면 오래된 것부터 정리한다
 * (별도 크론 없이, 이 코드베이스의 기존 관례). */
export async function setCachedBlob(projectId: string, sha: string, content: string): Promise<void> {
  const db = getDb();
  await db.gitBlobCache.upsert({
    where: { projectId_sha: { projectId, sha } },
    create: { projectId, sha, content },
    update: {},
  });
  const count = await db.gitBlobCache.count({ where: { projectId } });
  if (count > BLOB_CACHE_CAP_PER_PROJECT) {
    const stale = await db.gitBlobCache.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      take: count - BLOB_CACHE_CAP_PER_PROJECT,
      select: { id: true },
    });
    await db.gitBlobCache.deleteMany({ where: { id: { in: stale.map((s: { id: string }) => s.id) } } });
  }
}

export async function setCachedBlobsBatch(projectId: string, entries: { sha: string; content: string }[]): Promise<void> {
  for (const { sha, content } of entries) {
    await setCachedBlob(projectId, sha, content);
  }
}
