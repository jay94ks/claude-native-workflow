import fs from "node:fs";
import path from "node:path";
import { docsDir } from "./paths.js";
import { dumpFrontmatter } from "./frontmatter.js";
import { nextSeq, today } from "./tracking.js";
import { validateDoc } from "./validate.js";
import { invalidateCache, rebuildReplyIndex } from "./docstore.js";
import { afterWrite } from "./git.js";
import type { DocMeta } from "./types.js";

// Type -> docs/<folder>/ mapping (tier1/docs/index.md 1절의 타입 분류표와 동일).
// IX/RP are excluded: IX is docs/index.md itself (no per-doc folder), RP has
// no file of its own (docs/PROTOCOL.md 6절 - answerPending in reply.ts owns it).
// reply.ts도 답변 처리 후 상태 갱신에 이 매핑을 그대로 재사용한다(export).
export const TYPE_FOLDER: Record<string, string> = {
  SP: "spec", PL: "plan", DN: "done", DS: "design", RM: "remind",
  TP: "temp", DC: "decision", RV: "review", FX: "fix", LG: "logs",
};

export interface CreateDocInput {
  type: string;
  title: string;
  links?: string[];
  status?: string;
}

export interface CreateDocResult {
  id: string;
  path: string;
}

const DEFAULT_STATUS: Record<string, string> = {
  SP: "draft", DS: "draft", RM: "draft", TP: "draft",
  PL: "planned", DC: "open", RV: "open", FX: "open",
};

/** `docs new <TYPE>` (SP-00001 4절) - mints the next tracking number, writes
 * a minimal frontmatter+body file, and appends a row to that type's
 * docs/<folder>/index.md (replacing the "아직 문서 없음" placeholder row if
 * that's still the only row). Rejects (no file written) if the resulting
 * frontmatter wouldn't pass `docs validate` (SP-00003 7.3절 - write paths
 * validate before writing). Auto-commits (and pushes, if push_mode is
 * immediate) via SP-00001 5절 git 자동화 - failures there don't undo the
 * write, callers can inspect the result if they care. */
export async function createDoc(input: CreateDocInput): Promise<CreateDocResult> {
  const folder = TYPE_FOLDER[input.type];
  if (!folder) {
    throw new Error(`알 수 없는 타입입니다: ${input.type}`);
  }
  const id = nextSeq(input.type);
  const dir = path.join(docsDir(), folder);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.md`);

  const meta: DocMeta = {
    id,
    type: input.type,
    title: input.title,
    status: input.status ?? DEFAULT_STATUS[input.type] ?? "draft",
    created: today(),
    updated: today(),
    links: input.links ?? [],
    reply_pending: false,
  };
  const body = `# ${id} ${input.title}\n`;

  const violations = validateDoc(filePath, meta);
  if (violations.length) {
    throw new Error("검증 실패: " + violations.map((v) => v.message).join("; "));
  }

  fs.writeFileSync(filePath, dumpFrontmatter(meta, body), "utf-8");
  appendIndexRow(folder, id, input.title, meta.status as string, meta.updated as string);
  // 새 문서 본문은 지금 항상 "## 답변 대기"가 없는 빈 제목뿐이라 당장은
  // 재생성해도 표가 안 바뀌지만, saveDocBody와 같은 이유로 문서 save/create
  // 양쪽 다 reply index를 최신으로 유지하는 쪽이 안전하다(추후 create 흐름이
  // 답변 대기 섹션을 포함한 본문을 받게 바뀌어도 이 지점에서 자동으로 맞는다).
  rebuildReplyIndex();

  await afterWrite(`docs: new ${id}`);
  return { id, path: `${folder}/${id}.md` };
}

function appendIndexRow(folder: string, id: string, title: string, status: string, updated: string): void {
  const indexPath = path.join(docsDir(), folder, "index.md");
  if (!fs.existsSync(indexPath)) return;
  const text = fs.readFileSync(indexPath, "utf-8");
  const row = `| [${id}](${id}.md) | ${title} | ${status} | ${updated} |`;
  const placeholderRe = /\|\s*_\(아직 문서 없음\)_\s*\|\s*\|\s*\|\s*\|/;
  let newText: string;
  if (placeholderRe.test(text)) {
    newText = text.replace(placeholderRe, row);
  } else if (text.includes("|---|---|---|---|")) {
    newText = text.replace("|---|---|---|---|", "|---|---|---|---|\n" + row);
  } else {
    newText = text.trimEnd() + "\n" + row + "\n";
  }
  fs.writeFileSync(indexPath, newText, "utf-8");
  invalidateCache(indexPath); // scanMeta already cached this from an earlier
  // tree/list read - without this, the next read sees a stale-vs-real diff
  // and logs a change_notice about our own write (SP-00003 5절 self-spam).
}

/** QA로 발견: answerPending()이 문서 자신의 프론트매터 status는
 * open→answered로 바꾸면서도, docs/<folder>/index.md의 해당 행은 그대로
 * 둬서(appendIndexRow는 "새로 만들 때" 한 번만 불림) 색인 표에서 계속 "open"
 * 으로 보이는 채 남는다 - 실제로 이 저장소 자신의 DC-00003/RV-00001이 둘 다
 * 답변된 뒤에도 docs/decision/index.md·docs/review/index.md에서 "open"으로
 * 표시된 채였다. docs/PROTOCOL.md 7절이 "관련 타입 색인에서 기존 문서를
 * 먼저 확인한다"고 못박고 있어, 이 색인이 stale하면 Claude가 이미 답변된
 * 결정을 다시 미답변으로 오인할 수 있다. id로 행을 찾아 status/updated
 * 칸만 갈아끼운다(제목은 보존) - appendIndexRow와 달리 CRLF에 영향받는
 * `^`/`$`/`.` 앵커를 전혀 안 써서 별도 정규화가 필요 없다. */
export function updateIndexRow(folder: string, id: string, status: string, updated: string): void {
  const indexPath = path.join(docsDir(), folder, "index.md");
  if (!fs.existsSync(indexPath)) return;
  const text = fs.readFileSync(indexPath, "utf-8");
  const rowRe = new RegExp(`\\|\\s*\\[${id}\\]\\([^)]*\\)\\s*\\|([^|]*)\\|[^|]*\\|[^|]*\\|`);
  const m = rowRe.exec(text);
  if (!m) return; // 색인에 이 id의 행이 없으면(있어야 정상이지만) 조용히 무시
  const title = m[1].trim();
  const newRow = `| [${id}](${id}.md) | ${title} | ${status} | ${updated} |`;
  const newText = text.slice(0, m.index) + newRow + text.slice(m.index + m[0].length);
  fs.writeFileSync(indexPath, newText, "utf-8");
  invalidateCache(indexPath);
}
