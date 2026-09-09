import fs from "node:fs";
import path from "node:path";
import { docsDir } from "./paths.js";
import { dumpFrontmatter } from "./frontmatter.js";
import { nextSeq, today } from "./tracking.js";
import { validateDoc } from "./validate.js";
import type { DocMeta } from "./types.js";

// Type -> docs/<folder>/ mapping (tier1/docs/index.md 1절의 타입 분류표와 동일).
// IX/RP are excluded: IX is docs/index.md itself (no per-doc folder), RP has
// no file of its own (docs/PROTOCOL.md 6절 - answerPending in reply.ts owns it).
const TYPE_FOLDER: Record<string, string> = {
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
 * validate before writing). */
export function createDoc(input: CreateDocInput): CreateDocResult {
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
}
