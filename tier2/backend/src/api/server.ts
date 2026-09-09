import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
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
import { pull as gitPull, push as gitPush, commitDocsChange, sync as gitSync } from "../core/git.js";
import { gitLog, gitCommitDetail, gitDiff, gitBlame } from "../core/gitlog.js";
import { listComments, addComment, resolveComment } from "../core/comments.js";
import { listChangeNotices, ackChangeNotice } from "../core/changes.js";

// Express 4 only forwards synchronous throws to the error middleware on its
// own - an async handler's rejected promise needs an explicit catch, or a
// failed git call would hang the request instead of producing a response.
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

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

  app.post("/api/docs", asyncRoute(async (req, res) => {
    const { type, title, links, status } = req.body as {
      type?: string; title?: string; links?: string[]; status?: string;
    };
    if (!type || !title) { res.status(400).json({ error: "type/title required" }); return; }
    res.json(await createDoc({ type, title, links, status }));
  }));

  // path segments of a doc (e.g. decision/DC-00001.md) contain slashes, so
  // :path alone won't match - a RegExp route captures the whole thing.
  app.post(/^\/api\/docs\/(.+)\/reply$/, asyncRoute(async (req, res) => {
    const docPath = req.params[0];
    const { question_id, answer } = req.body as { question_id?: string | number; answer?: string };
    if (question_id === undefined || answer === undefined) {
      res.status(400).json({ error: "question_id/answer required" }); return;
    }
    res.json(await answerPending(docPath, String(question_id), answer));
  }));

  app.post("/api/plan/:id/transition-done", asyncRoute(async (req, res) => {
    const { report } = req.body as { report?: string };
    if (!report) { res.status(400).json({ error: "report required" }); return; }
    res.json(await transitionDone(req.params.id, report));
  }));

  app.post("/api/git/pull", asyncRoute(async (_req, res) => {
    res.json(await gitPull());
  }));

  app.post("/api/git/commit", asyncRoute(async (req, res) => {
    const { message } = req.body as { message?: string };
    res.json(await commitDocsChange(message ?? "docs: manual commit"));
  }));

  app.post("/api/git/push", asyncRoute(async (_req, res) => {
    res.json(await gitPush());
  }));

  app.post("/api/git/sync", asyncRoute(async (req, res) => {
    const { message } = req.body as { message?: string };
    res.json(await gitSync(message));
  }));

  app.get("/api/git/log", asyncRoute(async (req, res) => {
    const relPath = req.query.path ? String(req.query.path) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    res.json(await gitLog(relPath, limit));
  }));

  app.get("/api/git/blame", asyncRoute(async (req, res) => {
    res.type("text/plain").send(await gitBlame(String(req.query.path ?? "")));
  }));

  app.get("/api/git/commits/:sha", asyncRoute(async (req, res) => {
    const detail = await gitCommitDetail(req.params.sha);
    if (!detail) { res.status(404).json({ error: "not found" }); return; }
    res.json(detail);
  }));

  app.get("/api/git/diff/:sha", asyncRoute(async (req, res) => {
    res.type("text/plain").send(await gitDiff(req.params.sha));
  }));

  // :path contains slashes (e.g. decision/DC-00001.md), same as the reply route.
  app.get(/^\/api\/docs\/(.+)\/comments$/, asyncRoute(async (req, res) => {
    res.json(await listComments(req.params[0]));
  }));

  app.post(/^\/api\/docs\/(.+)\/comments$/, asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: "body required" }); return; }
    res.json({ id: await addComment(req.params[0], body) });
  }));

  app.post(/^\/api\/docs\/(.+)\/comments\/(\d+)\/resolve$/, asyncRoute(async (req, res) => {
    await resolveComment(req.params[0], Number(req.params[1]));
    res.json({ ok: true });
  }));

  app.get("/api/changes", (_req, res) => {
    res.json(listChangeNotices());
  });

  app.post("/api/changes/:id/ack", (req, res) => {
    ackChangeNotice(Number(req.params.id));
    res.json({ ok: true });
  });

  // core throws plain Error/NotFoundError on bad input - synchronous route
  // handlers land here on their own (Express 4), async ones via asyncRoute.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  });

  return app;
}

async function main() {
  const { port, root } = parseArgs(process.argv.slice(2));
  setProjectRoot(root);

  // SP-00001 5절: "세션/백엔드 기동 시" git pull. A conflict is reported,
  // never auto-merged - and never blocks the server from starting; the
  // designer sees it in the log and resolves it themselves.
  const pullResult = await gitPull();
  if (pullResult.attempted) {
    if (pullResult.ok) console.log(`git pull: ${pullResult.message}`);
    else console.warn(`git pull 실패(설계자 확인 필요): ${pullResult.message}`);
  }

  const app = createApp();
  app.listen(port, "127.0.0.1", () => {
    console.log(`tier2 backend: http://127.0.0.1:${port}  (root: ${path.resolve(getProjectRoot())})`);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
