// 프로젝트별 내부 저장소 (design-notes.md "저장소(git) 관리" - 내부
// 저장소의 유지보수가 메인, 외부 push-mirror는 옵션). es-git(libgit2
// 바인딩)으로 로컬에 유지한다.
//
// Phase 5 판단: 실제 Gitea 서버로 저장소를 프로비저닝하는 건 프로젝트
// 생성 플로우(Phase 6+)가 갖춰진 뒤에나 의미가 있어서, 이번 라운드는
// "내부 저장소를 로컬에 유지하고 그 HEAD를 옵션 대상으로 push한다"는
// 메커니즘 자체만 구현한다 - Gitea 프로비저닝은 다음 라운드 과제로
// design-notes.md에 남긴다.

import * as fs from "fs";
import * as path from "path";
import {
  initRepository,
  openRepository,
  RevwalkSort,
  type Repository,
  type Tree,
  type BranchesItem,
  type TreeEntry,
  type DiffDelta,
} from "es-git";

const REPOS_ROOT = process.env.CNW_REPOS_ROOT ?? path.join(process.cwd(), "data", "repos");

function repoPath(projectId: string): string {
  return path.join(REPOS_ROOT, projectId);
}

async function ensureRepo(projectId: string): Promise<Repository> {
  const dir = repoPath(projectId);
  if (fs.existsSync(path.join(dir, ".git"))) {
    return openRepository(dir);
  }
  fs.mkdirSync(dir, { recursive: true });
  return initRepository(dir);
}

export interface CommitResult {
  branch: string;
  commitId: string;
}

/** 내부 저장소에 파일 하나를 쓰고 커밋한다 - 그 결과 branch/commit_id. */
export async function commitFile(
  projectId: string,
  relativePath: string,
  content: string,
  message: string,
  author: { name: string; email: string },
  targetBranch?: string
): Promise<CommitResult> {
  const repo = await ensureRepo(projectId);
  const dir = repoPath(projectId);

  // Code 탭에서 특정 브랜치에 커밋할 수 있게 된 이후(설계자 요청,
  // 2026-09-20) - 작업 디렉터리는 항상 HEAD가 가리키는 브랜치 내용을
  // 반영하므로, target이 지금 HEAD와 다르면 먼저 그 브랜치로 체크아웃
  // 해야 엉뚱한 브랜치의 트리 위에 파일을 얹는 사고를 막는다(mergeBranches
  // 에서 겪은 것과 같은 이유로 force 체크아웃 - 이 저장소는 우리 코드만
  // 건드리므로 더러운 상태는 항상 안전하게 버려도 되는 잔재뿐이다).
  if (targetBranch) {
    let currentHead: string | null = null;
    try {
      currentHead = repo.head().name();
    } catch {
      // 아직 커밋이 하나도 없는 새 저장소.
    }
    // currentHead가 null이면 아직 커밋이 하나도 없는 새 저장소라는 뜻 -
    // 이때는 브랜치 존재를 따질 필요 없이(어차피 아무 브랜치도 없다)
    // 그냥 첫 커밋을 만들면 그게 곧 기본 브랜치가 된다.
    if (currentHead !== null && currentHead !== `refs/heads/${targetBranch}`) {
      const ref = repo.findBranch(targetBranch, "Local");
      if (!ref) throw new Error(`"${targetBranch}" 브랜치를 찾을 수 없습니다.`);
      repo.setHead(`refs/heads/${targetBranch}`);
      repo.checkoutHead({ force: true });
    }
  }

  const filePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);

  const index = repo.index();
  index.addAll([relativePath]);
  index.write();
  const tree = repo.getTree(index.writeTree());

  // es-git의 commit()은 parents를 명시하지 않으면 매번 "부모 없음"으로
  // 취급한다 - 두 번째 커밋부터는 현재 HEAD를 parents[0]으로 명시해야
  // updateRef: "HEAD"가 "current tip is not the first parent" 없이 성공한다
  // (최초 커밋 전엔 HEAD가 없으므로 parents를 아예 생략).
  const parents: string[] = [];
  try {
    parents.push(repo.head().target()!);
  } catch {
    // 아직 커밋이 하나도 없는 새 저장소 - 첫 커밋은 parents 없이.
  }

  const commitId = repo.commit(tree, message, { author, updateRef: "HEAD", parents });

  return { branch: repo.head().name().replace(/^refs\/heads\//, ""), commitId };
}

/** 이 프로젝트 내부 저장소의 현재 HEAD - WEB UI가 "새 문서는 HEAD 기준"에 쓸 값(Phase 9에서 실제 연결). */
export async function getHead(projectId: string): Promise<CommitResult | null> {
  const dir = repoPath(projectId);
  if (!fs.existsSync(path.join(dir, ".git"))) return null;
  const repo = await openRepository(dir);
  try {
    const head = repo.head();
    return { branch: head.name().replace(/^refs\/heads\//, ""), commitId: head.target() ?? "" };
  } catch {
    return null; // 커밋이 아직 하나도 없는 새 저장소
  }
}

/**
 * repo.push - 내부 저장소를 옵션 push-mirror 대상으로 동기화한다.
 * (알려진 제약: es-git에 remote URL을 바꾸는 API가 없어서, 이미
 * "mirror"라는 이름의 remote가 있으면 URL이 바뀌었어도 기존 걸 그대로
 * 쓴다 - 프로젝트 설정에서 push-mirror 대상을 바꾸는 시나리오는 다음
 * 라운드에서 remote 재생성 방법을 찾아 보강한다.)
 */
export async function pushToMirror(projectId: string, mirrorUrl: string): Promise<void> {
  const repo = await ensureRepo(projectId);
  const remote = repo.findRemote("mirror") ?? repo.createRemote("mirror", mirrorUrl);

  const branch = repo.head().name().replace(/^refs\/heads\//, "");
  await remote.push([`refs/heads/${branch}:refs/heads/${branch}`]);
}

// ---------------------------------------------------------------------------
// Code/Pull requests 탭(설계자 요청, 2026-09-20) - 이미 있는 내부 저장소를
// 그대로 브라우징 대상으로 삼는다(외부 저장소 clone/캐싱은 스코프 밖으로
// 명시적으로 판단됨 - design-notes.md 기록 참고). "es-git으로 백엔드 내
// 캐시를 만들라"는 지시는 이 내부 저장소 자체(이미 로컬 디스크에 상시
// 존재)를 그 캐시로 재사용하는 것으로 해석했다 - 매 요청마다 새로
// clone/fetch하지 않고 이미 있는 로컬 워킹 카피를 그대로 읽는다는 점에서
// 그 자체가 캐시 역할을 한다.

/** es-git의 Branches/TreeIter/Deltas 등은 JS Iterable(Symbol.iterator)이 아니라
 * "next()만 있는" 이터레이터 프로토콜만 구현한다 - for..of가 타입 에러라 직접 드레인한다. */
function drain<T>(it: unknown): T[] {
  const iter = it as { next(): { value: T; done?: boolean } };
  const out: T[] = [];
  let step = iter.next();
  while (step && !step.done) {
    out.push(step.value);
    step = iter.next();
  }
  return out;
}

/** 저장소가 아직 없으면(커밋이 하나도 없는 새 프로젝트) null - 브라우징 액션은 이걸 "빈 저장소"로 다룬다. */
async function openRepoIfExists(projectId: string): Promise<Repository | null> {
  const dir = repoPath(projectId);
  if (!fs.existsSync(path.join(dir, ".git"))) return null;
  return openRepository(dir);
}

export interface BranchInfo {
  name: string;
  tipCommitId: string | null;
}

export async function listBranches(projectId: string): Promise<BranchInfo[]> {
  const repo = await openRepoIfExists(projectId);
  if (!repo) return [];
  const branches: BranchInfo[] = [];
  for (const b of drain<BranchesItem>(repo.branches({ type: "Local" }))) {
    const branch = repo.getBranch(b.name, "Local");
    branches.push({ name: b.name, tipCommitId: branch.referenceTarget() });
  }
  return branches;
}

function resolveTreeForBranch(repo: Repository, branch: string): Tree | null {
  const ref = repo.findBranch(branch, "Local");
  const tipOid = ref?.referenceTarget();
  if (!tipOid) return null;
  return repo.getCommit(tipOid).tree();
}

export interface TreeEntryInfo {
  name: string;
  type: "blob" | "tree" | "other";
  oid: string;
}

/** branch의 그 path(디렉터리) 위치에 있는 항목 목록 - path가 빈 문자열이면 루트. null이면 저장소/브랜치/경로가 없다는 뜻. */
export async function listTree(projectId: string, branch: string, dirPath: string): Promise<TreeEntryInfo[] | null> {
  const repo = await openRepoIfExists(projectId);
  if (!repo) return null;
  let tree = resolveTreeForBranch(repo, branch);
  if (!tree) return null;

  if (dirPath) {
    const entry = tree.getPath(dirPath);
    if (!entry || entry.type() !== "Tree") return null;
    tree = repo.getTree(entry.id());
  }

  const items: TreeEntryInfo[] = [];
  for (const entry of drain<TreeEntry>(tree.iter())) {
    const t = entry.type();
    items.push({ name: entry.name(), type: t === "Blob" ? "blob" : t === "Tree" ? "tree" : "other", oid: entry.id() });
  }
  return items;
}

export interface BlobContent {
  content: string;
  isBinary: boolean;
  size: number;
}

/** BLOB_SIZE_LIMIT보다 큰 파일은 내용을 실어주지 않는다(브라우저 UI 응답 비대화 방지). */
const BLOB_SIZE_LIMIT = 512 * 1024;

export async function readFile(projectId: string, branch: string, filePath: string): Promise<BlobContent | null> {
  const repo = await openRepoIfExists(projectId);
  if (!repo) return null;
  const tree = resolveTreeForBranch(repo, branch);
  if (!tree) return null;

  const entry = tree.getPath(filePath);
  if (!entry || entry.type() !== "Blob") return null;
  const blob = repo.getObject(entry.id()).peelToBlob();
  const size = Number(blob.size());
  if (blob.isBinary() || size > BLOB_SIZE_LIMIT) {
    return { content: "", isBinary: blob.isBinary(), size };
  }
  return { content: Buffer.from(blob.content()).toString("utf-8"), isBinary: false, size };
}

export interface CommitInfo {
  id: string;
  message: string;
  author: string;
  time: string;
}

export async function listCommits(projectId: string, branch: string, limit: number): Promise<CommitInfo[]> {
  const repo = await openRepoIfExists(projectId);
  if (!repo) return [];
  const ref = repo.findBranch(branch, "Local");
  const tipOid = ref?.referenceTarget();
  if (!tipOid) return [];

  const revwalk = repo.revwalk();
  revwalk.push(tipOid);
  revwalk.setSorting(RevwalkSort.Time);

  const commits: CommitInfo[] = [];
  let oid: string | null;
  while (commits.length < limit && (oid = revwalk.next()) !== null) {
    const commit = repo.getCommit(oid);
    commits.push({ id: oid, message: commit.summary() ?? commit.message(), author: commit.author().name, time: commit.time().toISOString() });
  }
  return commits;
}

export interface DiffFileInfo {
  path: string;
  oldPath: string | null;
  status: string;
}

export interface BranchDiff {
  files: DiffFileInfo[];
  patch: string;
}

/** base 브랜치 대비 head 브랜치가 바꾼 것 - Pull request 화면의 diff. */
export async function diffBranches(projectId: string, base: string, head: string): Promise<BranchDiff | null> {
  const repo = await openRepoIfExists(projectId);
  if (!repo) return null;
  const baseTree = resolveTreeForBranch(repo, base);
  const headTree = resolveTreeForBranch(repo, head);
  if (!baseTree || !headTree) return null;

  const diff = repo.diffTreeToTree(baseTree, headTree);
  const files: DiffFileInfo[] = [];
  for (const delta of drain<DiffDelta>(diff.deltas())) {
    files.push({ path: delta.newFile().path() ?? "", oldPath: delta.oldFile().path(), status: delta.status() });
  }
  const patch = diff.print({ format: "Patch" });
  return { files, patch };
}

/**
 * source를 target으로 머지한다 - 충돌 없으면 실제로 머지 커밋을 만들어
 * target 브랜치에 반영, 있으면 커밋하지 않고 conflict만 알린다(수동 해소는
 * 이번 스코프 밖 - design-notes.md에 계획으로 남긴다).
 */
export async function mergeBranches(
  projectId: string,
  source: string,
  target: string,
  message: string,
  author: { name: string; email: string }
): Promise<{ ok: true; commitId: string } | { ok: false; reason: string }> {
  const repo = await openRepoIfExists(projectId);
  if (!repo) return { ok: false, reason: "저장소가 아직 없습니다." };

  const sourceRef = repo.findBranch(source, "Local");
  const targetRef = repo.findBranch(target, "Local");
  const sourceOid = sourceRef?.referenceTarget();
  const targetOid = targetRef?.referenceTarget();
  if (!sourceOid || !targetOid) return { ok: false, reason: "source/target 브랜치를 찾을 수 없습니다." };

  // 실기동 중 발견한 버그 1: repo.mergeCommits()가 돌려주는 Index는 "순수
  // 인메모리" 결과라 repo.commit()에 필요한 writeTree()를 호출하면
  // "the index file is not backed up by an existing repository" 에러로
  // 크래시한다(es-git 문서: "The index instance ... needs to be
  // associated to an existing repository"). 대신 HEAD를 target 브랜치로
  // 옮기고 repo.merge()로 저장소의 **실제** 인덱스/워킹 디렉터리에 머지한
  // 뒤 그 index.writeTree()를 쓴다.
  //
  // 실기동 중 발견한 버그 2: 이 저장소에 뭔가 staged/uncommitted 상태가
  // 남아있으면(예: 이전 작업이 중간에 실패해서 그대로 남은 경우)
  // repo.merge()가 "conflict prevents checkout" 네이티브 예외를 던지며
  // **백엔드 프로세스 전체를 크래시**시켰다 - 이 내부 저장소는 오직
  // commitFile()/mergeBranches() 두 경로로만 써지므로, 사람이 직접 만질
  // 일이 없고 더러운 상태는 항상 "이전 작업의 잔재"일 뿐이다 - 시작 전에
  // 무조건 현재 HEAD 기준으로 강제 초기화한다. 또한 병합 과정 자체를
  // try/catch로 감싸서, 그래도 실패하면(알 수 없는 libgit2 에러 등)
  // 프로세스를 죽이는 대신 이 요청만 정상적인 실패 응답으로 돌려준다.
  const sourceCommit = repo.getCommit(sourceOid);
  try {
    const currentHead = repo.head().name();
    if (currentHead !== `refs/heads/${target}`) {
      repo.setHead(`refs/heads/${target}`);
    }
    repo.checkoutHead({ force: true }); // 항상 강제 초기화 - 더러운 상태를 남겨두지 않는다.

    const annotated = repo.getAnnotatedCommit(sourceCommit);
    repo.merge([annotated]);
    const index = repo.index();
    if (index.hasConflicts()) {
      repo.cleanupState();
      repo.checkoutHead({ force: true });
      return { ok: false, reason: "충돌이 있어 자동 머지할 수 없습니다 - 수동 해소는 아직 지원하지 않습니다." };
    }

    const tree = repo.getTree(index.writeTree());
    const commitId = repo.commit(tree, message, {
      author,
      updateRef: "HEAD",
      parents: [targetOid, sourceOid],
    });
    repo.cleanupState();
    return { ok: true, commitId };
  } catch (err) {
    try {
      repo.cleanupState();
      repo.checkoutHead({ force: true });
    } catch {
      // 정리마저 실패해도 원래 에러를 정상 응답으로 돌려주는 게 우선이다.
    }
    return { ok: false, reason: `머지 중 오류가 발생했습니다: ${(err as Error).message}` };
  }
}
