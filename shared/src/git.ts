import { execFileSync } from "child_process";

/**
 * CLI가 실행되는 디렉터리의 로컬 git 상태를 읽는다 (design-notes.md
 * "git 연동" - "CLI/MCP - 로컬 git 저장소의 현재 상태를 자동으로
 * 인식해서 채운다"). git 저장소가 아니거나 커밋이 하나도 없으면 null.
 */
export function detectLocalGit(cwd: string = process.cwd()): { branch: string; commitId: string } | null {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const commitId = execFileSync("git", ["rev-parse", "HEAD"], { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (!branch || !commitId || branch === "HEAD") return null; // detached HEAD도 이번 스코프에선 스킵
    return { branch, commitId };
  } catch {
    return null; // git 저장소가 아니거나, 커밋이 하나도 없음
  }
}
