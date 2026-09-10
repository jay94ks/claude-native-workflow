import fs from "node:fs";
import path from "node:path";
import type { DocMeta } from "./types.js";
import { docsDir } from "./paths.js";
import { parseFrontmatter } from "./frontmatter.js";

// Plain filesystem reads with no caching - the layer both docstore.ts (the
// read gate + write paths) and validate.ts (whole-tree validation) build on,
// kept dependency-free so the two don't form an import cycle.

export function iterDocFiles(): string[] {
  const d = docsDir();
  if (!fs.existsSync(d)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const stem = entry.name.replace(/\.md$/, "");
        if (stem === "index" || entry.name === "PROTOCOL.md") continue;
        out.push(full);
      }
    }
  };
  walk(d);
  return out.sort();
}

export function readDocSync(absPath: string): { text: string; meta: DocMeta; body: string } {
  // QA로 발견: 이 저장소의 실제 Windows 체크아웃(core.autocrlf=true)은
  // docs/*.md를 CRLF로 풀어놓는다. 아래 pending-질문/헤딩 정규식들은 전부
  // `^...$`/`.`를 줄 단위로 쓰는데, JS의 `.`는 \r을 소비하지 않고 비-멀티라인
  // `$`도 줄 끝의 \r 앞에서는 멈추지 않는다 - 그 결과 CRLF로 끝나는 모든 줄이
  // "- [ ] (Qn) ..." 패턴이든 "## 제목" 헤딩이든 전혀 매치되지 않는다
  // (scanPendingInText/PENDING_LINE_RE, reply.ts의 답변 대상 질문 탐색
  // 정규식, extractSection의 헤딩 탐색까지 전부 영향받음 - 직접 재현: CRLF
  // 입력에서 scanPendingInText가 빈 배열을 반환하는 걸 확인). 파이썬 구현은
  // `.`이 \r을 소비해서 원래 영향이 없다. 여러 정규식을 개별적으로 고치는
  // 대신, 모든 본문 읽기가 지나가는 이 한 지점에서 CRLF를 LF로 정규화해
  // 하위 로직 전체가 LF만 다루게 한다.
  const text = fs.readFileSync(absPath, "utf-8").replace(/\r\n/g, "\n");
  const { meta, body } = parseFrontmatter(text);
  return { text, meta, body };
}
