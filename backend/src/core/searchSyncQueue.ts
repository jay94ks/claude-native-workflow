import { getDb } from "./db.js";

// Meilisearch가 죽어 있는 동안(REST 호출 실패) 놓친 색인 쓰기를 여기
// 적재해뒀다가, 장애가 풀리면 drainSearchSyncQueue()가 일괄 재처리한다
// (#meilisearch-spof - 설계자가 명시적으로 요청한 큐+워커 아키텍처).
// documents.ts/sourceIndex.ts는 이 모듈의 enqueueSearchSync만 정적으로
// import한다 - drainSearchSyncQueue가 그 두 모듈을 다시 정적으로
// import하면 순환이 생기므로, 여기서는 항상 동적 import로 지연 로드한다.

export type SearchSyncKind = "upsertDocument" | "deleteDocument" | "resyncProjectSourceFiles";

export async function enqueueSearchSync(
  kind: SearchSyncKind,
  ref: { trackingCode?: string; projectId?: string },
): Promise<void> {
  const db = getDb();
  const trackingCode = ref.trackingCode ?? "";
  const projectId = ref.projectId ?? "";
  // upsert 하나로 원자적 중복 방지(동시에 같은 대상에 대한 쓰기가 여러
  // 번 실패해도 큐에는 한 항목만 남음) - findFirst 후 create였다면 두
  // 요청이 동시에 존재 확인을 통과해 중복 행이 생길 수 있었다.
  await db.searchSyncQueueEntry.upsert({
    where: { kind_trackingCode_projectId: { kind, trackingCode, projectId } },
    create: { kind, trackingCode, projectId },
    update: {},
  });
}

export async function getSearchSyncQueueStatus(): Promise<{
  totalEntries: number;
  byKind: Record<string, number>;
  oldestEntryAt: string | null;
}> {
  const db = getDb();
  const entries = await db.searchSyncQueueEntry.findMany({ orderBy: { createdAt: "asc" } });
  const byKind: Record<string, number> = {};
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  return { totalEntries: entries.length, byKind, oldestEntryAt: entries[0]?.createdAt.toISOString() ?? null };
}

export async function drainSearchSyncQueue(): Promise<{ processed: number; failed: number; remaining: number }> {
  const { resyncDocumentIndex } = await import("./documents.js");
  const { indexSyncDelete } = await import("./search.js");
  const { backfillProjectSourceIndexRaw } = await import("./sourceIndex.js");
  const { MeiliSearchRequestError } = await import("meilisearch");

  const db = getDb();
  const batch = await db.searchSyncQueueEntry.findMany({ orderBy: { createdAt: "asc" }, take: 100 });
  let processed = 0;
  let failed = 0;
  for (const entry of batch) {
    try {
      if (entry.kind === "upsertDocument") {
        // 그 사이 문서가 삭제됐으면 resyncDocumentIndex가 조용히
        // 아무것도 안 하고 리턴한다(documents.ts 참고) - 별도 처리 불필요.
        await resyncDocumentIndex(entry.trackingCode);
      } else if (entry.kind === "deleteDocument") {
        await indexSyncDelete(entry.trackingCode);
      } else if (entry.kind === "resyncProjectSourceFiles") {
        await backfillProjectSourceIndexRaw(entry.projectId);
      }
      await db.searchSyncQueueEntry.delete({ where: { id: entry.id } });
      processed++;
    } catch (err) {
      failed++;
      console.error(`검색 동기화 큐 처리 실패 (${entry.kind}/${entry.trackingCode || entry.projectId}):`, err);
      // 연결 실패면 나머지 항목도 다 실패할 게 뻔하므로 이 배치는 즉시
      // 중단하고 다음 워커 틱을 기다린다(매 항목마다 타임아웃을 반복해서
      // 기다리는 낭비 방지) - 연결 실패가 아닌 다른 에러(예: 개별 항목의
      // 일시적 문제)는 이 항목만 로그하고 나머지는 계속 처리한다.
      if (err instanceof MeiliSearchRequestError) break;
    }
  }
  const remaining = await db.searchSyncQueueEntry.count();
  return { processed, failed, remaining };
}
