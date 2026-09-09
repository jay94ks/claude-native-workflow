import path from "node:path";

let projectRoot = process.cwd();

export function setProjectRoot(root: string): void {
  projectRoot = path.resolve(root);
}

export function getProjectRoot(): string {
  return projectRoot;
}

export function docsDir(): string {
  return path.join(projectRoot, "docs");
}

export function rel(absPath: string): string {
  return path.relative(docsDir(), absPath).split(path.sep).join("/");
}

export function resolveInDocs(relPath: string): string {
  return path.resolve(docsDir(), relPath);
}

export function isInsideDocs(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  const base = path.resolve(docsDir());
  return resolved === base || resolved.startsWith(base + path.sep);
}
