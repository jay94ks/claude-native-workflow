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
  const text = fs.readFileSync(absPath, "utf-8");
  const { meta, body } = parseFrontmatter(text);
  return { text, meta, body };
}
