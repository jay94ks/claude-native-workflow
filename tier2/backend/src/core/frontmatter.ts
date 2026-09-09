import type { DocMeta, FrontmatterValue } from "./types.js";

// Hand-rolled subset parser/dumper mirroring tier1/tools/docs/server.py's
// parse_frontmatter/dump_frontmatter exactly (same key: value / key: [a, b] /
// key: | block subset), not a general YAML library - the two tiers must
// agree on this exact format (SP-00003 7절 drift concern), and a full YAML
// parser would silently accept/emit things this narrower contract doesn't.

export function parseFrontmatter(text: string): { meta: DocMeta; body: string } {
  if (!text.startsWith("---")) {
    return { meta: {}, body: text };
  }
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") {
    return { meta: {}, body: text };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { meta: {}, body: text };
  }
  const fmLines = lines.slice(1, endIdx);
  let body = lines.slice(endIdx + 1).join("\n");
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  const meta: DocMeta = {};
  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i];
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) {
      i++;
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    if (val === "|" || val === "|-") {
      const block: string[] = [];
      i++;
      let baseIndent: number | null = null;
      while (i < fmLines.length) {
        const l = fmLines[i];
        if (l.trim() === "") {
          block.push("");
          i++;
          continue;
        }
        const indent = l.length - l.trimStart().length;
        if (baseIndent === null) baseIndent = indent;
        if (indent < baseIndent) break;
        block.push(l.slice(baseIndent));
        i++;
      }
      meta[key] = block.join("\n").replace(/\n+$/, "");
      continue;
    } else if (val.startsWith("[") && val.endsWith("]")) {
      meta[key] = val
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    } else if (val.toLowerCase() === "true" || val.toLowerCase() === "false") {
      meta[key] = val.toLowerCase() === "true";
    } else if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === "'" || val[0] === '"')) {
      meta[key] = val.slice(1, -1);
    } else {
      meta[key] = val;
    }
    i++;
  }
  return { meta, body };
}

export function dumpFrontmatter(meta: DocMeta, body: string): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    const value = v as FrontmatterValue;
    if (Array.isArray(value)) {
      lines.push(`${k}: [${value.join(", ")}]`);
    } else if (typeof value === "boolean") {
      lines.push(`${k}: ${value ? "true" : "false"}`);
    } else if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${k}: |`);
      for (const l of value.split("\n")) {
        lines.push(`  ${l}`);
      }
    } else {
      lines.push(`${k}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n" + body;
}
