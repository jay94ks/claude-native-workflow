import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloneRepository, initRepository, type Repository } from "es-git";
import type { GiteaRepoRef } from "./gitea.js";

// #git-direct-exec - Gitea REST의 파일 배치 커밋 API(`POST .../contents`)
// 자체가 실측으로 5~6초씩 걸리는 게 확인돼(설계자 피드백 "commit이
// 너무 오래 걸려"), 그 API를 거치지 않고 백엔드가 로컬에 클론한
// 저장소에서 es-git(napi-rs로 git2-rs/libgit2를 감싼 네이티브 모듈)로
// 직접 커밋/push한다(설계자 지시). 로컬 클론은 `.cache/git-raw`와 같은
// "완전히 재구성 가능한 캐시" 취급 - 볼륨 불필요, 손상되면 지우고
// 재클론. 매 호출마다 항상 새로 클론한다(fetch+reset 방식보다 코드가
// 훨씬 단순하고, 이 시스템이 다루는 저장소들은 대체로 작아 재클론
// 비용이 Gitea REST 호출보다 여전히 훨씬 쌈).

const WORK_DIR_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "git-work");

export interface GitIdentity {
  name: string;
  email: string;
  token: string;
}

export interface FileChangeOp {
  path: string;
  changeType: "upsert" | "delete";
  content?: string;
}

export interface ApplyResult {
  commitSha: string;
  files: { path: string; sha: string | null }[];
}

function cloneDirFor(target: GiteaRepoRef): string {
  return path.join(WORK_DIR_ROOT, target.org, target.repo);
}

function remoteUrlFor(apiBaseUrl: string, target: GiteaRepoRef): string {
  return `${apiBaseUrl}/${target.org}/${target.repo}.git`;
}

// 프로젝트(레포)당 직렬화 - 같은 org/repo에 대한 동시 커밋 요청이 같은
// 로컬 클론 디렉터리를 동시에 건드리지 않게 한다(gitRepos.ts의 기존
// syncStateByProject와 같은 정신 - 단일 설치형이라 분산 락 불필요).
const tailByKey = new Map<string, Promise<unknown>>();

function withRepoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prevTail = tailByKey.get(key) ?? Promise.resolve();
  const result = prevTail.then(fn, fn);
  tailByKey.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/** 변경할 파일 경로가 로컬 클론 루트 밖을 가리키지 않는지 심층 방어로
 * 한 번 더 확인한다(서버 라우트의 normalizeGitPath가 이미 있지만,
 * 이 모듈도 독립적으로 검증). */
function resolveSafe(root: string, relPath: string): string {
  const abs = path.join(root, relPath);
  const normalizedRoot = path.normalize(root + path.sep);
  if (abs !== path.normalize(root) && !path.normalize(abs).startsWith(normalizedRoot)) {
    throw new Error(`허용되지 않는 경로입니다: ${relPath}`);
  }
  return abs;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** non-fast-forward 거부(설계자가 이미 Gitea HTTP git 프로토콜로 직접
 * push하는 경로가 있으므로 실제로 일어날 수 있는 경합)인지 판단 -
 * 그 외 실패(인증/네트워크/디스크 등)는 재시도하지 않고 즉시 전파. */
function isNonFastForward(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return msg.includes("non-fast-forward") || msg.includes("fast-forward") || msg.includes("rejected") || msg.includes("stale info");
}

/** Gitea PAT을 URL에 basic-auth 자격증명으로 박아넣는다(username은
 * 아무 값이나 - Gitea는 password 자리의 PAT만 본다, 기존
 * configurePushMirror()로 이미 확인된 관례) - es-git의
 * `fetch.credential`/`push options.credential`을 시도해봤지만 실제로는
 * clone 단계에서 "remote authentication required but no callback set"
 * 로 실패하는 걸 실측 확인(es-git 0.7.0의 실제 동작, 문서상 예제와
 * 다름) - URL 임베드 방식은 실측으로 정상 동작 확인됨. */
function withCredentials(url: string, token: string): string {
  const u = new URL(url);
  u.username = "token";
  u.password = token;
  return u.toString();
}

/** 로컬 클론을 항상 새로 만든다 - 있으면 지우고 클론(또는 커밋이
 * 0개인 새 저장소면 init+remote add로 부트스트랩). **어느 쪽인지는
 * 호출부(gitea.ts의 changeFiles())가 이미 계산해둔 트리 캐시로 명시적
 * 으로 알려준다** - clone 실패를 "빈 저장소라서 그런가 보다"로
 * 추측하지 않는다(실측으로 발견한 실제 버그: es-git이 clone 중
 * "config value 'http.followRedirects' was not found"처럼 빈 저장소와
 * 무관한 일시적 에러를 던지는 경우가 있어, 그걸 빈 저장소로 잘못
 * 해석하면 실제로는 커밋이 있는 저장소인데 히스토리 없는 새 루트
 * 커밋을 만들어 push가 거부되는 사고로 이어짐, #git-direct-exec). */
async function freshClone(
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  isEmptyRepo: boolean,
): Promise<{ repo: Repository; dir: string; branch: string }> {
  const dir = cloneDirFor(target);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const url = remoteUrlFor(apiBaseUrl, target);

  if (isEmptyRepo) {
    const repo = await initRepository(dir, { initialHead: "main" });
    repo.createRemote("origin", url);
    return { repo, dir, branch: "main" };
  }

  const repo = await cloneRepository(withCredentials(url, identity.token), dir, { fetch: { depth: 1 } });
  const remote = repo.getRemote("origin");
  const branchRef = await remote.defaultBranch();
  const branch = branchRef.replace(/^refs\/heads\//, "");
  return { repo, dir, branch };
}

async function attempt(
  apiBaseUrl: string,
  target: GiteaRepoRef,
  changes: FileChangeOp[],
  message: string,
  identity: GitIdentity,
  isEmptyRepo: boolean,
  retriesLeft: number,
): Promise<ApplyResult> {
  const { repo, dir, branch } = await freshClone(apiBaseUrl, target, identity, isEmptyRepo);

  for (const c of changes) {
    const abs = resolveSafe(dir, c.path);
    if (c.changeType === "delete") {
      fs.rmSync(abs, { force: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, c.content ?? "");
    }
  }

  const index = repo.index();
  for (const c of changes) {
    if (c.changeType === "delete") index.removePath(c.path);
    else index.addPath(c.path);
  }
  const treeOid = index.writeTree();
  index.write();
  const tree = repo.getTree(treeOid);

  let parentOid: string | null = null;
  try {
    parentOid = repo.head().target();
  } catch {
    parentOid = null; // unborn HEAD(커밋 0개) - 부모 없는 첫 커밋
  }

  const signature = { name: identity.name, email: identity.email };
  const commitOid = repo.commit(tree, message, {
    updateRef: `refs/heads/${branch}`,
    author: signature,
    committer: signature,
    parents: parentOid ? [parentOid] : [],
  });

  const remote = repo.getRemote("origin");
  try {
    await remote.push([`refs/heads/${branch}:refs/heads/${branch}`], {
      credential: { type: "Plain", password: identity.token },
    });
  } catch (err) {
    if (retriesLeft > 0 && isNonFastForward(err)) {
      // non-fast-forward 거부 자체가 "방금 remote에 커밋이 생겼다"는
      // 증거이므로, 재시도는 항상 "빈 저장소 아님"으로 다시 클론한다.
      return attempt(apiBaseUrl, target, changes, message, identity, false, retriesLeft - 1);
    }
    throw new Error(`커밋 충돌: 다른 설계자(또는 직접 push)가 동시에 이 저장소에 push했습니다 - 다시 시도하세요. (${errorMessage(err)})`);
  }

  const files = changes.map((c) => {
    if (c.changeType === "delete") return { path: c.path, sha: null };
    const entry = tree.getPath(c.path);
    return { path: c.path, sha: entry?.id() ?? null };
  });

  return { commitSha: commitOid, files };
}

/** 변경 배치를 로컬 클론에서 커밋 하나로 만들어 Gitea에 push한다 -
 * gitea.ts의 changeFiles()가 REST 대신 이걸 호출하도록 위임한다. */
export async function applyChanges(
  apiBaseUrl: string,
  target: GiteaRepoRef,
  changes: FileChangeOp[],
  message: string,
  identity: GitIdentity,
  isEmptyRepo: boolean,
): Promise<ApplyResult> {
  const key = `${target.org}/${target.repo}`;
  return withRepoLock(key, () => attempt(apiBaseUrl, target, changes, message, identity, isEmptyRepo, 1));
}
