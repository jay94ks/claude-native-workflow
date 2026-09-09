import fs from "node:fs";
import path from "node:path";
import { docsDir, resolveInDocs } from "./paths.js";
import { readDocSync } from "./fsdocs.js";
import { dumpFrontmatter } from "./frontmatter.js";
import { nextSeq, today } from "./tracking.js";
import { NotFoundError } from "./docstore.js";
import { validateDoc } from "./validate.js";

export interface TransitionResult {
  dn_id: string;
  dn_path: string;
  pl_path: string;
}

/**
 * `PL -> DN` transition (docs/PROTOCOL.md 5절): a completed plan becomes a
 * new docs/done/DN-XXXXX.md (plan text + `report`), and the original
 * docs/plan/PL-XXXXX.md shrinks to a stub pointing at it rather than being
 * deleted (existing links must keep resolving).
 *
 * The stub keeps `created`/`updated`/`links` (pointed at the new DN) rather
 * than the bare 3-field `{id, type, status}` shown as a minimal illustration
 * in PROTOCOL.md 5절 - the full form is still schema-valid under 7절's
 * required-field rules, which the 3-field version isn't.
 */
export function transitionDone(planId: string, report: string): TransitionResult {
  const planPath = resolveInDocs(`plan/${planId}.md`);
  if (!fs.existsSync(planPath)) {
    throw new NotFoundError(`plan/${planId}.md`);
  }
  const { meta: planMeta, body: planBody } = readDocSync(planPath);
  if (planMeta.type !== "PL") {
    throw new Error(`${planId}는 PL 타입이 아닙니다`);
  }

  const dnId = nextSeq("DN");
  const dnPath = resolveInDocs(`done/${dnId}.md`);
  fs.mkdirSync(path.dirname(dnPath), { recursive: true });
  const dnMeta = {
    id: dnId,
    type: "DN",
    title: planMeta.title ?? planId,
    created: today(),
    updated: today(),
    links: [planId, ...((planMeta.links as unknown as string[]) ?? [])],
  };
  const dnBody =
    `# ${dnId} ${dnMeta.title}\n\n` +
    `계획 원문: [${planId}](../plan/${planId}.md)\n\n` +
    `## 계획 원문\n\n${planBody.trim()}\n\n` +
    `## 결과 보고\n\n${report.trim()}\n`;

  const dnViolations = validateDoc(dnPath, dnMeta);
  if (dnViolations.length) {
    throw new Error("검증 실패(DN): " + dnViolations.map((v) => v.message).join("; "));
  }
  fs.writeFileSync(dnPath, dumpFrontmatter(dnMeta, dnBody), "utf-8");

  const stubMeta = {
    id: planId,
    type: "PL",
    title: planMeta.title ?? planId,
    status: "done",
    created: planMeta.created ?? today(),
    updated: today(),
    links: [dnId],
  };
  const stubBody = `# (완료됨) → [${dnId}](../done/${dnId}.md) 참조\n`;
  const stubViolations = validateDoc(planPath, stubMeta);
  if (stubViolations.length) {
    throw new Error("검증 실패(PL 스텁): " + stubViolations.map((v) => v.message).join("; "));
  }
  fs.writeFileSync(planPath, dumpFrontmatter(stubMeta, stubBody), "utf-8");

  removeFromPlanIndex(planId);

  return { dn_id: dnId, dn_path: `done/${dnId}.md`, pl_path: `plan/${planId}.md` };
}

function removeFromPlanIndex(planId: string): void {
  const indexPath = path.join(docsDir(), "plan", "index.md");
  if (!fs.existsSync(indexPath)) return;
  const text = fs.readFileSync(indexPath, "utf-8");
  const lines = text.split("\n").filter((line) => !(line.startsWith("|") && line.includes(`[${planId}]`)));
  fs.writeFileSync(indexPath, lines.join("\n"), "utf-8");
}
