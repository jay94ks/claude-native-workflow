// Meilisearch 연동 - docs/design-notes.md "Meilisearch 활용 최적화 방안":
// 구조화 필터(type/kind/state/branch/author)를 Meilisearch에 함께
// 인덱싱해서 `docs.search`의 `q` 검색이 필터+텍스트를 한 번에 처리하게 한다.
//
// Phase 3 판단: 원래 설계는 "EMQX 브로드캐스트를 구독해서 비동기로
// 인덱싱"(Phase 5 스코프)이었는데, 아직 EMQX 연동이 없어서 이번
// Phase에서는 documents.ts가 CRUD 직후 이 모듈을 **직접 동기 호출**
// 한다 - Meilisearch가 죽어 있어도 문서 CRUD 자체는 실패하지 않도록
// try/catch로 감싸고 경고만 남긴다(design-notes.md에 기록). Phase 5에서
// EMQX 구독 방식으로 교체하면서 이 직접 호출은 제거될 것이다.

import { MeiliSearch } from "meilisearch";

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_URL ?? "http://127.0.0.1:7700",
  apiKey: process.env.MEILISEARCH_API_KEY,
});

const INDEX_NAME = "documents";
let ensured = false;

async function ensureIndex(): Promise<void> {
  if (ensured) return;
  try {
    await client.createIndex(INDEX_NAME, { primaryKey: "id" });
  } catch {
    // already exists - fine.
  }
  const index = client.index(INDEX_NAME);
  await index.updateFilterableAttributes(["projectId", "type", "kind", "state", "branch", "author"]);
  await index.updateSearchableAttributes(["title", "content"]);
  ensured = true;
}

export interface IndexableDocument {
  id: string;
  projectId: string;
  type: string;
  kind: string;
  state: string;
  branch: string | null;
  author: string;
  title: string;
  content: string;
}

export async function indexDocument(doc: IndexableDocument): Promise<void> {
  try {
    await ensureIndex();
    await client.index(INDEX_NAME).addDocuments([doc]);
  } catch (err) {
    console.warn("[searchIndex] failed to index document (ignored):", (err as Error).message);
  }
}

export async function removeFromIndex(id: string): Promise<void> {
  try {
    await ensureIndex();
    await client.index(INDEX_NAME).deleteDocument(id);
  } catch (err) {
    console.warn("[searchIndex] failed to remove document from index (ignored):", (err as Error).message);
  }
}

export interface SearchFilters {
  type?: string;
  kind?: string;
  state?: string;
  branch?: string;
  author?: string;
}

export interface SearchOptions extends SearchFilters {
  projectId: string;
  q: string;
  page: number;
  pageSize: number;
}

export async function searchDocuments(opts: SearchOptions): Promise<{ ids: string[]; total: number }> {
  await ensureIndex();
  const filters = [`projectId = "${opts.projectId}"`];
  for (const key of ["type", "kind", "state", "branch", "author"] as const) {
    const value = opts[key];
    if (value) filters.push(`${key} = "${value}"`);
  }

  const result = await client.index(INDEX_NAME).search(opts.q, {
    filter: filters.join(" AND "),
    offset: (opts.page - 1) * opts.pageSize,
    limit: opts.pageSize,
  });

  return {
    ids: result.hits.map((hit) => hit.id as string),
    total: result.estimatedTotalHits ?? result.hits.length,
  };
}
