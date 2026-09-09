import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { setProjectRoot, getProjectRoot } from "../core/paths.js";
import {
  buildTree, getDoc, saveDocBody, searchDocs, listPending, listByTypes,
  extractSection, NotFoundError,
} from "../core/docstore.js";
import { validateAll } from "../core/validate.js";
import { answerPending } from "../core/reply.js";
import { createDoc } from "../core/create.js";
import { transitionDone } from "../core/transition.js";
import { DESIGN_TYPES, TYPE_NAMES } from "../core/types.js";

function parseArgs(argv: string[]): { port: number; root: string } {
  let port = 8766;
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--root") root = argv[++i];
  }
  return { port, root };
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/tree", (_req, res) => {
    res.json(buildTree());
  });

  app.get("/api/pending", (_req, res) => {
    res.json(listPending());
  });

  app.get("/api/design", (_req, res) => {
    res.json(listByTypes(DESIGN_TYPES));
  });

  app.get("/api/logs", (_req, res) => {
    res.json(listByTypes(new Set(["LG"])));
  });

  app.get("/api/all", (_req, res) => {
    res.json(listByTypes(new Set(Object.keys(TYPE_NAMES).filter((t) => t !== "IX"))));
  });

  app.get("/api/search", (req, res) => {
    res.json(searchDocs(String(req.query.q ?? "")));
  });

  app.get("/api/validate", (_req, res) => {
    res.json(validateAll());
  });

  app.get("/api/doc", (req, res) => {
    const relPath = String(req.query.path ?? "");
    const anchor = req.query.anchor ? String(req.query.anchor) : undefined;
    const doc = getDoc(relPath);
    if (!doc) return res.status(404).json({ error: "not found" });
    if (anchor) {
      const section = extractSection(doc.body, anchor);
      if (section === null) return res.status(404).json({ error: "anchor not found" });
      return res.json({ path: doc.path, meta: doc.meta, body: section, anchor });
    }
    res.json(doc);
  });

  app.post("/api/doc/save", (req, res) => {
    const { path: relPath, body } = req.body as { path?: string; body?: string };
    if (!relPath || body === undefined) return res.status(400).json({ error: "path/body required" });
    res.json(saveDocBody(relPath, body));
  });

  app.post("/api/docs", (req, res) => {
    const { type, title, links, status } = req.body as {
      type?: string; title?: string; links?: string[]; status?: string;
    };
    if (!type || !title) return res.status(400).json({ error: "type/title required" });
    res.json(createDoc({ type, title, links, status }));
  });

  // path segments of a doc (e.g. decision/DC-00001.md) contain slashes, so
  // :path alone won't match - a RegExp route captures the whole thing.
  app.post(/^\/api\/docs\/(.+)\/reply$/, (req, res) => {
    const docPath = req.params[0];
    const { question_id, answer } = req.body as { question_id?: string | number; answer?: string };
    if (question_id === undefined || answer === undefined) {
      return res.status(400).json({ error: "question_id/answer required" });
    }
    res.json(answerPending(docPath, String(question_id), answer));
  });

  app.post("/api/plan/:id/transition-done", (req, res) => {
    const { report } = req.body as { report?: string };
    if (!report) return res.status(400).json({ error: "report required" });
    res.json(transitionDone(req.params.id, report));
  });

  // core throws plain Error/NotFoundError on bad input - all route handlers
  // above are synchronous, so Express 4 routes those throws here on its own.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  });

  return app;
}

function main() {
  const { port, root } = parseArgs(process.argv.slice(2));
  setProjectRoot(root);
  const app = createApp();
  app.listen(port, "127.0.0.1", () => {
    console.log(`tier2 backend: http://127.0.0.1:${port}  (root: ${path.resolve(getProjectRoot())})`);
  });
}

main();
