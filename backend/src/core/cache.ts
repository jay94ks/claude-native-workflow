// 백엔드 인메모리 캐시 (design-notes.md "백엔드 캐시") - docs.list/
// docs.search/docs.status처럼 조회 위주인 액션의 결과를 프로젝트별로
// 캐싱한다. 무효화는 세 시점 중 "문서가 수정/삭제될 때"만 이번
// Phase에서 구현한다 - git 커밋 시점 무효화는 Phase 5(git 연동)
// 이후에나 의미가 생기므로 아직이다.
//
// 방식: 프로젝트마다 버전 카운터를 두고, 캐시 키에 그 버전을 포함시킨다.
// 문서가 바뀌면 버전을 올려서(그리고 그 프로젝트의 옛 엔트리를 지워서)
// 이전 캐시를 전부 무효화한다 - 개별 문서 단위 의존성 추적 없이 프로젝트
// 단위로 뭉뚱그린 러프한 무효화지만, 이번 규모에는 충분하다.

interface CacheEntry {
  value: unknown;
  version: number;
}

const versions = new Map<string, number>();
const entries = new Map<string, CacheEntry>();

function versionOf(projectId: string): number {
  return versions.get(projectId) ?? 0;
}

export function invalidateProject(projectId: string): void {
  const next = versionOf(projectId) + 1;
  versions.set(projectId, next);
  for (const key of entries.keys()) {
    if (key.startsWith(`${projectId}::`)) entries.delete(key);
  }
}

export function getCached<T>(projectId: string, cacheKey: string): T | undefined {
  const key = `${projectId}::v${versionOf(projectId)}::${cacheKey}`;
  return entries.get(key)?.value as T | undefined;
}

export function setCached(projectId: string, cacheKey: string, value: unknown): void {
  const key = `${projectId}::v${versionOf(projectId)}::${cacheKey}`;
  entries.set(key, { value, version: versionOf(projectId) });
}
