import fs from "node:fs";
import path from "node:path";
import { docsDir } from "./paths.js";

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nextSeq(docType: string): string {
  const tf = path.join(docsDir(), ".tracking.json");
  const data: Record<string, number> = fs.existsSync(tf)
    ? JSON.parse(fs.readFileSync(tf, "utf-8"))
    : {};
  const n = (data[docType] ?? 0) + 1;
  data[docType] = n;
  fs.writeFileSync(tf, JSON.stringify(data, null, 2) + "\n", "utf-8");
  return `${docType}-${String(n).padStart(5, "0")}`;
}
