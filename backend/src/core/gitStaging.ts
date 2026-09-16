import { diffLines, type Change } from "diff";
import { merge as diff3Merge } from "node-diff3";
import { getDb } from "./db.js";
import * as gitea from "./gitea.js";
import * as gitCache from "./gitCache.js";
import { requireGiteaWorkingRef } from "./gitRepos.js";
import type { GiteaRepoRef } from "./gitea.js";

// git add/rm/status/restore/commit - #git-cache-and-staging. 실제 git의
// "스테이징 영역"에 대응하는 개념을 프로젝트 단위 DB 테이블
// (GitStagingChange)로 구현한다. 한 프로젝트는 항상 정확히 하나의
// "작업 저장소"(self_hosted 또는 work)만 가지므로(requireGiteaWorkingRef
// 참고) repoKind는 CLI/API 호출부가 지정할 필요 없이 여기서 자동으로
// 해석한다.

async function resolveWorkTarget(projectId: string): Promise<{ target: GiteaRepoRef; repoKind: gitea.RepoKind }> {
  const target = await requireGiteaWorkingRef(projectId);
  return { target, repoKind: gitea.repoKindFromRef(target) };
}

async function currentShaForPath(projectId: string, repoKind: gitea.RepoKind, target: GiteaRepoRef, path: string): Promise<string | null> {
  let sha = await gitCache.lookupShaInCachedTree(projectId, repoKind, path);
  if (sha) return sha;
  // 캐시가 비어있으면 한 번 채운다(이후 같은 요청 안의 다른 경로 조회도 이걸 재사용).
  const tree = await gitea.getFullTree(projectId, target);
  return tree.find((e) => e.path === path)?.sha ?? null;
}

export interface StagedChangeInfo {
  path: string;
  changeType: "upsert" | "delete";
  baseSha: string | null;
  stagedBy: string | null;
  stagedAt: string;
}

async function writeStagingRow(
  projectId: string,
  repoKind: gitea.RepoKind,
  path: string,
  changeType: "upsert" | "delete",
  content: string | null,
  baseSha: string | null,
  stagedBy?: string,
): Promise<StagedChangeInfo> {
  const db = getDb();
  const row = await db.gitStagingChange.upsert({
    where: { projectId_repoKind_path: { projectId, repoKind, path } },
    create: { projectId, repoKind, path, changeType, content, baseSha, stagedBy },
    update: { changeType, content, baseSha, stagedBy, stagedAt: new Date() },
  });
  return toInfo(row);
}

export async function stageUpsert(projectId: string, path: string, content: string, stagedBy?: string): Promise<StagedChangeInfo> {
  const { target, repoKind } = await resolveWorkTarget(projectId);
  const baseSha = await currentShaForPath(projectId, repoKind, target, path);
  return writeStagingRow(projectId, repoKind, path, "upsert", content, baseSha, stagedBy);
}

export async function stageDelete(projectId: string, path: string, stagedBy?: string): Promise<StagedChangeInfo> {
  const { target, repoKind } = await resolveWorkTarget(projectId);
  const baseSha = await currentShaForPath(projectId, repoKind, target, path);
  return writeStagingRow(projectId, repoKind, path, "delete", null, baseSha, stagedBy);
}

export interface BulkStageResult {
  path: string;
  ok: boolean;
  error?: string;
}

/** add/rm을 파일마다 한 건씩 반복 호출하면(각자 CLI 프로세스 기동+HTTP
 * 왕복) 여러 파일을 다뤄야 할 때 느리다고 체감될 만큼 누적된다(설계자
 * 지적) - 트리를 요청당 한 번만 받아와(캐시 히트면 즉시, 미스면 이
 * 요청의 모든 항목이 그 한 번의 결과를 공유) 항목마다 캐시를 다시
 * 조회하지 않는다. 한 항목이 실패해도 나머지는 계속 진행(항목별
 * 결과 반환 - #relation-add-bulk/#document-patch-batch와 같은 관례). */
export async function bulkStageUpsert(
  projectId: string,
  items: { path: string; content: string }[],
  stagedBy?: string,
): Promise<BulkStageResult[]> {
  const { target, repoKind } = await resolveWorkTarget(projectId);
  const tree = await gitea.getFullTree(projectId, target);
  const shaByPath = new Map(tree.map((e) => [e.path, e.sha]));
  return Promise.all(
    items.map(async ({ path, content }) => {
      try {
        await writeStagingRow(projectId, repoKind, path, "upsert", content, shaByPath.get(path) ?? null, stagedBy);
        return { path, ok: true };
      } catch (err) {
        return { path, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

export async function bulkStageDelete(projectId: string, paths: string[], stagedBy?: string): Promise<BulkStageResult[]> {
  const { target, repoKind } = await resolveWorkTarget(projectId);
  const tree = await gitea.getFullTree(projectId, target);
  const shaByPath = new Map(tree.map((e) => [e.path, e.sha]));
  return Promise.all(
    paths.map(async (path) => {
      try {
        await writeStagingRow(projectId, repoKind, path, "delete", null, shaByPath.get(path) ?? null, stagedBy);
        return { path, ok: true };
      } catch (err) {
        return { path, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

export async function restoreStaged(projectId: string, path: string): Promise<void> {
  const { repoKind } = await resolveWorkTarget(projectId);
  const db = getDb();
  const existing = await db.gitStagingChange.findUnique({ where: { projectId_repoKind_path: { projectId, repoKind, path } } });
  if (!existing) throw new Error(`스테이징된 변경이 없습니다: ${path}`);
  await db.gitStagingChange.delete({ where: { id: existing.id } });
}

export interface StatusEntry {
  path: string;
  changeType: "upsert" | "delete";
  stagedBy: string | null;
  stagedAt: string;
  driftDetected: boolean;
  diff: Change[];
}

/** git status - 스테이징된 변경 목록 + 각 항목의 현재 HEAD 대비 diff.
 * 문서 버전 비교(docs diff/document_diff, core/documents.ts의
 * diffDocument())가 쓰는 것과 같은 diff 라이브러리·응답 모양(added/
 * removed/value)을 그대로 재사용한다. */
export async function getStatus(projectId: string): Promise<StatusEntry[]> {
  const { target, repoKind } = await resolveWorkTarget(projectId);
  const db = getDb();
  const rows = await db.gitStagingChange.findMany({ where: { projectId, repoKind }, orderBy: { path: "asc" } });
  if (rows.length === 0) return [];

  const paths = rows.map((r: { path: string }) => r.path);
  const currentContents = await gitea.getFileContentsBatch(projectId, target, paths);

  const entries: StatusEntry[] = [];
  for (const row of rows) {
    const currentSha = await currentShaForPath(projectId, repoKind, target, row.path);
    const driftDetected = row.baseSha !== currentSha;
    const currentContent = currentContents.get(row.path)?.content ?? "";
    const diff =
      row.changeType === "upsert" ? diffLines(currentContent, row.content ?? "") : diffLines(currentContent, "");
    entries.push({
      path: row.path,
      changeType: row.changeType as "upsert" | "delete",
      stagedBy: row.stagedBy,
      stagedAt: row.stagedAt.toISOString(),
      driftDetected,
      diff,
    });
  }
  return entries;
}

export interface CommitConflict {
  path: string;
  base: string;
  ours: string;
  theirs: string;
  merged: string; // 충돌 마커(<<<<<<< / ======= / >>>>>>>)가 박힌 병합 시도 결과 - 참고용
}

export type CommitStagedResult =
  | { status: "committed"; commitSha: string; paths: string[] }
  | { status: "conflict"; conflicts: CommitConflict[] }
  | { status: "empty" };

/** 스테이징된 변경을 전부 모아 한 번에 커밋한다(#git-cache-and-staging).
 * 각 경로의 baseSha를 현재 HEAD sha와 비교해 드리프트를 감지하고,
 * 겹치지 않는 변경은 3-way(diff3) 자동 병합, 겹치는 변경(진짜 충돌)이
 * 하나라도 있으면 커밋 전체를 하지 않는다(부분 커밋 금지 - 원자성
 * 약속을 지키기 위해, "조용한 데이터 누락보다 안전한 실패"라는 이
 * 코드베이스의 원칙과 일치). "삭제 대 수정" 조합은 항상 충돌로
 * 취급한다(실제 git과 동일). */
export async function commitStaged(projectId: string, message: string, actingUserId?: string): Promise<CommitStagedResult> {
  const { target, repoKind } = await resolveWorkTarget(projectId);
  const db = getDb();
  const rows = await db.gitStagingChange.findMany({ where: { projectId, repoKind } });
  if (rows.length === 0) return { status: "empty" };

  const conflicts: CommitConflict[] = [];
  const changes: gitea.FileChangeOp[] = [];

  for (const row of rows) {
    const currentSha = await currentShaForPath(projectId, repoKind, target, row.path);
    if (row.baseSha === currentSha) {
      // 드리프트 없음 - 스테이징된 그대로 반영.
      changes.push(
        row.changeType === "delete"
          ? { path: row.path, changeType: "delete" }
          : { path: row.path, changeType: "upsert", content: row.content ?? "" },
      );
      continue;
    }

    // 드리프트 발생 - "삭제 대 수정"과 "새 파일인데 이제 존재함"은 항상
    // 충돌(실제 git과 동일한 취급, 자동 해소 대상이 아님). base는
    // baseSha로 직접 조회(경로+ref로 조회하면 항상 "현재" 내용이라 -
    // 드리프트가 있을 땐 그게 원래 base가 아님).
    const currentContent = currentSha ? (await gitea.getFileContentsBatch(projectId, target, [row.path])).get(row.path)?.content ?? "" : "";
    if (row.changeType === "delete" || row.baseSha === null) {
      conflicts.push({
        path: row.path,
        base: row.baseSha ? await gitea.getBlobBySha(projectId, target, row.baseSha) : "",
        ours: row.content ?? "(삭제)",
        theirs: currentContent,
        merged: "(자동 병합 대상 아님 - 삭제 대 수정 또는 새 파일 충돌)",
      });
      continue;
    }

    // 3-way 병합 시도: base(baseSha 시점 내용) vs ours(스테이징) vs theirs(현재 HEAD).
    const baseContent = await gitea.getBlobBySha(projectId, target, row.baseSha);
    const ours = row.content ?? "";
    const merged = diff3Merge(ours.split("\n"), baseContent.split("\n"), currentContent.split("\n"));
    if (merged.conflict) {
      conflicts.push({ path: row.path, base: baseContent, ours, theirs: currentContent, merged: merged.result.join("\n") });
      continue;
    }
    changes.push({ path: row.path, changeType: "upsert", content: merged.result.join("\n") });
  }

  if (conflicts.length > 0) return { status: "conflict", conflicts };

  const result = await gitea.changeFiles(projectId, target, changes, message, actingUserId);
  await db.gitStagingChange.deleteMany({ where: { id: { in: rows.map((r: { id: string }) => r.id) } } });
  return { status: "committed", commitSha: result.commitSha, paths: changes.map((c) => c.path) };
}

function toInfo(row: {
  path: string;
  changeType: string;
  baseSha: string | null;
  stagedBy: string | null;
  stagedAt: Date;
}): StagedChangeInfo {
  return {
    path: row.path,
    changeType: row.changeType as "upsert" | "delete",
    baseSha: row.baseSha,
    stagedBy: row.stagedBy,
    stagedAt: row.stagedAt.toISOString(),
  };
}
