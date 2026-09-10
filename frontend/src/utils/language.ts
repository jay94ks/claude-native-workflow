const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  html: "html",
  vue: "html",
  css: "css",
  scss: "scss",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  sh: "shell",
  sql: "sql",
  xml: "xml",
  toml: "ini",
  ini: "ini",
};

export function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_LANGUAGE[ext] ?? "plaintext";
}
