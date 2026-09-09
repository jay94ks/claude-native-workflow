import fs from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { getProjectRoot, docsDir, resolveInDocs } from "./paths.js";
import { loadConfig } from "./config.js";
import { scanMeta } from "./docstore.js";

// SP-00001 5절 git 자동화. `docs/.config.json`의 `git.enabled`(로컬 docs/가
// 애초에 git 저장소가 아니면 자동으로 꺼짐)/`git.push_mode`를 따른다.
// 충돌은 자동 병합을 시도하지 않고 그대로 보고한다 - 호출부(CLI/API/MCP)가
// 그 메시지를 설계자에게 그대로 보여준다.

function hasGitRepo(root: string): boolean {
  let dir = root;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function git(): SimpleGit {
  return simpleGit(getProjectRoot());
}

export function gitAutomationEnabled(): boolean {
  return loadConfig().git.enabled && hasGitRepo(getProjectRoot());
}

export interface PullResult {
  attempted: boolean;
  ok: boolean;
  conflict: boolean;
  message: string;
}

/** Explicit `docs git pull` (also used at backend/MCP startup - SP-00001 5절
 * "세션/백엔드 기동 시"). Never auto-merges a conflict; reports it instead.
 * On success, immediately scans whatever changed under docs/ so the change
 * queue (5절) gets a `source: git_pull` notice right away, rather than
 * waiting for the next incidental tree/list read to notice via `scan`. */
export async function pull(): Promise<PullResult> {
  if (!gitAutomationEnabled()) {
    return { attempted: false, ok: false, conflict: false, message: "git 자동화가 꺼져 있습니다" };
  }
  const g = git();
  let beforeSha: string | null = null;
  try {
    beforeSha = (await g.revparse(["HEAD"])).trim();
  } catch {
    beforeSha = null; // e.g. no commits yet - fine, just skip the post-pull scan
  }
  try {
    const summary = await g.pull();
    if (beforeSha) await scanChangedDocsSince(g, beforeSha);
    return {
      attempted: true, ok: true, conflict: false,
      message: `pull 완료 (${summary.summary.changes} changes, ${summary.summary.insertions} insertions, ${summary.summary.deletions} deletions)`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "conflict" means an actual merge conflict (git leaves CONFLICT markers
    // and a dirty working tree) - other pull failures (no upstream, no
    // remote, network) fail the same way but aren't conflicts to resolve.
    return { attempted: true, ok: false, conflict: message.includes("CONFLICT"), message };
  }
}

async function scanChangedDocsSince(g: SimpleGit, beforeSha: string): Promise<void> {
  const diffOut = await g.diff(["--name-only", beforeSha, "HEAD", "--", docsDir()]);
  const changedRel = diffOut.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md"));
  for (const gitRelPath of changedRel) {
    // gitRelPath is repo-root-relative (e.g. "docs/decision/DC-00001.md");
    // scanMeta wants an absolute path so it can compute a docs/-relative one.
    const absPath = path.join(getProjectRoot(), gitRelPath);
    if (fs.existsSync(absPath)) {
      scanMeta(absPath, "git_pull");
    }
  }
}

export interface CommitResult {
  attempted: boolean;
  committed: boolean;
  sha?: string;
  message: string;
}

/** Stages and commits changes under docs/ only (never the whole working
 * tree - the designer may have unrelated staged work elsewhere in the
 * repo). No-op (not an error) if nothing under docs/ changed. */
export async function commitDocsChange(message: string): Promise<CommitResult> {
  if (!gitAutomationEnabled()) {
    return { attempted: false, committed: false, message: "git 자동화가 꺼져 있습니다" };
  }
  const g = git();
  await g.add([docsDir()]);
  const status = await g.status();
  if (status.staged.length === 0) {
    return { attempted: true, committed: false, message: "변경 사항이 없습니다" };
  }
  const res = await g.commit(message);
  return { attempted: true, committed: true, sha: res.commit, message };
}

export interface PushResult {
  attempted: boolean;
  pushed: boolean;
  message: string;
}

/** Always pushes when called explicitly (`docs git push`), regardless of
 * `push_mode` - `push_mode: manual` only means "afterWrite won't push on
 * its own", not that this command is blocked. */
export async function push(): Promise<PushResult> {
  if (!gitAutomationEnabled()) {
    return { attempted: false, pushed: false, message: "git 자동화가 꺼져 있습니다" };
  }
  try {
    await git().push();
    return { attempted: true, pushed: true, message: "push 완료" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { attempted: true, pushed: false, message };
  }
}

/** SP-00001 5절: docs new/reply/transition-done 성공 직후 자동 commit,
 * push_mode가 immediate(기본)면 이어서 push까지. 실패해도 던지지 않는다 -
 * 문서 쓰기 자체는 이미 끝난 뒤라, git 실패로 API 응답 전체를 실패시키지
 * 않고 결과에 같이 실어 보낸다. */
export async function afterWrite(message: string): Promise<{ commit: CommitResult; push?: PushResult }> {
  const commit = await commitDocsChange(message);
  if (!commit.committed) return { commit };
  const cfg = loadConfig();
  if (cfg.git.push_mode !== "immediate") return { commit };
  const pushResult = await push();
  return { commit, push: pushResult };
}

/** `docs git sync` - pull, then commit whatever is currently dirty under
 * docs/ (e.g. a hand-edit) with the given/default message, then push. */
export async function sync(message = "docs: sync"): Promise<{ pull: PullResult; commit?: CommitResult; push?: PushResult }> {
  const pullResult = await pull();
  if (!pullResult.ok) return { pull: pullResult };
  const commit = await commitDocsChange(message);
  if (!commit.committed) return { pull: pullResult, commit };
  const pushResult = await push();
  return { pull: pullResult, commit, push: pushResult };
}
