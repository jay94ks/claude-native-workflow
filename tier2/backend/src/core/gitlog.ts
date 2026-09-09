import { simpleGit } from "simple-git";
import { getProjectRoot, docsDir, resolveInDocs, isInsideDocs } from "./paths.js";
import { NotFoundError } from "./docstore.js";

// SP-00003 2절 git 이력/diff/blame(읽기 전용) - Tier 1의 subprocess 기반
// git_log/git_commit_detail/git_diff/git_blame과 동일한 정보를 simple-git으로
// 제공한다(포맷 문자열을 직접 파싱하는 대신 simple-git의 구조화된 log()를
// 씀 - Node 쪽엔 이미 있는 의존성이라 굳이 직접 파싱할 이유가 없음).

function git() {
  return simpleGit(getProjectRoot());
}

// docs/ 밖 경로 접근을 막는 다른 모든 core 함수(getDoc/saveDocBody 등)와
// 같은 경계를 여기도 지켜야 한다 - 실제로 `git/blame?path=../../SECRET.txt`
// 로 docs/ 밖에 있는(같은 git 저장소 안의) 파일 내용을 그대로 읽어올 수
// 있는 걸 재현해서 발견(gitLog/gitBlame만 이 검사가 빠져 있었음 - QA
// 과정에서 찾은 진짜 취약점). viewer 권한만 있어도(Tier 3) 호출 가능한
// 읽기 전용 라우트라 실제 위험도가 높다.
function assertInsideDocs(relPath: string): string {
  const abs = resolveInDocs(relPath);
  if (!isInsideDocs(abs)) {
    throw new NotFoundError(relPath);
  }
  return abs;
}

export interface CommitSummary {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export async function gitLog(relPath?: string, limit = 30): Promise<CommitSummary[]> {
  const options: { maxCount: number; file?: string } = { maxCount: limit };
  if (relPath) options.file = assertInsideDocs(relPath);
  const result = await git().log(options);
  return result.all.map((c) => ({
    sha: c.hash, author: c.author_name, date: c.date.slice(0, 10), message: c.message,
  }));
}

export interface CommitDetail {
  sha: string;
  author: string;
  date: string;
  message: string;
  files: string[];
}

export async function gitCommitDetail(sha: string): Promise<CommitDetail | null> {
  let raw: string;
  try {
    // gitDiff와 같은 이유로 `-- docsDir()`을 붙인다 - 안 붙이면 그 커밋이
    // docs/ 밖 파일도 같이 바꿨을 때 그 파일명까지 "변경된 파일" 목록에
    // 새어나간다(내용은 아니지만 파일 경로 자체도 docs/ 밖 정보다).
    raw = await git().show(["--stat", "--pretty=format:%H|%an|%ad|%s", "--date=iso", sha, "--", docsDir()]);
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  if (!lines.length || !lines[0]) return null;
  const [shaOut, author, date, ...rest] = lines[0].split("|");
  const files = lines.slice(1).filter((l) => l.trim() && l.includes("|")).map((l) => l.trim());
  return {
    sha: shaOut ?? sha, author: author ?? "", date: date ?? "", message: rest.join("|") ?? "", files,
  };
}

export async function gitDiff(sha: string): Promise<string> {
  return git().show([sha, "--", docsDir()]);
}

export async function gitBlame(relPath: string): Promise<string> {
  return git().raw(["blame", "--date=short", "--", assertInsideDocs(relPath)]);
}
