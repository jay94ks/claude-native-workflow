import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { connectDb } from "../core/db.js";
import { register, login, refresh, logout, AuthError, assertJwtSecretConfigured } from "../core/auth.js";
import {
  createProject, listMyProjects, addMember, updateMemberRole, removeMember,
  listMembers, findUserByIdentifier, findProjectsByRepoUrl, ROLES, type Role,
} from "../core/projects.js";
import { ensureProjectCheckout, commitAsAndPush, projectDir } from "../core/workspace.js";
import { authenticate, requireProjectRole, withProjectRoot, type AuthedRequest } from "../middleware/auth.js";
import { listComments, addComment, resolveComment } from "../core/comments.js";

import {
  buildTree, getDoc, saveDocBody, searchDocs, listPending, listByTypes, extractSection, NotFoundError,
} from "@claude-native-workflow/tier2-backend/dist/core/docstore.js";
import { validateAll } from "@claude-native-workflow/tier2-backend/dist/core/validate.js";
import { createDoc } from "@claude-native-workflow/tier2-backend/dist/core/create.js";
import { answerPending } from "@claude-native-workflow/tier2-backend/dist/core/reply.js";
import { transitionDone } from "@claude-native-workflow/tier2-backend/dist/core/transition.js";
import { pull as gitPull, push as gitPush } from "@claude-native-workflow/tier2-backend/dist/core/git.js";
import { gitLog, gitCommitDetail, gitDiff, gitBlame } from "@claude-native-workflow/tier2-backend/dist/core/gitlog.js";
import { listChangeNotices, ackChangeNotice } from "@claude-native-workflow/tier2-backend/dist/core/changes.js";
import { runWithProjectRoot } from "@claude-native-workflow/tier2-backend/dist/core/paths.js";
import { DESIGN_TYPES, TYPE_NAMES } from "@claude-native-workflow/tier2-backend/dist/core/types.js";

// SP-00002 4절: SP-00001의 로컬 API를 프로젝트 네임스페이스 + 인증으로
// 감싼다. 다른 진입점(tier2의 cli/api/mcp)과 마찬가지로 여기도 core/
// 함수를 직접 호출한다 - tier2의 api/server.ts를 통해서 가는 게 아니다
// (SP-00001 1절 원칙을 tier3도 그대로 따름). 그래서 `/api/projects/
// :projectId/tree`가 `/api/projects/:projectId/api/tree`처럼 이중으로
// 겹치는 문제도 애초에 안 생긴다.

function asyncRoute(handler: (req: AuthedRequest, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req as AuthedRequest, res).catch(next);
  };
}

export function createApp() {
  const app = express();

  // 웹훅 HMAC 검증은 원문 바이트가 필요하다(재직렬화하면 GitHub이 서명한
  // 바이트와 달라질 수 있음) - 아래 전역 express.json()이 스트림을 먼저
  // 먹어버리기 전에, 이 라우트에만 raw 바디 파서를 앞서 등록해둔다.
  app.post("/api/webhooks/git", express.raw({ type: "application/json" }), asyncRoute(async (req, res) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const signature = req.headers["x-hub-signature-256"];
    if (!secret || typeof signature !== "string") { res.status(401).json({ error: "signature required" }); return; }
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.body as Buffer).digest("hex");
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    // timingSafeEqual throws on length mismatch instead of just returning
    // false - a malformed/wrong-length header (attacker-controlled input)
    // would otherwise fall through to asyncRoute's catch-all and come back
    // as a confusing 400 with an internal error message, not a clean 401.
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
      res.status(401).json({ error: "invalid signature" }); return;
    }
    // SP-00002 5절: "다른 설계자가 로컬에서 직접 push한 경우... 서버 측
    // 캐시를 최신화" - repository.{clone,html,ssh}_url 중 매칭되는 걸로
    // 프로젝트를 찾아 그 체크아웃에서 git pull한다. 이게 곧 캐시 최신화다:
    // pull이 로컬 파일을 최신 커밋으로 맞추고, 그 다음 어떤 조회든(다음
    // API 호출이든 대시보드 새로고침이든) 읽기 게이트가 알아서 diff를
    // 감지해 변경 큐에 올린다(PL-00001 2단계 7번에서 이미 구현한 경로 -
    // 여기서 다시 구현하지 않는다).
    let payload: { repository?: { clone_url?: string; html_url?: string; ssh_url?: string } };
    try {
      payload = JSON.parse((req.body as Buffer).toString("utf-8"));
    } catch {
      res.status(400).json({ error: "invalid JSON payload" }); return;
    }
    const candidateUrls = [
      payload.repository?.clone_url, payload.repository?.html_url, payload.repository?.ssh_url,
    ].filter((u): u is string => !!u);
    const matches = candidateUrls.length ? await findProjectsByRepoUrl(candidateUrls) : [];
    const pullResults = await Promise.all(
      matches.map(async (project) => {
        const result = await runWithProjectRoot(projectDir(project.id), () => gitPull());
        return { project_id: project.id, ...result };
      }),
    );
    res.json({ ok: true, matched_projects: matches.length, pulls: pullResults });
  }));

  app.use(express.json());

  // ---------------------------------------------------------------- auth (SP-00002 2절)

  // QA로 발견: register/login에 브루트포스·계정 스팸 방어가 전혀 없었다
  // (express-rate-limit는 다른 의존성이 끌어온 전이 의존성으로만 설치돼
  // 있었을 뿐 실제로 쓰이진 않고 있었음). Tier 3는 인터넷에 노출되는
  // 미인증 진입점이라 이 두 라우트만이라도 IP당 요청 수를 제한한다 -
  // login은 비밀번호 추측 시도를, register는 계정 대량 생성을 늦춘다.
  // refresh는 유효한 refresh token을 이미 가진 클라이언트만 부를 수 있어
  // 상대적으로 덜 급하지만, 탈취된 토큰으로 회전을 반복 시도하는 것도
  // 늦추는 게 안전해서 같이 걸어둔다.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  });

  app.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
    const { username, email, password } = req.body as { username?: string; email?: string; password?: string };
    if (!username || !email || !password) {
      res.status(400).json({ error: "username/email/password required" }); return;
    }
    res.json(await register({ username, email, password }));
  }));

  app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
    const { username_or_email, password } = req.body as { username_or_email?: string; password?: string };
    if (!username_or_email || !password) {
      res.status(400).json({ error: "username_or_email/password required" }); return;
    }
    res.json(await login(username_or_email, password));
  }));

  app.post("/api/auth/refresh", authLimiter, asyncRoute(async (req, res) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (!refresh_token) { res.status(400).json({ error: "refresh_token required" }); return; }
    res.json(await refresh(refresh_token));
  }));

  app.post("/api/auth/logout", asyncRoute(async (req, res) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (!refresh_token) { res.status(400).json({ error: "refresh_token required" }); return; }
    await logout(refresh_token);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- project management (SP-00002 4절)

  app.post("/api/projects", authenticate, asyncRoute(async (req, res) => {
    const { name, git_repo_url } = req.body as { name?: string; git_repo_url?: string };
    if (!name || !git_repo_url) { res.status(400).json({ error: "name/git_repo_url required" }); return; }
    const project = await createProject(req.user!.id, { name, gitRepoUrl: git_repo_url });
    await ensureProjectCheckout(project.id, git_repo_url);
    res.json(project);
  }));

  app.get("/api/projects", authenticate, asyncRoute(async (req, res) => {
    res.json(await listMyProjects(req.user!.id));
  }));

  app.post("/api/projects/:projectId/members", authenticate, requireProjectRole("owner"), asyncRoute(async (req, res) => {
    const { user_id, email, role } = req.body as { user_id?: string; email?: string; role?: string };
    if (!role || !ROLES.includes(role as Role)) { res.status(400).json({ error: `role must be one of ${ROLES.join("|")}` }); return; }
    const identifier = user_id ?? email;
    if (!identifier) { res.status(400).json({ error: "user_id or email required" }); return; }
    const user = await findUserByIdentifier(identifier);
    if (!user) { res.status(404).json({ error: "user not found" }); return; }
    res.json(await addMember(req.params.projectId, user.id, role as Role));
  }));

  app.get("/api/projects/:projectId/members", authenticate, requireProjectRole("viewer"), asyncRoute(async (req, res) => {
    res.json(await listMembers(req.params.projectId));
  }));

  app.patch("/api/projects/:projectId/members/:userId", authenticate, requireProjectRole("owner"), asyncRoute(async (req, res) => {
    const { role } = req.body as { role?: string };
    if (!role || !ROLES.includes(role as Role)) { res.status(400).json({ error: `role must be one of ${ROLES.join("|")}` }); return; }
    res.json(await updateMemberRole(req.params.projectId, req.params.userId, role as Role));
  }));

  app.delete("/api/projects/:projectId/members/:userId", authenticate, requireProjectRole("owner"), asyncRoute(async (req, res) => {
    await removeMember(req.params.projectId, req.params.userId);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- namespaced docs API (SP-00002 4절)

  const viewer = [authenticate, requireProjectRole("viewer"), withProjectRoot()];
  const editor = [authenticate, requireProjectRole("editor"), withProjectRoot()];

  app.get("/api/projects/:projectId/tree", ...viewer, (_req, res) => {
    res.json(buildTree());
  });

  app.get("/api/projects/:projectId/doc", ...viewer, (req, res) => {
    const doc = getDoc(String(req.query.path ?? ""));
    if (!doc) { res.status(404).json({ error: "not found" }); return; }
    const anchor = req.query.anchor ? String(req.query.anchor) : undefined;
    if (anchor) {
      const section = extractSection(doc.body, anchor);
      if (section === null) { res.status(404).json({ error: "anchor not found" }); return; }
      res.json({ path: doc.path, meta: doc.meta, body: section, anchor });
      return;
    }
    res.json(doc);
  });

  app.get("/api/projects/:projectId/pending", ...viewer, (_req, res) => {
    res.json(listPending());
  });

  app.get("/api/projects/:projectId/design", ...viewer, (_req, res) => {
    res.json(listByTypes(DESIGN_TYPES));
  });

  app.get("/api/projects/:projectId/logs", ...viewer, (_req, res) => {
    res.json(listByTypes(new Set(["LG"])));
  });

  app.get("/api/projects/:projectId/all", ...viewer, (_req, res) => {
    res.json(listByTypes(new Set(Object.keys(TYPE_NAMES).filter((t) => t !== "IX"))));
  });

  app.get("/api/projects/:projectId/search", ...viewer, (req, res) => {
    res.json(searchDocs(String(req.query.q ?? "")));
  });

  app.get("/api/projects/:projectId/validate", ...viewer, (_req, res) => {
    res.json(validateAll());
  });

  app.post("/api/projects/:projectId/doc/save", ...editor, asyncRoute(async (req, res) => {
    const { path: relPath, body } = req.body as { path?: string; body?: string };
    if (!relPath || body === undefined) { res.status(400).json({ error: "path/body required" }); return; }
    const result = saveDocBody(relPath, body);
    await commitProjectChange(req, `docs: edit ${relPath} (${req.user!.username})`);
    res.json(result);
  }));

  app.get("/api/projects/:projectId/git/log", ...viewer, asyncRoute(async (req, res) => {
    const relPath = req.query.path ? String(req.query.path) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    res.json(await gitLog(relPath, limit));
  }));

  app.get("/api/projects/:projectId/git/blame", ...viewer, asyncRoute(async (req, res) => {
    res.type("text/plain").send(await gitBlame(String(req.query.path ?? "")));
  }));

  app.get("/api/projects/:projectId/git/commits/:sha", ...viewer, asyncRoute(async (req, res) => {
    const detail = await gitCommitDetail(req.params.sha);
    if (!detail) { res.status(404).json({ error: "not found" }); return; }
    res.json(detail);
  }));

  app.get("/api/projects/:projectId/git/diff/:sha", ...viewer, asyncRoute(async (req, res) => {
    res.type("text/plain").send(await gitDiff(req.params.sha));
  }));

  // SP-00002 8절: doc_comments는 프로젝트별 커넥션이 아니라 project_id로
  // 나뉜 공유 서비스 DB - tier2의 core/comments.ts(로컬/토글 기반)가 아니라
  // 이 저장소 자체의 core/comments.ts(project_id 필터)를 쓴다.
  app.get("/api/projects/:projectId/docs/:docPath(.*)/comments", authenticate, requireProjectRole("viewer"), asyncRoute(async (req, res) => {
    res.json(await listComments(req.params.projectId, req.params.docPath));
  }));

  // QA로 발견: 아래 둘은 POST(쓰기)인데 requireProjectRole("viewer")로
  // 걸려 있었다 - SP-00002의 역할표(viewer=조회만, editor=조회+쓰기)와
  // 어긋나는 실제 버그. viewer로만 초대된 사람도 코멘트를 쓰고 남의
  // 코멘트를 resolve 처리할 수 있었다.
  app.post("/api/projects/:projectId/docs/:docPath(.*)/comments", authenticate, requireProjectRole("editor"), asyncRoute(async (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: "body required" }); return; }
    res.json({ id: await addComment(req.params.projectId, req.params.docPath, body) });
  }));

  app.post("/api/projects/:projectId/docs/:docPath(.*)/comments/:id(\\d+)/resolve", authenticate, requireProjectRole("editor"), asyncRoute(async (req, res) => {
    await resolveComment(req.params.projectId, req.params.docPath, Number(req.params.id));
    res.json({ ok: true });
  }));

  app.get("/api/projects/:projectId/changes", ...viewer, (_req, res) => {
    res.json(listChangeNotices());
  });

  app.post("/api/projects/:projectId/changes/:id/ack", ...editor, (req, res) => {
    ackChangeNotice(Number(req.params.id));
    res.json({ ok: true });
  });

  async function commitProjectChange(req: AuthedRequest, message: string) {
    await commitAsAndPush(req.params.projectId, message, req.user!.username, `${req.user!.username}@tier3`);
  }

  app.post("/api/projects/:projectId/docs", ...editor, asyncRoute(async (req, res) => {
    const { type, title, links, status } = req.body as { type?: string; title?: string; links?: string[]; status?: string };
    if (!type || !title) { res.status(400).json({ error: "type/title required" }); return; }
    const result = await createDoc({ type, title, links, status });
    await commitProjectChange(req, `docs: new ${result.id} (${req.user!.username})`);
    res.json(result);
  }));

  // docs path 자체에 슬래시가 포함돼(decision/DC-00001.md) 일반 :param
  // 하나로는 못 받는다 - tier2의 정규식 라우트 대신, projectId는 named
  // param으로 남기고(아래 미들웨어들이 req.params.projectId를 읽으므로)
  // 나머지만 커스텀 정규식으로 와일드카드 처리(path-to-regexp 문법).
  app.post("/api/projects/:projectId/docs/:docPath(.*)/reply", ...editor, asyncRoute(async (req, res) => {
    const { question_id, answer } = req.body as { question_id?: string | number; answer?: string };
    if (question_id === undefined || answer === undefined) { res.status(400).json({ error: "question_id/answer required" }); return; }
    const result = await answerPending(req.params.docPath, String(question_id), answer);
    await commitProjectChange(req, `docs: answer (Q${question_id}) → ${result.rp_id} (${req.user!.username})`);
    res.json(result);
  }));

  app.post("/api/projects/:projectId/plan/:id/transition-done", ...editor, asyncRoute(async (req, res) => {
    const { report } = req.body as { report?: string };
    if (!report) { res.status(400).json({ error: "report required" }); return; }
    const result = await transitionDone(req.params.id, report);
    await commitProjectChange(req, `docs: complete ${req.params.id} → ${result.dn_id} (${req.user!.username})`);
    res.json(result);
  }));

  app.post("/api/projects/:projectId/git/commit", ...editor, asyncRoute(async (req, res) => {
    const { message } = req.body as { message?: string };
    res.json(await commitAsAndPush(req.params.projectId, message ?? `docs: manual commit (${req.user!.username})`, req.user!.username, `${req.user!.username}@tier3`));
  }));

  app.post("/api/projects/:projectId/git/push", ...editor, asyncRoute(async (_req, res) => {
    res.json(await gitPush());
  }));

  app.post("/api/projects/:projectId/git/pull", ...editor, asyncRoute(async (_req, res) => {
    res.json(await gitPull());
  }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AuthError) { res.status(400).json({ error: err.message }); return; }
    if (err instanceof NotFoundError) { res.status(404).json({ error: err.message }); return; }
    // QA로 발견: 그 밖의 예외(fs ENOENT, Prisma 에러 등)는 .message를 그대로
    // 클라이언트에 돌려주고 있었다 - 이런 에러는 서버의 절대 경로
    // (TIER3_PROJECTS_DIR 아래 project-id 구조 등)나 쿼리 내부 정보를 그대로
    // 담고 있는 경우가 많아, 인증된 클라이언트라도 내부 구조가 새어나간다.
    // 서버 로그엔 그대로 남기되, 응답은 일반화된 메시지로 바꾼다.
    console.error(err);
    res.status(400).json({ error: "요청을 처리하지 못했습니다" });
  });

  return app;
}

async function main() {
  assertJwtSecretConfigured();
  await connectDb();
  const port = Number(process.env.PORT ?? 8767);
  const host = process.env.HOST ?? "127.0.0.1";
  const app = createApp();
  app.listen(port, host, () => {
    console.log(`tier3 backend: http://${host}:${port}`);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
