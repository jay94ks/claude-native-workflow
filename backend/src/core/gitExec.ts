import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloneRepository, initRepository, type Repository, type Tree } from "es-git";
import type { GiteaRepoRef } from "./gitea.js";

// #git-direct-exec - Gitea REST의 파일 배치 커밋 API(`POST .../contents`)
// 자체가 실측으로 5~6초씩 걸리는 게 확인돼(설계자 피드백 "commit이
// 너무 오래 걸려"), 그 API를 거치지 않고 백엔드가 로컬에 클론한
// 저장소에서 es-git(napi-rs로 git2-rs/libgit2를 감싼 네이티브 모듈)로
// 직접 커밋/push한다(설계자 지시).
//
// #git-persistent-local-clone - 읽기 경로(소스 브라우저 등)도 Gitea
// REST를 매번 왕복하던 걸 걷어내려고, projectId당 로컬 클론 하나를
// **프로세스가 살아있는 동안** 계속 열어둔다(설계자 지시 - "life-time
// 유지", 다만 재시작으로 날아가는 건 허용 - 다음 요청이 그 자리에서
// 다시 클론). Gitea는 항상 진짜 원본이고 이 로컬 클론은 그걸 뒤따르는
// 캐시일 뿐 - 갱신은 Gitea 시스템 웹훅이 세우는 staleness 플래그
// (markStale, pushHooks.ts에서 호출)로 트리거되고, 실제로는 그
// 다음 접근 시점에 fetch 한 번으로 반영한다(웹훅 자체가 이 백엔드의
// 자기 push에도 다시 온다 - 무해한 셀프 트리거링, invalidateTree와
// 같은 전제).

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

export interface TreeEntryLite {
  name: string;
  path: string;
  type: "file" | "dir";
}

export interface FullTreeEntryLite {
  path: string;
  sha: string;
  type: "blob";
}

export interface FileContentLite {
  path: string;
  content: string;
  sha: string;
}

function cloneDirFor(projectId: string): string {
  return path.join(WORK_DIR_ROOT, projectId);
}

function remoteUrlFor(apiBaseUrl: string, target: GiteaRepoRef): string {
  return `${apiBaseUrl}/${target.org}/${target.repo}.git`;
}

/** Gitea PAT을 URL에 basic-auth 자격증명으로 박아넣는다(username은
 * 아무 값이나 - Gitea는 password 자리의 PAT만 본다, #git-publish-
 * direct-push 이전 push mirror 코드로 이미 확인된 관례) - es-git의
 * `fetch.credential`/`clone options.fetch.credential`을 시도해봤지만
 * 실제로는 clone 단계에서 "remote authentication required but no
 * callback set"로 실패하는 걸 실측 확인(es-git 0.7.0의 실제 동작,
 * 문서상 예제와 다름) - URL 임베드 방식은 실측으로 정상 동작 확인됨.
 * 영구 클론이라 이 자격증명이 그 클론의 `.git/config`에 계속 남는다 -
 * 컨테이너 안 캐시 디렉터리(볼륨도 안 만듦)라 노출 표면이 작고,
 * fetch/push 어느 쪽이든 "이 프로젝트에 접근 가능한 누군가의 토큰"이면
 * 충분하다(커밋 저작자 귀속은 매 push 호출마다 그 설계자의 identity를
 * 따로 넘겨 별도로 보장 - 여기 박히는 토큰과 무관). */
function withCredentials(url: string, token: string): string {
  const u = new URL(url);
  u.username = "token";
  u.password = token;
  return u.toString();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** non-fast-forward 거부(설계자가 이미 Gitea HTTP git 프로토콜로 직접
 * push하는 경로가 있으므로 실제로 일어날 수 있는 경합)인지 판단 -
 * 그 외 실패(인증/네트워크/디스크 등)는 재시도하지 않고 즉시 전파. */
function isNonFastForward(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  // 실측으로 실제 es-git 에러 문구 확인(#git-publish-direct-push 검증
  // 중 발견 - 원래 있던 "fast-forward"(하이픈 포함) 매칭이 실제 libgit2
  // 에러의 "code=NotFastForward"(하이픈 없는 한 단어)를 못 잡아 진짜
  // divergence 거부를 "diverged"가 아니라 "failed"로 잘못 분류하던
  // 버그) - "commits that are not present locally"도 같이 잡는다.
  return (
    msg.includes("non-fast-forward") ||
    msg.includes("fast-forward") ||
    msg.includes("fastforward") ||
    msg.includes("rejected") ||
    msg.includes("stale info") ||
    msg.includes("not present locally")
  );
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

interface PersistentEntry {
  repo: Repository;
  dir: string;
  branch: string;
  originUrl: string;
}

// projectId당 영구 핸들 - Gitea 레포 이름(work/self_hosted)이 아니라
// projectId로 키를 잡는다. 외부 연동 해제/전환 시 Gitea가 실제로
// work<->self_hosted rename을 하므로(gitRepos.ts의 unlinkExternalRepo/
// promoteToExternal), 레포 이름 기준 키는 그 rename에 흔들리지만
// projectId는 안 바뀐다 - 대신 origin URL 불일치를 자체 감지해 재생성.
const persistentByProject = new Map<string, Promise<PersistentEntry>>();

// Gitea 시스템 웹훅(pushHooks.ts)이 세우는 "다음 접근 때 fetch 필요"
// 플래그 - 이 백엔드 자신의 push도 이 웹훅을 다시 받으므로 셀프
// 트리거링이 있지만, 이미 최신인 걸 다시 fetch하는 건 낭비일 뿐 틀린
// 동작은 아니다(gitCache.invalidateTree와 같은 전제).
const staleByProject = new Set<string>();

export function markStale(projectId: string): void {
  staleByProject.add(projectId);
}

/** 프로젝트 삭제/외부 연동 해제·전환 시 호출 - 영구 클론을 완전히
 * 정리한다(다음 접근에서 새로 클론하도록). fail-soft: 실패해도 조용히
 * 넘어간다(gitRepos.ts의 다른 정리 로직들과 같은 관례 - 저장소
 * 삭제/개편 자체를 이 정리 실패로 막으면 안 됨). */
export function dropPersistentRepo(projectId: string): void {
  persistentByProject.delete(projectId);
  staleByProject.delete(projectId);
  try {
    fs.rmSync(cloneDirFor(projectId), { recursive: true, force: true });
  } catch (err) {
    console.error(`dropPersistentRepo(${projectId}) - 로컬 클론 정리 실패:`, err);
  }
}

/** fetch 이후 origin/<branch>의 최신 커밋으로 로컬 브랜치+워킹
 * 디렉터리+인덱스를 강제로 맞춘다("git reset --hard origin/<branch>"
 * 동등) - 읽기는 항상 로컬 refs/heads/<branch>를 통해 이뤄지므로(이
 * 백엔드 자신의 push 직후에는 이미 최신이라 별도 갱신 없이도 맞다),
 * 외부에서 변경(설계자 직접 push, mirror 동기화)이 있었을 때만 이
 * 함수로 실제로 반영한다. 원격에 커밋이 아직 없으면(빈 저장소) 조용히
 * 아무것도 안 한다. */
async function resyncToRemote(entry: PersistentEntry, identity: GitIdentity): Promise<void> {
  const remote = entry.repo.getRemote("origin");
  await remote.fetch([], { fetch: { credential: { type: "Plain", password: identity.token } } }).catch(() => {
    // origin URL에 이미 자격증명이 박혀 있어 보통 옵션 없이도 되지만,
    // 방어적으로 한 번 더 시도(실패해도 아래에서 조용히 넘어감).
  });
  let remoteOid: string;
  try {
    remoteOid = entry.repo.revparseSingle(`refs/remotes/origin/${entry.branch}`);
  } catch {
    return; // 원격에 아직 커밋이 없음 - 로컬 상태 유지
  }
  const commit = entry.repo.findCommit(remoteOid);
  if (!commit) return;
  // libgit2는 현재 체크아웃된(HEAD가 심볼릭으로 가리키는) 브랜치를
  // createBranch(force)로 강제 이동하는 걸 거부한다("cannot force
  // update branch 'main' as it is the current HEAD" - 실측으로 발견)
  // - 먼저 HEAD를 그 커밋으로 detach해 브랜치 참조에서 떼어낸 뒤
  // 브랜치를 옮기고, 다시 그 브랜치로 HEAD를 붙인다.
  entry.repo.setHeadDetached(commit);
  entry.repo.createBranch(entry.branch, commit, { force: true });
  entry.repo.checkoutTree(commit.asObject(), { force: true });
  entry.repo.setHead(`refs/heads/${entry.branch}`);
}

/** 로컬에 없으면 새로 클론(또는 빈 저장소면 init+remote add로
 * 부트스트랩), 있으면 연다. **어느 쪽인지는 clone 실패를 추측하지
 * 않고 호출부가 준 checkEmpty()로 명시적으로 확인한다** - 실측으로
 * 발견한 실제 버그(es-git이 clone 중 빈 저장소와 무관한 일시적 에러
 * - "config value 'http.followRedirects' was not found" - 를 던지는
 * 경우가 있어, 그걸 빈 저장소로 잘못 해석하면 실제로는 커밋이 있는
 * 저장소인데 히스토리 없는 새 루트 커밋을 만들어 push가 거부되는
 * 사고로 이어짐, #git-direct-exec)를 이번 영구 클론 경로에서도 다시
 * 겪지 않기 위함. */
async function createPersistentRepo(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
): Promise<PersistentEntry> {
  const dir = cloneDirFor(projectId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const url = remoteUrlFor(apiBaseUrl, target);
  const credentialedUrl = withCredentials(url, identity.token);

  try {
    const repo = await cloneRepository(credentialedUrl, dir, { fetch: { depth: 1 } });
    const remote = repo.getRemote("origin");
    const branchRef = await remote.defaultBranch();
    const branch = branchRef.replace(/^refs\/heads\//, "");
    return { repo, dir, branch, originUrl: credentialedUrl };
  } catch (err) {
    const isEmpty = await checkEmpty().catch(() => false);
    if (!isEmpty) throw err; // 진짜 다른 에러 - 빈 저장소로 섣불리 단정하지 않음
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const repo = await initRepository(dir, { initialHead: "main" });
    repo.createRemote("origin", credentialedUrl);
    return { repo, dir, branch: "main", originUrl: credentialedUrl };
  }
}

/** projectId당 영구 Repository 핸들을 얻는다(없으면 생성, 있으면
 * 재사용) - staleness 갱신은 안 한다(호출부 책임, 아래 ensureFreshEntry/
 * attempt() 참고). 저장된 origin(자격증명 제외)과 이번에 기대하는
 * URL이 다르면(연동 방식 전환으로 work<->self_hosted가 rename됐거나
 * 완전히 다른 저장소로 바뀐 경우) 지우고 재생성한다. */
async function getOrCreateEntry(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
): Promise<PersistentEntry> {
  const expectedUrl = remoteUrlFor(apiBaseUrl, target);

  let entryPromise = persistentByProject.get(projectId);
  if (!entryPromise) {
    entryPromise = createPersistentRepo(projectId, apiBaseUrl, target, identity, checkEmpty);
    persistentByProject.set(projectId, entryPromise);
  }
  let entry = await entryPromise;

  const storedBase = new URL(entry.originUrl);
  storedBase.username = "";
  storedBase.password = "";
  if (storedBase.toString().replace(/\/$/, "") !== expectedUrl.replace(/\/$/, "")) {
    entryPromise = createPersistentRepo(projectId, apiBaseUrl, target, identity, checkEmpty);
    persistentByProject.set(projectId, entryPromise);
    entry = await entryPromise;
  }

  return entry;
}

// 프로젝트당 쓰기 직렬화 - 같은 프로젝트에 대한 동시 커밋 요청이 같은
// 영구 클론을 동시에 건드리지 않게 한다(gitRepos.ts의 기존
// syncStateByProject와 같은 정신 - 단일 설치형이라 분산 락 불필요).
// **staleness 갱신(resyncToRemote)도 이 락을 탄다** - checkoutTree/
// createBranch/setHead로 워킹 디렉터리·인덱스·HEAD를 실제로 바꾸는
// 작업이라, 진행 중인 커밋(attempt())과 동시에 실행되면 서로의 상태를
// 덮어써 깨뜨릴 수 있다(실측으로 발견한 실제 버그: 저장 직후 읽기가
// 그 사이 도착한 staleness 갱신과 경합해 "파일을 찾을 수 없음"/이후
// 커밋이 계속 non-fast-forward로 실패하는 상태에 빠짐). 순수 읽기
// (ref→commit→tree→blob, staleness 갱신이 필요 없는 경우)는 이 락을
// 안 탄다 - stale 플래그가 없는 한 락 대기 자체가 없어야 쓰기와 읽기가
// 평소에 진짜로 동시에 진행된다는 이점이 유지된다.
const writeTailByProject = new Map<string, Promise<unknown>>();

function withWriteLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prevTail = writeTailByProject.get(projectId) ?? Promise.resolve();
  const result = prevTail.then(fn, fn);
  writeTailByProject.set(
    projectId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/** 읽기 전용 호출부가 쓴다 - stale 플래그가 없으면 락도 없이 그대로
 * 반환(평소 경로), 있으면 쓰기 락 안에서(진행 중인 커밋과 안전하게
 * 순서를 맞춰) 딱 한 번 갱신한다. attempt()(쓰기)는 이미 그 락 안에서
 * 실행 중이므로 이걸 쓰지 않고 직접 처리한다(같은 락을 또 얻으려 들면
 * 자기 자신을 기다리는 교착 상태가 됨). */
async function ensureFreshEntry(projectId: string, entry: PersistentEntry, identity: GitIdentity): Promise<PersistentEntry> {
  if (!staleByProject.has(projectId)) return entry;
  return withWriteLock(projectId, async () => {
    if (staleByProject.has(projectId)) {
      staleByProject.delete(projectId);
      await resyncToRemote(entry, identity).catch((err) => {
        console.error(`ensureFreshEntry(${projectId}) - staleness 갱신 실패(기존 로컬 상태로 계속 서빙):`, err);
      });
    }
    return entry;
  });
}

async function getPersistentRepo(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
): Promise<PersistentEntry> {
  const entry = await getOrCreateEntry(projectId, apiBaseUrl, target, identity, checkEmpty);
  return ensureFreshEntry(projectId, entry, identity);
}

async function attempt(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  changes: FileChangeOp[],
  message: string,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
  retriesLeft: number,
): Promise<ApplyResult> {
  // getPersistentRepo(락 안에서 staleness도 갱신)가 아니라
  // getOrCreateEntry만 쓴다 - attempt() 자체가 이미 applyChanges()의
  // withWriteLock 안에서 실행 중이라, 여기서 또 그 락을 얻으려 들면
  // 자기 자신을 기다리는 교착 상태가 된다. staleness는 아래에서 이미
  // 락을 쥔 채로 직접 처리.
  const entry = await getOrCreateEntry(projectId, apiBaseUrl, target, identity, checkEmpty);
  if (staleByProject.has(projectId)) {
    staleByProject.delete(projectId);
    await resyncToRemote(entry, identity).catch((err) => {
      console.error(`attempt(${projectId}) - staleness 갱신 실패(기존 로컬 상태로 계속 진행):`, err);
    });
  }
  const { repo, dir, branch } = entry;

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

  try {
    await repo.getRemote("origin").push([`refs/heads/${branch}:refs/heads/${branch}`], {
      credential: { type: "Plain", password: identity.token },
    });
    // 방금 우리가 직접 최신화했으니, 뒤이어 오는 셀프 웹훅으로 인한
    // 불필요한 재fetch를 막는다(로컬 상태는 이미 push한 것과 일치).
    staleByProject.delete(projectId);
  } catch (err) {
    if (retriesLeft > 0 && isNonFastForward(err)) {
      // 다른 설계자(또는 직접 push)가 그 사이 push했다는 뜻 - origin의
      // 새 tip으로 맞춘 뒤 같은 변경을 다시 적용해 재시도.
      await resyncToRemote(entry, identity);
      return attempt(projectId, apiBaseUrl, target, changes, message, identity, checkEmpty, retriesLeft - 1);
    }
    throw new Error(`커밋 충돌: 다른 설계자(또는 직접 push)가 동시에 이 저장소에 push했습니다 - 다시 시도하세요. (${errorMessage(err)})`);
  }

  const files = changes.map((c) => {
    if (c.changeType === "delete") return { path: c.path, sha: null };
    const entryAtPath = tree.getPath(c.path);
    return { path: c.path, sha: entryAtPath?.id() ?? null };
  });

  return { commitSha: commitOid, files };
}

/** 변경 배치를 영구 로컬 클론에서 커밋 하나로 만들어 Gitea에 push한다 -
 * gitea.ts의 changeFiles()가 REST 대신 이걸 호출하도록 위임한다.
 * checkEmpty는 이 프로젝트의 저장소가 커밋 0개인 빈 저장소인지 확인하는
 * 콜백(clone이 실패했을 때만 호출됨 - REST 등 무엇으로 확인하든
 * gitExec는 신경 안 씀, 호출부인 gitea.ts가 기존 getFullTree의 로직을
 * 그대로 재사용). */
export async function applyChanges(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  changes: FileChangeOp[],
  message: string,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
): Promise<ApplyResult> {
  return withWriteLock(projectId, () => attempt(projectId, apiBaseUrl, target, changes, message, identity, checkEmpty, 1));
}

export type PushExternalResult =
  | { status: "pushed"; commitSha: string }
  | { status: "diverged"; message: string }
  | { status: "failed"; message: string };

/** work(내부 Gitea) 영구 클론에 "external"이라는 두 번째 remote를
 * 추가/재사용해 외부(GitHub/GitLab) 저장소로 직접 push한다
 * (#git-publish-direct-push) - 별도 클론 없이 이미 있는 로컬 커밋
 * 히스토리를 그대로 쓴다. **일반(비강제) push** - Gitea의 push
 * mirror처럼 항상 강제 동기화하지 않으므로, fast-forward가 아니면
 * git 자신이 서버 사이드에서 원자적으로 거부한다(BR-3CAF6DBC가 막던
 * "외부가 독자적으로 앞서간 상태를 감지 못하고 강제 push해 외부
 * 커밋이 사라지는" 사고가 이제 구조적으로 불가능 - 예전의 사전 확인
 * 왕복이 이 안전성을 흉내내려던 우회책이었을 뿐).
 *
 * es-git의 Remote 객체에는 URL을 바꾸거나 remote를 지우는 메서드가
 * 없어서(실측 확인 - findRemote/createRemote만 있음), 토큰이 매번
 * 최신인지 보장하려고(자격증명 회전/OAuth 갱신 가능성) 이미 있는
 * remote면 `repo.config().setString("remote.external.url", ...)`로
 * git config를 직접 고쳐쓴다(`git remote set-url`과 동치) - 지우고
 * 새로 만드는 방식(Gitea REST push mirror가 PATCH 미지원이라 어쩔 수
 * 없이 쓰던 방식)이 필요 없다. */
export async function pushToExternal(
  projectId: string,
  apiBaseUrl: string,
  workTarget: GiteaRepoRef,
  externalRepoUrl: string,
  externalToken: string,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
): Promise<PushExternalResult> {
  return withWriteLock(projectId, async () => {
    const entry = await getOrCreateEntry(projectId, apiBaseUrl, workTarget, identity, checkEmpty);
    if (staleByProject.has(projectId)) {
      staleByProject.delete(projectId);
      await resyncToRemote(entry, identity).catch((err) => {
        console.error(`pushToExternal(${projectId}) - staleness 갱신 실패(기존 로컬 상태로 계속 진행):`, err);
      });
    }

    // 영구 클론은 읽기/쓰기 hot path를 빠르게 하려고 얕은(depth:1)
    // 클론이다(#git-persistent-local-clone) - 그 상태 그대로 완전히
    // 새로운 외부 저장소로 push하면 Gitea가 200 OK를 주면서도 실제로는
    // 오브젝트/ref를 하나도 못 받는 걸 실측으로 발견(로컬 역사가
    // 얕은 경계 커밋이라 push 협상에 필요한 전체 그래프를 못 보내는
    // 것으로 추정 - 에러 없이 조용히 실패해 특히 위험). publish는
    // 읽기/쓰기만큼 빈번하지 않으므로, 이 경로에서만 필요할 때(얕은
    // 상태일 때만) 전체 히스토리로 깊게 만든 뒤 진행한다.
    if (fs.existsSync(path.join(entry.dir, ".git", "shallow"))) {
      await entry.repo.getRemote("origin").fetch([entry.branch], { fetch: { depth: 2147483647 } });
    }

    const externalUrl = withCredentials(externalRepoUrl, externalToken);
    let remote = entry.repo.findRemote("external");
    if (!remote) {
      remote = entry.repo.createRemote("external", externalUrl);
    } else {
      entry.repo.config().setString("remote.external.url", externalUrl);
      remote = entry.repo.findRemote("external")!;
    }

    try {
      await remote.push([`refs/heads/${entry.branch}:refs/heads/${entry.branch}`], {
        credential: { type: "Plain", password: externalToken },
      });
    } catch (err) {
      if (isNonFastForward(err)) return { status: "diverged", message: errorMessage(err) };
      return { status: "failed", message: errorMessage(err) };
    }

    const commitSha = entry.repo.revparseSingle(`refs/heads/${entry.branch}`);
    return { status: "pushed", commitSha };
  });
}

// ---------------------------------------------------------------- 읽기

function resolveTreeAtRef(repo: Repository, branch: string, ref?: string): Tree | null {
  const spec = !ref || ref === "HEAD" ? `refs/heads/${branch}` : ref;
  let oid: string;
  try {
    oid = repo.revparseSingle(spec);
  } catch {
    return null;
  }
  const commit = repo.findCommit(oid);
  return commit ? commit.tree() : null;
}

function blobAtPath(repo: Repository, tree: Tree, filePath: string): { content: Buffer; sha: string } | null {
  const entry = tree.getPath(filePath);
  if (!entry) return null;
  const blob = entry.toObject(repo).peelToBlob();
  return { content: Buffer.from(blob.content()), sha: entry.id() };
}

/** es-git의 *Iter 클래스들(TreeIter 등)은 `next()`만 타입에 노출돼
 * 있고 `[Symbol.iterator]`는 (이 프로젝트 tsconfig의 lib 설정상)
 * 타입 체크를 못 통과해 `for...of`를 직접 못 쓴다 - `next()` 수동
 * 소진으로 배열화. */
function iterAll<T>(iter: { next(): IteratorResult<T, unknown> }): T[] {
  const out: T[] = [];
  for (let r = iter.next(); !r.done; r = iter.next()) out.push(r.value);
  return out;
}

function collectBlobs(repo: Repository, tree: Tree, prefix: string, out: FullTreeEntryLite[]): void {
  for (const e of iterAll(tree.iter())) {
    const p = prefix ? `${prefix}/${e.name()}` : e.name();
    const t = e.type();
    if (t === "Tree") collectBlobs(repo, repo.getTree(e.id()), p, out);
    else if (t === "Blob") out.push({ path: p, sha: e.id(), type: "blob" });
  }
}

export async function readFullTree(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
  ref?: string,
): Promise<FullTreeEntryLite[]> {
  const entry = await getPersistentRepo(projectId, apiBaseUrl, target, identity, checkEmpty);
  const tree = resolveTreeAtRef(entry.repo, entry.branch, ref);
  if (!tree) return [];
  const out: FullTreeEntryLite[] = [];
  collectBlobs(entry.repo, tree, "", out);
  return out;
}

/** dirPath="" 이면 루트 - 그 디렉터리의 즉시 자식만(파일+하위 폴더),
 * 재귀 아님(listTree()/Gitea Contents API와 같은 계약). */
export async function listDir(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
  dirPath: string,
  ref?: string,
): Promise<TreeEntryLite[]> {
  const entry = await getPersistentRepo(projectId, apiBaseUrl, target, identity, checkEmpty);
  const rootTree = resolveTreeAtRef(entry.repo, entry.branch, ref);
  if (!rootTree) return [];
  let tree = rootTree;
  if (dirPath) {
    const found = rootTree.getPath(dirPath);
    if (!found || found.type() !== "Tree") throw new Error(`${dirPath || "/"}는 디렉터리가 아닙니다`);
    tree = entry.repo.getTree(found.id());
  }
  const out: TreeEntryLite[] = [];
  for (const e of iterAll(tree.iter())) {
    const isDir = e.type() === "Tree";
    out.push({ name: e.name(), path: dirPath ? `${dirPath}/${e.name()}` : e.name(), type: isDir ? "dir" : "file" });
  }
  return out;
}

export async function readFile(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
  filePath: string,
  ref?: string,
): Promise<FileContentLite | null> {
  const entry = await getPersistentRepo(projectId, apiBaseUrl, target, identity, checkEmpty);
  const tree = resolveTreeAtRef(entry.repo, entry.branch, ref);
  if (!tree) return null;
  const found = blobAtPath(entry.repo, tree, filePath);
  if (!found) return null;
  return { path: filePath, content: found.content.toString("utf-8"), sha: found.sha };
}

export async function readFilesBatch(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
  paths: string[],
  ref?: string,
): Promise<Map<string, FileContentLite>> {
  const result = new Map<string, FileContentLite>();
  if (paths.length === 0) return result;
  const entry = await getPersistentRepo(projectId, apiBaseUrl, target, identity, checkEmpty);
  const tree = resolveTreeAtRef(entry.repo, entry.branch, ref);
  if (!tree) return result;
  for (const p of paths) {
    const found = blobAtPath(entry.repo, tree, p);
    if (found) result.set(p, { path: p, content: found.content.toString("utf-8"), sha: found.sha });
  }
  return result;
}

/** 미디어 미리보기/원본 다운로드용 - 디코드 없이 원본 바이트 그대로. */
export async function readFileRawBytes(
  projectId: string,
  apiBaseUrl: string,
  target: GiteaRepoRef,
  identity: GitIdentity,
  checkEmpty: () => Promise<boolean>,
  filePath: string,
  ref?: string,
): Promise<{ content: Buffer; sha: string } | null> {
  const entry = await getPersistentRepo(projectId, apiBaseUrl, target, identity, checkEmpty);
  const tree = resolveTreeAtRef(entry.repo, entry.branch, ref);
  if (!tree) return null;
  return blobAtPath(entry.repo, tree, filePath);
}
