import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

// Tier 2's CLI/API/MCP entry points are all "one process = one project" -
// setProjectRoot() at startup was a plain module-level variable there, which
// is fine for that. Tier 3's multi-tenant API (PL-00001 3단계) serves many
// projects from one process concurrently, so "the current project root"
// needs to be per-request, not process-global - a second request for a
// different project could otherwise overwrite the root mid-flight while the
// first request's async chain (a git call, a Prisma query) is still using
// it. AsyncLocalStorage gives every async call chain its own isolated
// value without changing any of docstore.ts/create.ts/etc.'s call sites -
// they all just call getProjectRoot()/docsDir() as before.

const rootStorage = new AsyncLocalStorage<string>();
let fallbackRoot = process.cwd();

/** Tier 2 usage (CLI/API/MCP, one project per process): sets the root for
 * the rest of this async context and beyond (enterWith - no wrapping
 * callback needed, since these callers just run everything after this). */
export function setProjectRoot(root: string): void {
  fallbackRoot = path.resolve(root);
  rootStorage.enterWith(fallbackRoot);
}

/** Tier 3 usage (multi-project API): scopes `root` to exactly the async
 * chain started by `fn` (typically "the rest of this one HTTP request"),
 * so concurrent requests for different projects never see each other's
 * root. */
export function runWithProjectRoot<T>(root: string, fn: () => T): T {
  return rootStorage.run(path.resolve(root), fn);
}

export function getProjectRoot(): string {
  return rootStorage.getStore() ?? fallbackRoot;
}

export function docsDir(): string {
  return path.join(getProjectRoot(), "docs");
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
