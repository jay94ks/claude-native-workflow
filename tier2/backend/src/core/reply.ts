import fs from "node:fs";
import { resolveInDocs, isInsideDocs } from "./paths.js";
import { readDocSync } from "./fsdocs.js";
import { dumpFrontmatter } from "./frontmatter.js";
import { nextSeq, today } from "./tracking.js";
import { findLgByTarget, rebuildLogsIndex, rebuildReplyIndex, NotFoundError } from "./docstore.js";
import type { DocMeta } from "./types.js";

const PENDING_ANY_RE = /^- \[ \] \(Q\d+\) .+$/m;

export interface AnswerResult {
  rp_id: string;
  lg_id: string;
  reply_pending: boolean;
}

/**
 * Answer one (Qn) item of a DC/RV/FX document (docs/PROTOCOL.md 6절).
 *
 * RP is not a separate file: the answer is recorded as a `### RP-XXXXX`
 * entry inside the target document's own "## 답변 기록" section, so
 * answering N questions on one document never creates more than that one
 * file. LG stays one file per target document (find-or-create), linking to
 * that in-page anchor instead of a separate RP file - ported 1:1 from
 * tier1/tools/docs/server.py's answer_pending.
 */
export function answerPending(docPathRel: string, questionId: string, answerText: string): AnswerResult {
  const docPath = resolveInDocs(docPathRel);
  if (!isInsideDocs(docPath) || !fs.existsSync(docPath)) {
    throw new NotFoundError(docPathRel);
  }

  const { meta, body } = readDocSync(docPath);
  const pattern = new RegExp(`^- \\[ \\] \\(Q${questionId}\\) (.+)$`, "m");
  const m = pattern.exec(body);
  if (!m) {
    throw new Error("질문을 찾을 수 없거나 이미 답변되었습니다");
  }
  const questionText = m[1];

  const docId = (meta.id as string) ?? docPath.split(/[/\\]/).pop()!.replace(/\.md$/, "");
  const qTag = `Q${questionId}`;

  const rpId = nextSeq("RP");
  const rpAnchor = rpId.toLowerCase();

  const newLine = `- [x] (Q${questionId}) ${questionText} → [${rpId}](#${rpAnchor})`;
  let newBody = body.slice(0, m.index) + newLine + body.slice(m.index + m[0].length);

  const remaining = PENDING_ANY_RE.test(newBody);

  const record =
    `\n### ${rpId}\n\n` +
    `- 질문 ID: ${qTag}\n` +
    `- 답변일: ${today()}\n\n` +
    `**질문**\n\n${questionText}\n\n` +
    `**답변**\n\n${answerText}\n`;

  if (!newBody.includes("## 답변 기록")) {
    newBody = newBody.replace(/\n+$/, "") + "\n\n## 답변 기록\n" + record;
  } else {
    newBody = newBody.replace(/\n+$/, "") + "\n" + record;
  }

  meta.reply_pending = remaining;
  meta.updated = today();
  if (!remaining && meta.status === "open") {
    meta.status = "answered";
  }
  fs.writeFileSync(docPath, dumpFrontmatter(meta, newBody), "utf-8");

  const found = findLgByTarget(docId);
  let lgPath: string;
  let lgMeta: DocMeta;
  let lgBody: string;
  let lgId: string;
  if (!found) {
    lgId = nextSeq("LG");
    lgPath = resolveInDocs(`logs/${lgId}.md`);
    lgMeta = {
      id: lgId, type: "LG", target: docId,
      question_ids: [] as string[], created: today(), updated: today(),
    };
    lgBody = `# ${lgId}\n\n- 대상 문서: [${docId}](../${docPathRel})\n`;
  } else {
    lgPath = found.path;
    lgMeta = found.meta;
    lgBody = found.body;
    lgId = lgMeta.id as string;
    if (!Array.isArray(lgMeta.question_ids)) lgMeta.question_ids = [];
  }

  const qids = lgMeta.question_ids as unknown as string[];
  if (!qids.includes(qTag)) qids.push(qTag);
  lgMeta.updated = today();
  lgBody +=
    `- 처리 내용: \`${docPathRel}\`의 (${qTag}) 항목에 답변 반영 → ` +
    `[${rpId}](../${docPathRel}#${rpAnchor}), 상태 갱신.\n`;
  fs.writeFileSync(lgPath, dumpFrontmatter(lgMeta, lgBody), "utf-8");

  rebuildReplyIndex();
  rebuildLogsIndex();

  return { rp_id: rpId, lg_id: lgId, reply_pending: remaining };
}
