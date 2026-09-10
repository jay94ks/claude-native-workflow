import fs from "node:fs";
import path from "node:path";
import type {
  DocListItem, DocMeta, PendingItem, PendingQuestion, TreeNode,
} from "./types.js";
import { docsDir, rel, resolveInDocs, isInsideDocs } from "./paths.js";
import { dumpFrontmatter } from "./frontmatter.js";
import { today } from "./tracking.js";
import { iterDocFiles, readDocSync } from "./fsdocs.js";
import { validateDoc } from "./validate.js";
import { createChangeNotice, diffSummarySync } from "./changes.js";

export { iterDocFiles, readDocSync };

// ---------------------------------------------------------------- read gate (SP-00003 6.2)
//
// mtime+size checked in-memory cache: an unchanged file costs one stat()
// call, never a read+parse. On a real (non-cold-start) change it also files
// a change_notice (5절) - this is the single point where that happens, so
// every caller (tree/list/search today; git-pull/webhook handlers once they
// exist) gets it for free, mirroring tier1/tools/docs/server.py's scan_meta.
// Kept synchronous (execFileSync in changes.ts, not the async simple-git
// used elsewhere) so callers like buildTree's recursive walk don't need to
// become async just for this side effect.

interface CacheEntry {
  mtimeMs: number;
  size: number;
  meta: DocMeta;
  pending: PendingQuestion[];
}

// Keyed by absolute path, not the docs/-relative one - Tier 3 (PL-00001
// 3단계) runs one process serving many projects concurrently, and two
// different projects can easily both have e.g. "spec/SP-00001.md". A
// relative-path key would let them collide and show each other's cached
// content; an absolute path never does, with no other code needing to
// change (found by reasoning through Tier 3's concurrency model before
// building on top of it, not by hitting the collision live).
const metaCache = new Map<string, CacheEntry>();

export function scanMeta(absPath: string, source = "scan"): { meta: DocMeta; pending: PendingQuestion[] } {
  const key = path.resolve(absPath);
  const st = fs.statSync(absPath);
  const cached = metaCache.get(key);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return { meta: cached.meta, pending: cached.pending };
  }
  const wasCached = cached !== undefined;
  const { body, meta } = readDocSync(absPath);
  const pending = scanPendingInText(body);
  metaCache.set(key, { mtimeMs: st.mtimeMs, size: st.size, meta, pending });
  if (wasCached) {
    createChangeNotice(rel(absPath), source, diffSummarySync(rel(absPath)));
  }
  return { meta, pending };
}

/** Drops the cached entry (not "refresh to new content") so the next
 * scanMeta() sees a cold start rather than a diff - the write path already
 * knows what it just wrote, so there's nothing to compare against. This is
 * what stops a designer's own docs new/reply/transition-done from showing
 * up as a change_notice about itself the moment the dashboard re-reads it
 * (SP-00003 5절 "자기 알림 스팸 방지") - found missing (create/reply/
 * transition never called this) by actually clicking through the dashboard
 * and watching notices pile up on the doc being answered. */
export function invalidateCache(absPath: string): void {
  metaCache.delete(path.resolve(absPath));
}

// ---------------------------------------------------------------- pending questions

const PENDING_LINE_RE = /^- \[ \] \(Q(\d+)\) (.+)$/;
const OPTION_RE = /^\s+- (권장|대안): (.+)$/;

export function scanPendingInText(body: string): PendingQuestion[] {
  const lines = body.split("\n");
  const out: PendingQuestion[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = PENDING_LINE_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const [, qid, question] = m;
    const options: PendingQuestion["options"] = [];
    let j = i + 1;
    while (j < lines.length) {
      const om = OPTION_RE.exec(lines[j]);
      if (!om) break;
      options.push({ kind: om[1] as "권장" | "대안", text: om[2] });
      j++;
    }
    out.push({ qid, question, options });
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------- tree / list / search

export function buildTree(): TreeNode {
  const d = docsDir();

  const walk = (dirPath: string): TreeNode => {
    const node: TreeNode = { name: path.basename(dirPath), type: "dir", children: [] };
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return node;
    }
    entries.sort((a, b) => {
      const af = a.isFile() ? 1 : 0;
      const bf = b.isFile() ? 1 : 0;
      if (af !== bf) return af - bf;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        node.children!.push(walk(full));
      } else if (entry.name.endsWith(".md")) {
        const { meta, pending } = scanMeta(full);
        node.children!.push({
          name: entry.name,
          type: "file",
          path: rel(full),
          id: meta.id ?? entry.name.replace(/\.md$/, ""),
          title: meta.title ?? "",
          doc_type: meta.type ?? "",
          status: meta.status ?? "",
          // 프론트매터 reply_pending이 아니라 본문을 직접 스캔한 결과를 쓴다 -
          // QA로 발견: reply_pending 프론트매터는 답변 처리(/api/reply) 경로
          // 에서만 갱신되고, 문서를 새로 만들면서 "## 답변 대기" 섹션에 질문을
          // 바로 적어 넣는 경로(docs/PROTOCOL.md 4절)는 이 필드를 건드리지
          // 않는다 - 그래서 한 번도 답변된 적 없는 새 DC/RV/FX는 실제로 질문이
          // 있어도 프론트매터상 reply_pending이 계속 false로 남는다(이
          // 저장소 자신의 DC-00003/RV-00001에서 실제로 재현). 이미 계산해 둔
          // pending(본문 스캔 결과, listPending()이 쓰는 것과 같은 소스)이
          // 항상 정확하므로 그걸 신뢰한다.
          reply_pending: pending.length > 0,
        });
      }
    }
    return node;
  };

  return walk(d);
}

export function listPending(): PendingItem[] {
  const items: PendingItem[] = [];
  for (const p of iterDocFiles()) {
    const { meta, pending } = scanMeta(p);
    for (const { qid, question, options } of pending) {
      items.push({
        doc_path: rel(p),
        doc_id: meta.id ?? path.basename(p).replace(/\.md$/, ""),
        title: meta.title ?? "",
        question_id: qid,
        question,
        options,
        updated: meta.updated ?? meta.created ?? "",
      });
    }
  }
  return items;
}

export function listByTypes(types: Set<string>): DocListItem[] {
  const out: DocListItem[] = [];
  for (const p of iterDocFiles()) {
    const { meta, pending } = scanMeta(p);
    const t = meta.type ?? "";
    if (types.has(t)) {
      out.push({
        path: rel(p),
        id: meta.id ?? path.basename(p).replace(/\.md$/, ""),
        title: meta.title ?? "",
        type: t,
        status: meta.status ?? "",
        updated: meta.updated ?? "",
        // buildTree()와 같은 이유로 프론트매터가 아니라 본문 스캔 결과를 쓴다.
        reply_pending: pending.length > 0,
        target: meta.target ?? "",
      });
    }
  }
  out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return out;
}

export function slugify(text: string): string {
  let s = text.trim().toLowerCase();
  s = s.replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, "");
  s = s.replace(/\s+/g, "-");
  return s;
}

export function extractSection(body: string, anchor: string): string | null {
  const lines = body.split("\n");
  const headingRe = /^(#{1,6})\s+(.*)$/;
  let start = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (m && slugify(m[2]) === anchor) {
      start = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const m = headingRe.exec(lines[j]);
    if (m && m[1].length <= startLevel) {
      end = j;
      break;
    }
  }
  return lines.slice(start, end).join("\n").replace(/\n+$/, "");
}

export interface SearchResult {
  path: string;
  id: string;
  title: string;
  type: string;
  snippet: string;
}

export function searchDocs(query: string): SearchResult[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [];
  const results: SearchResult[] = [];
  for (const p of iterDocFiles()) {
    const { meta, body } = readDocSync(p);
    const haystack = `${meta.id ?? ""} ${meta.title ?? ""}\n${body}`.toLowerCase();
    const idx = haystack.indexOf(q);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 40);
    const snippet = haystack.slice(start, idx + q.length + 40).trim();
    results.push({
      path: rel(p),
      id: meta.id ?? path.basename(p).replace(/\.md$/, ""),
      title: meta.title ?? "",
      type: meta.type ?? "",
      snippet,
    });
  }
  return results;
}

// ---------------------------------------------------------------- index table regen

function rebuildTable(indexPath: string, rows: string[], header: [string, string]): void {
  const text = fs.readFileSync(indexPath, "utf-8");
  const lines = [header[0], header[1], ...(rows.length ? rows : ["| _(항목 없음)_ | | | |"])];
  const tableMd = lines.join("\n");
  const newText = text.replace(
    /(<!-- TABLE:START -->\n)([\s\S]*?)(\n<!-- TABLE:END -->)/,
    (_match, pre: string, _body: string, post: string) => pre + tableMd + post,
  );
  fs.writeFileSync(indexPath, newText, "utf-8");
  invalidateCache(indexPath); // this index.md was likely already cached from
  // an earlier tree/list read - drop it so our own regen doesn't show up as
  // a change_notice about itself on the next read (SP-00003 5절 self-spam).
}

export function rebuildReplyIndex(): void {
  const rows = listPending().map(
    (it) => `| [${it.doc_id}](../${it.doc_path}) | Q${it.question_id} | ${it.question} | ${it.updated} |`,
  );
  rebuildTable(
    path.join(docsDir(), "reply", "index.md"),
    rows,
    ["| 대상 문서 | 질문 ID | 질문 요약 | 등록일 |", "|---|---|---|---|"],
  );
}

export function rebuildLogsIndex(): void {
  const rows: string[] = [];
  const logsDir = path.join(docsDir(), "logs");
  if (fs.existsSync(logsDir)) {
    for (const name of fs.readdirSync(logsDir).filter((n) => n.startsWith("LG-") && n.endsWith(".md")).sort()) {
      const p = path.join(logsDir, name);
      const { meta } = readDocSync(p);
      const qids = ((meta.question_ids as unknown as string[]) ?? []).join(", ");
      rows.push(
        `| [${meta.id ?? name.replace(/\.md$/, "")}](${name}) | ${meta.target ?? ""} | ` +
          `${qids} | ${meta.updated ?? meta.created ?? ""} |`,
      );
    }
  }
  rebuildTable(
    path.join(docsDir(), "logs", "index.md"),
    rows,
    ["| 번호 | 대상 문서 | 답변된 질문 | 최근 처리일 |", "|---|---|---|---|"],
  );
}

export function findLgByTarget(docId: string): { path: string; meta: DocMeta; body: string } | null {
  const folder = path.join(docsDir(), "logs");
  if (!fs.existsSync(folder)) return null;
  for (const name of fs.readdirSync(folder).filter((n) => n.startsWith("LG-") && n.endsWith(".md")).sort()) {
    const p = path.join(folder, name);
    const { meta, body } = readDocSync(p);
    if (meta.target === docId) {
      return { path: p, meta, body };
    }
  }
  return null;
}

// ---------------------------------------------------------------- doc read / save

export class NotFoundError extends Error {
  constructor(relPath: string) {
    super(`not found: ${relPath}`);
    this.name = "NotFoundError";
  }
}

export function getDoc(relPath: string): { path: string; meta: DocMeta; body: string } | null {
  const p = resolveInDocs(relPath);
  if (!isInsideDocs(p) || !fs.existsSync(p)) return null;
  const { meta, body } = readDocSync(p);
  return { path: relPath, meta, body };
}

export function saveDocBody(relPath: string, newBody: string): { path: string; updated: string } {
  const p = resolveInDocs(relPath);
  if (!isInsideDocs(p) || !fs.existsSync(p)) {
    throw new NotFoundError(relPath);
  }
  const { meta } = readDocSync(p);
  meta.updated = today();
  const violations = validateDoc(p, meta);
  if (violations.length) {
    throw new Error("검증 실패: " + violations.map((v) => v.message).join("; "));
  }
  fs.writeFileSync(p, dumpFrontmatter(meta, newBody), "utf-8");
  invalidateCache(p);
  return { path: relPath, updated: meta.updated as string };
}
