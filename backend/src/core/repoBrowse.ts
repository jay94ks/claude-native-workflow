// Code 탭(설계자 요청, 2026-09-20) - 프로젝트의 내부 저장소(es-git)를
// 그대로 브라우징한다: 브랜치 목록/파일 트리/파일 내용/최근 커밋.
// 외부 저장소 clone/캐싱은 스코프 밖(design-notes.md 기록) - 이미 로컬에
// 있는 내부 저장소 자체가 "캐시" 역할이다.

import { requireMembership, MembershipError } from "./membership";
import {
  listBranches,
  listTree,
  readFile,
  listCommits,
  listCommitsForPath,
  getCommitInfo,
  commitFile,
  diffCommit,
  readFileAtRef,
  readBlobRawAtRef,
  isImagePath,
} from "./gitRepo";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

async function guardRead(projectId: unknown, ctx: ActionContext): Promise<ActionResult | null> {
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "READ");
    return null;
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }
}

async function guardWrite(projectId: unknown, ctx: ActionContext): Promise<ActionResult | null> {
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "WRITE");
    return null;
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }
}

export async function repoBranches(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const branches = await listBranches(payload.projectId);
  return { ok: true, data: { items: branches } };
}

export async function repoTree(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch, path } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");

  const entries = await listTree(projectId, branch, typeof path === "string" ? path : "");
  if (entries === null) return fail(`"${branch}" 브랜치의 "${path ?? ""}" 경로를 찾을 수 없습니다(저장소가 비어있을 수도 있습니다).`);
  return { ok: true, data: { path: path ?? "", items: entries } };
}

export async function repoFile(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch, path } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");
  if (typeof path !== "string" || !path) return fail("path가 필요합니다.");

  const file = await readFile(projectId, branch, path);
  if (file === null) return fail(`"${branch}"의 "${path}"를 찾을 수 없습니다.`);
  return { ok: true, data: file };
}

/** Code 탭의 "README.md 작성하기"(설계자 요청, 2026-09-20) - 임의 파일 하나를 특정 브랜치에 커밋한다. */
export async function repoWriteFile(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardWrite(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch, path, content, message } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");
  if (typeof path !== "string" || !path) return fail("path가 필요합니다.");
  if (typeof content !== "string") return fail("content가 필요합니다.");

  const author = { name: ctx.channel, email: `${ctx.channel}@cnw.local` };
  const result = await commitFile(projectId, path, content, typeof message === "string" && message ? message : `update ${path}`, author, branch);
  return { ok: true, data: result };
}

export async function repoCommits(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");
  const limit = typeof payload.limit === "number" && payload.limit > 0 ? Math.min(payload.limit, 100) : 30;

  const commits = await listCommits(projectId, branch, limit);
  return { ok: true, data: { items: commits } };
}

/** 특정 파일을 실제로 건드린 커밋만 - Code 탭 파일 뷰어의 "Recent Commits" 탭(설계자 요청, 2026-09-21). */
export async function repoFileCommits(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, branch, path } = payload;
  if (typeof branch !== "string" || !branch) return fail("branch가 필요합니다.");
  if (typeof path !== "string" || !path) return fail("path가 필요합니다.");
  const limit = typeof payload.limit === "number" && payload.limit > 0 ? Math.min(payload.limit, 100) : 30;

  const commits = await listCommitsForPath(projectId, branch, path, limit);
  return { ok: true, data: { items: commits } };
}

/** 커밋 하나의 메타데이터(메시지/작성자/시각)만 - CommitDiffPage 제목 표시용. */
export async function repoCommitInfo(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, commitId } = payload;
  if (typeof commitId !== "string" || !commitId) return fail("commitId가 필요합니다.");

  const info = await getCommitInfo(projectId, commitId);
  if (info === null) return fail(`커밋 "${commitId}"를 찾을 수 없습니다.`);
  return { ok: true, data: info };
}

/** 커밋 하나가 그 부모 대비 바꾼 것 - "최근 커밋" 화면(코드 탭/파일별 Recent Commits)에서 항목 클릭 시. */
export async function repoCommitDiff(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, commitId } = payload;
  if (typeof commitId !== "string" || !commitId) return fail("commitId가 필요합니다.");

  const diff = await diffCommit(projectId, commitId);
  if (diff === null) return fail(`커밋 "${commitId}"를 찾을 수 없습니다.`);
  return { ok: true, data: diff };
}

/**
 * 파일 하나의 두 시점(브랜치/커밋 어느 쪽이든) 내용을 나란히 - PR/커밋
 * diff 뷰어가 좌(변경 전)/우(변경 후) 분할 렌더링에 쓴다(설계자 요청,
 * 2026-09-21). 마크다운/코드 텍스트가 아니면(isBinary) 내용 대신
 * isImage로 프론트가 뭘 보여줄지 판단하게 하고, 이미지면 미리보기용
 * data URL을 base64로 같이 실어준다.
 */
export async function repoDiffFile(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const guardFailure = await guardRead(payload.projectId, ctx);
  if (guardFailure) return guardFailure;

  const { projectId, base, head, path } = payload;
  // base는 선택 - 최초 커밋(부모가 없음)의 diff에선 "이전 버전 자체가
  // 없다"는 뜻이라 CommitDiffPage가 빈 문자열을 보내는데, REST 계층의
  // 쿼리스트링 빌더가 빈 문자열 파라미터를 아예 생략해버려서(설계상
  // 의도된 동작) base가 undefined로 들어온다 - 필수값으로 막으면 안 되고
  // "그 시점 파일이 없었다"로 자연스럽게 처리해야 한다(아래 oldExists:false).
  if (typeof head !== "string" || !head) return fail("head가 필요합니다.");
  if (typeof path !== "string" || !path) return fail("path가 필요합니다.");

  const [oldFile, newFile] = await Promise.all([
    typeof base === "string" && base ? readFileAtRef(projectId, base, path) : Promise.resolve(null),
    readFileAtRef(projectId, head, path),
  ]);
  const isBinary = !!(oldFile?.isBinary || newFile?.isBinary);
  const isImage = isImagePath(path);

  let oldImage: string | null = null;
  let newImage: string | null = null;
  if (isBinary && isImage) {
    const [oldRaw, newRaw] = await Promise.all([
      typeof base === "string" && base ? readBlobRawAtRef(projectId, base, path) : Promise.resolve(null),
      readBlobRawAtRef(projectId, head, path),
    ]);
    oldImage = oldRaw?.dataUrl ?? null;
    newImage = newRaw?.dataUrl ?? null;
  }

  return {
    ok: true,
    data: {
      path,
      isBinary,
      isImage,
      oldExists: oldFile !== null,
      newExists: newFile !== null,
      oldContent: oldFile?.content ?? "",
      newContent: newFile?.content ?? "",
      oldImage,
      newImage,
    },
  };
}
