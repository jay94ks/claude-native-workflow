import type { DocMeta, Violation } from "./types.js";
import { rel } from "./paths.js";
import { iterDocFiles, readDocSync } from "./fsdocs.js";

// SP-00003 7절: hand-coded rules mirroring docs/PROTOCOL.md 3절, ported
// 1:1 from tier1/tools/docs/server.py's validate_doc/validate_all so both
// engines judge the same fixtures the same way (7.4 정합성 원칙). A formal
// schemas/*.schema.json + ajv pass is follow-up work, not needed for the
// two engines that exist today to stay in agreement.

const STATUS_ENUM: Record<string, Set<string>> = {
  SP: new Set(["draft", "active", "superseded", "archived"]),
  DS: new Set(["draft", "active", "superseded", "archived"]),
  RM: new Set(["draft", "active", "superseded", "archived"]),
  TP: new Set(["draft", "active", "superseded", "archived"]),
  PL: new Set(["planned", "in_progress", "done"]),
  DC: new Set(["open", "answered", "applied", "rejected", "wontfix"]),
  RV: new Set(["open", "answered", "applied", "rejected", "wontfix"]),
  FX: new Set(["open", "answered", "applied", "rejected", "wontfix"]),
};
const ID_RE = /^[A-Z]{2}-\d{5}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDoc(absPath: string, meta: DocMeta): Violation[] {
  const violations: Violation[] = [];
  const add = (field: string, rule: string, message: string) => {
    violations.push({ path: rel(absPath), field, rule, message });
  };

  const docId = meta.id;
  const stem = path_stem(absPath);
  if (!docId) {
    add("id", "required", "id 필드가 없습니다");
  } else {
    if (!ID_RE.test(String(docId))) {
      add("id", "pattern", `id 형식이 TYPE-00000이 아닙니다: ${docId}`);
    }
    if (docId !== stem) {
      add("id", "consistency", `id(${docId})가 파일명(${stem})과 다릅니다`);
    }
  }

  if (!meta.type) {
    add("type", "required", "type 필드가 없습니다");
  }

  for (const field of ["created", "updated"] as const) {
    const val = meta[field];
    if (!val) {
      add(field, "required", `${field} 필드가 없습니다`);
    } else if (!DATE_RE.test(String(val))) {
      add(field, "pattern", `${field} 값이 YYYY-MM-DD 형식이 아닙니다: ${val}`);
    }
  }

  const docType = meta.type;
  if (docType && STATUS_ENUM[docType]) {
    const status = meta.status;
    if (!status) {
      add("status", "required", "status 필드가 없습니다");
    } else if (!STATUS_ENUM[docType].has(String(status))) {
      add("status", "enum", `status 값 '${status}'는 ${docType} 타입에서 허용되지 않습니다`);
    }
  }

  const links = meta.links;
  if (links !== undefined) {
    if (!Array.isArray(links)) {
      add("links", "type", "links는 배열이어야 합니다");
    } else {
      for (const link of links) {
        if (!ID_RE.test(String(link))) {
          add("links", "pattern", `links 항목 형식이 잘못됨: ${link}`);
        }
      }
    }
  }

  return violations;
}

function path_stem(absPath: string): string {
  const base = absPath.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.md$/, "");
}

export function validateAll(): Violation[] {
  const violations: Violation[] = [];
  for (const p of iterDocFiles()) {
    const { meta } = readDocSync(p);
    violations.push(...validateDoc(p, meta));
  }
  return violations;
}
