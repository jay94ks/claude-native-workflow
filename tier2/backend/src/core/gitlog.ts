import { simpleGit } from "simple-git";
import { getProjectRoot, docsDir, resolveInDocs } from "./paths.js";

// SP-00003 2절 git 이력/diff/blame(읽기 전용) - Tier 1의 subprocess 기반
// git_log/git_commit_detail/git_diff/git_blame과 동일한 정보를 simple-git으로
// 제공한다(포맷 문자열을 직접 파싱하는 대신 simple-git의 구조화된 log()를
// 씀 - Node 쪽엔 이미 있는 의존성이라 굳이 직접 파싱할 이유가 없음).

function git() {
  return simpleGit(getProjectRoot());
}

export interface CommitSummary {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export async function gitLog(relPath?: string, limit = 30): Promise<CommitSummary[]> {
  const options: { maxCount: number; file?: string } = { maxCount: limit };
  if (relPath) options.file = resolveInDocs(relPath);
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
    raw = await git().show(["--stat", "--pretty=format:%H|%an|%ad|%s", "--date=iso", sha]);
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
  return git().raw(["blame", "--date=short", "--", resolveInDocs(relPath)]);
}
