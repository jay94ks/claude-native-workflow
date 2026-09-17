// 배치 8g(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 웹훅 수신(인증 미들웨어 없음 - Gitea/GitHub/GitLab이 직접 호출,
// 서명/토큰으로 검증). server.ts에서 그대로 잘라낸 것 - 로직은 전혀
// 안 바뀜.
//
// 등록 순서를 절대 바꾸지 않는다 - 아래 "/api/webhooks/gitea/system"이
// "/api/webhooks/:provider/:projectId"보다 먼저 등록돼야 한다. Express는
// 라우트를 등록 순서대로 매칭하므로, 순서가 바뀌면
// "/api/webhooks/gitea/system"이 provider="gitea", projectId="system"
// 으로 파싱되어 그 아래 라우트의 gitea 410 가드에 먼저 걸려버린다(원본
// server.ts에서 실제로 이 순서 버그를 만들어 재현·확인한 뒤 고친
// 이력이 있음 - #58 추출 시에도 그대로 보존).
import { Router, type Request } from "express";
import { getGiteaSystemWebhookSecret } from "../../core/installConfig.js";
import {
  verifyAndParseWebhook,
  recordPushEvent,
  handleGiteaSystemPush,
  classifyGiteaEvent,
  verifyAndParsePushWebhook,
  verifyAndParseDeleteWebhook,
  handleGiteaSystemDelete,
} from "../../core/pushHooks.js";
import { getWebhookSecret, markExternalWebhookReceived } from "../../core/gitRepos.js";
import { asyncRoute } from "../shared.js";

const router = Router();

// Gitea 시스템 웹훅(인스턴스 전체) 전용 경로 - 프로젝트별 시크릿이
// 아니라 InstallConfig에 발급·보관된 시스템 전체 시크릿 하나로 서명을
// 검증한다. payload를 파싱하기 전에 이 고정 시크릿으로 서명부터
// 검증하고, 통과한 뒤에야 body를 열어 어느 저장소의 push인지 읽는다
// (verifyAndParseWebhook이 이미 그 순서로 동작 - provider 분기 로직은
// 안 건드림, 시크릿만 다르게 넘긴다).
//
// 아래 `/api/webhooks/:provider/:projectId`(파라미터 라우트)보다
// 먼저 등록해야 한다 - Express는 라우트를 등록 순서대로 매칭하므로,
// 이 라우트가 뒤에 있으면 `/api/webhooks/gitea/system`이
// provider="gitea", projectId="system"으로 파싱되어 그 아래 라우트의
// gitea 410 가드에 먼저 걸려버린다(실제로 이 순서 버그를 만들어
// 재현·확인한 뒤 고쳤다 - 등록 순서를 바꾸는 것 외에 다른 코드 변경은
// 없음).
router.post(
  "/api/webhooks/gitea/system",
  asyncRoute(async (req, res) => {
    const secret = await getGiteaSystemWebhookSecret();
    if (!secret) { res.status(503).json({ error: "시스템 웹훅이 아직 설정되지 않았습니다" }); return; }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const kind = classifyGiteaEvent(headers);
    if (kind === "unknown") {
      // 서명 검증 없이도 조용히 무시 - 시스템 웹훅은 인스턴스 전체
      // 이벤트를 받으므로 push/delete 외의 이벤트(향후 events 목록이
      // 늘어나기 전까지는 실제로 안 옴)는 처리 대상이 아닐 뿐 에러가
      // 아니다.
      res.json({ ok: true, status: "ignored", reason: `처리 대상이 아닌 이벤트: ${headers["x-gitea-event"] ?? "?"}` });
      return;
    }
    try {
      if (kind === "push") {
        const parsed = verifyAndParsePushWebhook(headers, rawBody, secret);
        const result = await handleGiteaSystemPush(parsed);
        res.json({ ok: true, ...result });
      } else {
        const parsed = verifyAndParseDeleteWebhook(headers, rawBody, secret);
        const result = await handleGiteaSystemDelete(parsed);
        res.json({ ok: true, ...result });
      }
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

// Gitea는 더 이상 이 프로젝트별 경로로 안 온다 - 인스턴스 전체를
// 커버하는 시스템 웹훅(위 /api/webhooks/gitea/system) 하나로
// 통합됐다. 예전에 저장소별로 등록됐던 Gitea 웹훅이 실수로 남아 계속
// 이 경로를 때리면 조용히 두 번 처리되는 것보다 명확한 410으로 존재를
// 드러내는 쪽이 안전하다(Gitea 어드민 UI에서 정리하라는 안내). github/
// gitlab(외부 저장소 연동의 권위 원본 - 시스템 웹훅 개념이 없는
// 플랫폼)은 기존대로 이 경로를 그대로 쓴다.
router.post(
  "/api/webhooks/:provider/:projectId",
  asyncRoute(async (req, res) => {
    const { provider, projectId } = req.params;
    if (provider === "gitea") {
      res.status(410).json({
        error: "Gitea 웹훅은 프로젝트별 등록에서 시스템 웹훅 1개로 통합됐습니다 - 이 저장소의 옛 웹훅을 Gitea 어드민 UI에서 삭제하세요",
      });
      return;
    }
    const secret = await getWebhookSecret(projectId);
    if (!secret) { res.status(404).json({ error: "연결된 git 저장소가 없습니다" }); return; }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
    let parsed;
    try {
      parsed = verifyAndParseWebhook(provider, req.headers as Record<string, string | string[] | undefined>, rawBody, secret);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    await markExternalWebhookReceived(projectId);
    const queued = await recordPushEvent(projectId, parsed);
    res.json({ ok: true, queued });
  }),
);

export default router;
