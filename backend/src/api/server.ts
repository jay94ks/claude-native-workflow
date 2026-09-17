#!/usr/bin/env node
import express, { type Request, type Response, type NextFunction } from "express";
import { ValidationError } from "./httpValidation.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import orgRoutes from "./routes/orgRoutes.js";
import apiKeyRoutes from "./routes/apiKeyRoutes.js";
import docTypeRoutes from "./routes/docTypeRoutes.js";
import documentMetaRoutes from "./routes/documentMetaRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import accessControlRoutes from "./routes/accessControlRoutes.js";
import folderRoutes from "./routes/folderRoutes.js";
import relationRoutes from "./routes/relationRoutes.js";
import kanbanRoutes from "./routes/kanbanRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import planRoutes from "./routes/planRoutes.js";
import questionRoutes from "./routes/questionRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
import opinionRoutes from "./routes/opinionRoutes.js";
import templateRoutes from "./routes/templateRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import gitRepoRoutes from "./routes/gitRepoRoutes.js";
import gitFileRoutes from "./routes/gitFileRoutes.js";
import gitStagingRoutes from "./routes/gitStagingRoutes.js";
import gitSyncRoutes from "./routes/gitSyncRoutes.js";
import pullRequestRoutes from "./routes/pullRequestRoutes.js";
import codeReviewRoutes from "./routes/codeReviewRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import pushHookRoutes from "./routes/pushHookRoutes.js";
import templateDeployRoutes from "./routes/templateDeployRoutes.js";
import { resolveMessageOrigin } from "./shared.js";
import { connectDb } from "../core/db.js";
import { AuthError, assertJwtSecretConfigured, seedDefaultAdminAccount } from "../core/auth.js";
import { LoginRateLimitError } from "../core/loginRateLimit.js";
import { assertCredentialEncryptionKeyConfigured } from "../core/crypto.js";
import { ensureAllUsersGiteaAccountsConfigured } from "../core/giteaAccounts.js";
import { recordRequest } from "../core/monitoring.js";
import { seedDefaultTemplates } from "../core/templates.js";
import { MeiliSearchRequestError } from "meilisearch";
import { ensureSearchIndexes } from "../core/search.js";
import { drainSearchSyncQueue } from "../core/searchSyncQueue.js";
import type { AuthedRequest } from "../middleware/auth.js";
import * as gitea from "../core/gitea.js";
import { expireStalePushHookQueueEntries } from "../core/pushHookPrompts.js";
import { ensureEmqxAuthConfigured } from "../core/emqxAuth.js";
import { deleteStaleSessions } from "../core/sessions.js";

const app = express();
// nginx 리버스 프록시 뒤에서 실행된다(#gitea-nginx-lockdown) - req.protocol/
// req.get("host")가 nginx의 X-Forwarded-Proto/Host 헤더를 반영하도록 필요
// (예: GitHub OAuth 리다이렉트 URI 계산). 로컬에서 nginx 없이 backend를
// 직접 열어도(개발 편의) 신뢰할 프록시가 없을 뿐 동작에 지장 없음.
app.set("trust proxy", 1);
// verify로 원본 바이트를 req.rawBody에 보존 - 웹훅 서명 검증은 express가
// 재직렬화한 JSON이 아니라 실제로 전송된 원본 바이트에 대해 계산해야
// 한다(재직렬화 시 키 순서/공백 차이로 서명이 어긋날 수 있음).
// limit 기본값(100kb)은 문서 본문(마크다운, 로그성 문서는 쉽게 넘김 -
// 가이디드 마이그레이션(Phase 6) 실측 중 실제 concept 브랜치의
// DN-00001.md(약 120KB)가 이 기본값에 막혀 "request entity too large"로
// 실패하는 걸 직접 겪었다) 크기에 비해 너무 작다 - 넉넉히 올려둔다.
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

// #usage-monitoring - "어떤 요청/명령이 자주 쓰이는지" 통계를 위한
// 전역 후킹. 각 라우트를 일일이 안 건드리려고 res.on("finish")로
// 응답이 끝난 뒤 req.route?.path(Express가 매칭한 파라미터화된 경로
// 패턴)를 읽는다 - 이 미들웨어가 라우트 등록보다 먼저 걸려 있어도
// req.route는 응답이 끝나는 시점엔 이미 채워져 있고, req.userId도
// 같은 이유로(그 사이 authenticate가 채움) 안전하다. **req.userId가
// 없으면(webhook, 로그인/가입 등 미인증 요청) 기록하지 않는다** -
// "AI/설계자가 CNW를 통해 쓰는 요청"이라는 취지에 자연히 맞다.
app.use((req: AuthedRequest, res: Response, next: NextFunction) => {
  const startedAt = Date.now(); // 평균 소요 시간 계산용(설계자 요청) - finish 시점에 경과만 계산
  res.on("finish", () => {
    const routePattern = req.route?.path;
    if (typeof routePattern !== "string" || !req.userId) return;
    const projectId = typeof req.params?.projectId === "string" ? req.params.projectId : null;
    const origin = resolveMessageOrigin(req);
    const sessionId = req.headers["x-session-id"];
    const transitionKey = typeof sessionId === "string" && sessionId ? sessionId : req.userId;
    recordRequest(req.method, routePattern, projectId, origin, transitionKey, Date.now() - startedAt).catch(() => {});
  });
  next();
});

// ---------------------------------------------------------------- 인증/git 자격증명/GitHub OAuth/설치 전역 설정
// api/routes/authRoutes.ts로 이관됨(#api-route-domain-split, 배치 1)
app.use(authRoutes);

// ---------------------------------------------------------------- 프로필/사용자/관리자 전용 사용자 관리/검색 장애 대응 큐
// api/routes/userRoutes.ts로 이관됨(#api-route-domain-split, 배치 2a)
app.use(userRoutes);

// ---------------------------------------------------------------- 팀/프로젝트 그룹/프로젝트
// api/routes/orgRoutes.ts로 이관됨(#api-route-domain-split, 배치 2b -
// 프로젝트 그룹/프로젝트 라우트는 원래 이 헤더 밑이 아니라 아래 API 키
// 섹션이 끝난 자리에 헤더 없이 있었다 - 실제 경로 기준으로 재확인해
// 이 파일 하나로 합쳤다. 경로 세그먼트 수가 달라 API 키 섹션의
// /api/projects/:projectId/api-keys 라우트와 안 겹친다).
app.use(orgRoutes);

// ---------------------------------------------------------------- API 키(신원 위임 인증, 3종)
// api/routes/apiKeyRoutes.ts로 이관됨(#api-route-domain-split, 배치 3)
app.use(apiKeyRoutes);

// ---------------------------------------------------------------- 문서 타입 체계
// api/routes/docTypeRoutes.ts로 이관됨(#api-route-domain-split, 배치 4)
app.use(docTypeRoutes);

// ---------------------------------------------------------------- 문서
// api/routes/documentMetaRoutes.ts + documentRoutes.ts로 이관됨
// (#api-route-domain-split, 배치 5a/5b)
app.use(documentMetaRoutes);
app.use(documentRoutes);

// ---------------------------------------------------------------- 세부 접근 권한/개인 폴더/코드 관계도/칸반/보고서/보류 계획
// api/routes/accessControlRoutes.ts, folderRoutes.ts, relationRoutes.ts,
// kanbanRoutes.ts, reportRoutes.ts, planRoutes.ts로 이관됨
// (#api-route-domain-split, 배치 6a~6f)
app.use(accessControlRoutes);
app.use(folderRoutes);
app.use(relationRoutes);
app.use(kanbanRoutes);
app.use(reportRoutes);
app.use(planRoutes);

app.use(questionRoutes);
app.use(commentRoutes);
app.use(opinionRoutes);
app.use(templateRoutes);
app.use(messageRoutes);
app.use(sessionRoutes);

app.use(gitRepoRoutes);
app.use(gitFileRoutes);
app.use(gitStagingRoutes);
app.use(gitSyncRoutes);
app.use(pullRequestRoutes);
app.use(codeReviewRoutes);
app.use(webhookRoutes);
app.use(pushHookRoutes);
app.use(templateDeployRoutes);

// ---------------------------------------------------------------- 에러 핸들러

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ValidationError) { res.status(400).json({ error: err.message }); return; }
  if (err instanceof AuthError) { res.status(400).json({ error: err.message }); return; }
  if (err instanceof LoginRateLimitError) {
    res.status(429).set("Retry-After", String(err.retryAfterSeconds)).json({ error: err.message });
    return;
  }
  if (err instanceof MeiliSearchRequestError) {
    // 내부 Docker 호스트명이 그대로 노출되던 원본 메시지는 로그에만
    // 남기고, 응답은 원인을 알 수 있는 일반화된 메시지로 바꾼다
    // (#meilisearch-spof 조사로 발견 - 이전엔 400 + 원본 메시지였음).
    console.error(err);
    res.status(503).json({ error: "검색 엔진(Meilisearch)에 연결할 수 없습니다 - 서비스 상태를 확인한 뒤 다시 시도하세요" });
    return;
  }
  // 알 수 없는 예외는 서버 로그에만 자세히 남기고, 응답은 일반화한다 -
  // concept 세션 QA로 발견: 안 그러면 fs/Prisma 에러 메시지에 섞인
  // 서버 내부 경로 구조가 클라이언트에 그대로 노출된다.
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ error: message });
});

async function main() {
  assertJwtSecretConfigured();
  assertCredentialEncryptionKeyConfigured();
  await connectDb();
  await ensureSearchIndexes();
  await seedDefaultTemplates();
  await seedDefaultAdminAccount();
  await ensureEmqxAuthConfigured();
  // 프로젝트별 org 구조(#gitea-per-project-namespace)에서는 전역 org를
  // 부팅 시 미리 만들어둘 필요가 없다 - 프로젝트가 처음 git 저장소를
  // 연결하는 시점에 ensureProjectOrgConfigured()가 그때그때 만든다.
  await gitea.ensureGiteaSystemWebhookConfigured();
  await ensureAllUsersGiteaAccountsConfigured();

  // Meilisearch 장애 중 밀린 색인 쓰기 큐를 주기적으로 비운다
  // (#meilisearch-spof). draining 플래그로 이전 드레인이 아직 진행
  // 중이면 이번 틱을 건너뛴다 - 큐가 커서 30초 안에 못 끝나는 경우 두
  // 드레인이 겹쳐 같은 배치를 동시에 처리하는 걸 방지.
  let draining = false;
  setInterval(() => {
    if (draining) return;
    draining = true;
    drainSearchSyncQueue()
      .catch((err) => console.error("검색 동기화 큐 드레인 실패:", err))
      .finally(() => { draining = false; });
  }, 30_000);

  // push 훅 대기열 중 아무도 안 봐서 영원히 pending으로 남는 항목을
  // 주기적으로 expired 처리한다(#hook-queue-ttl) - TTL이 30일 단위라
  // 하루에 한 번이면 충분하다.
  setInterval(() => {
    expireStalePushHookQueueEntries().catch((err) => console.error("push 훅 대기열 만료 처리 실패:", err));
  }, 24 * 60 * 60 * 1000);

  // 세션 목록에 1시간 넘게 활동이 없는(lastSeenAt 기준) 세션을 주기적으로
  // 삭제한다(설계자 지시) - TTL(1시간)이 위 push 훅(30일)보다 훨씬 짧아
  // 같은 비율로 더 자주 돈다.
  setInterval(() => {
    deleteStaleSessions().catch((err) => console.error("오래된 세션 정리 실패:", err));
  }, 5 * 60 * 1000);

  const port = Number(process.env.PORT ?? 8760);
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => {
    console.log(`claude-native-workflow backend: http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
