import { execFileSync } from "node:child_process";
import { getLocalDb, nowIso } from "./localdb.js";
import { getProjectRoot, resolveInDocs } from "./paths.js";

// SP-00003 5절 변경 추적 큐 - 개별 이벤트(git_pull/webhook/api/comment)마다
// 따로 후킹하지 않고, 6절 읽기 게이트(docstore.ts의 scanMeta)가 "캐시와
// 실제 내용이 다르다"고 판단하는 순간 자동으로 여기에 쌓인다. "무엇이
// 바뀌었는지" 요약은 우리가 텍스트를 비교하는 대신 git에 위임한다.
// scanMeta는 동기 함수라 이것도 동기로 유지 - simple-git 대신 execFileSync를
// 쓰는 이유가 그것뿐(다른 git 조작은 비동기 simple-git).

export interface ChangeNotice {
  id: number;
  doc_path: string;
  source: string;
  summary: string;
  ref: string | null;
  created_at: string;
}

export function diffSummarySync(relPath: string): string {
  const target = resolveInDocs(relPath);
  const root = getProjectRoot();
  const tryDiff = (args: string[]): string | null => {
    try {
      const out = execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();
      return out ? out.split("\n")[0] : null;
    } catch {
      return null;
    }
  };
  return (
    // 1) 커밋 안 된 변경(직접 손 편집) - 워킹트리 vs 인덱스
    tryDiff(["diff", "--stat", "--", target]) ??
    // 2) 스테이징된 변경
    tryDiff(["diff", "--cached", "--stat", "--", target]) ??
    // 3) git pull 직후처럼 워킹트리==HEAD라 1·2가 둘 다 빈 경우 - 마지막
    //    커밋이 이 파일을 어떻게 바꿨는지(가장 흔한 실제 원인)
    tryDiff(["diff", "--stat", "HEAD~1", "HEAD", "--", target]) ??
    `${relPath} 내용이 변경됨`
  );
}

export function createChangeNotice(docPath: string, source: string, summary: string, ref?: string): void {
  const stmt = getLocalDb().prepare(
    "INSERT INTO change_notices (doc_path, source, summary, ref, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  stmt.run(docPath, source, summary, ref ?? null, nowIso());
}

export function listChangeNotices(): ChangeNotice[] {
  const stmt = getLocalDb().prepare(
    "SELECT id, doc_path, source, summary, ref, created_at FROM change_notices ORDER BY id",
  );
  return stmt.all() as unknown as ChangeNotice[];
}

export function ackChangeNotice(id: number): void {
  getLocalDb().prepare("DELETE FROM change_notices WHERE id = ?").run(id);
}
