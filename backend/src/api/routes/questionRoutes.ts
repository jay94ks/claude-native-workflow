// 배치 7a(#api-route-domain-split, BL-57F8DF17 #58, PN-147594AC) -
// 질의/답변(질의는 AI, 답변은 설계자 - open→pending→resolved).
// server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
import { Router } from "express";
import {
  resolveTargetByTrackingCode,
  addQuestionByTrackingCode,
  addQuestion,
  listQuestions,
  listQuestionsPaged,
  listPendingQuestions,
  listPendingQuestionsPaged,
  listResolvedQuestionsPaged,
  getQuestionByTrackingCode,
  getQuestionProjectId,
  answerQuestion,
  acknowledgeQuestion,
  withdrawQuestion,
  type QuestionListStatus,
} from "../../core/questions.js";
import { normalizeGitPath } from "../../core/gitPath.js";
import { getMemberRole } from "../../core/members.js";
import { authenticate, requireProjectRole } from "../../middleware/auth.js";
import { assertTruthy } from "../httpValidation.js";
import { asyncRoute, withNotices, pendingQuestionNotice, requireEditorForTarget } from "../shared.js";

const router = Router();

// targetType/targetKey로 다형화(document/source/kanbanCard) - document/
// kanbanCard 대상은 그 자신의 트래킹 코드만으로 프로젝트/대상 종류를
// 역산할 수 있어(resolveTargetByTrackingCode) CLI의 기존 2-인자
// 시그니처(`docs question <trackingCode> <text>`)를 그대로 유지한다.
// source 대상은 트래킹 코드가 없어 프로젝트 스코프 진입점이 별도로
// 필요하다.

router.post(
  "/api/questions",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCode, kind, text, refs, options } = req.body as {
      trackingCode?: string;
      kind?: string;
      text?: string;
      refs?: string[];
      options?: { label: string; detail?: string }[];
    };
    if (!trackingCode || !kind || !text) { res.status(400).json({ error: "trackingCode/kind/text가 필요합니다" }); return; }
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(target.projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    res.json(await addQuestionByTrackingCode(trackingCode, kind, text, req.userId!, refs, options));
  }),
);

router.post(
  "/api/projects/:projectId/questions/source",
  authenticate,
  requireProjectRole("editor"),
  asyncRoute(async (req, res) => {
    const { path: rawPath, kind, text, refs, options } = req.body as {
      path?: string;
      kind?: string;
      text?: string;
      refs?: string[];
      options?: { label: string; detail?: string }[];
    };
    if (!rawPath || !kind || !text) { res.status(400).json({ error: "path/kind/text가 필요합니다" }); return; }
    res.json(await addQuestion(req.params.projectId, "source", normalizeGitPath(rawPath), kind, text, req.userId!, refs, options));
  }),
);

router.get(
  "/api/questions",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    assertTruthy(trackingCode, "trackingCode 쿼리가 필요합니다");
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(target.projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    res.json(await listQuestions(target.targetType, trackingCode, req.query.status as QuestionListStatus | undefined));
  }),
);

router.get(
  "/api/projects/:projectId/questions/source",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const path = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(path, "path 쿼리가 필요합니다");
    res.json(await listQuestions("source", path, req.query.status as QuestionListStatus | undefined));
  }),
);

// 문서 탭 분리(질의/답변) + 소스 코드/칸반 카드 다이얼로그가 공유하는
// 웹 전용 자매 라우트(페이지네이션+검색+최신순) - CLI/MCP가 쓰는 위
// 배열 응답 라우트는 그대로 둔다.
router.get(
  "/api/questions/page",
  authenticate,
  asyncRoute(async (req, res) => {
    const trackingCode = req.query.trackingCode as string | undefined;
    assertTruthy(trackingCode, "trackingCode 쿼리가 필요합니다");
    const target = await resolveTargetByTrackingCode(trackingCode);
    if (!target) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    const role = await getMemberRole(target.projectId, req.userId!);
    if (!role) { res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" }); return; }
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    const q = req.query.q as string | undefined;
    const status = req.query.status as QuestionListStatus | undefined;
    res.json(await listQuestionsPaged(target.targetType, trackingCode, { page, pageSize, q, status }));
  }),
);

router.get(
  "/api/projects/:projectId/questions/source/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const path = req.query.path ? normalizeGitPath(req.query.path as string) : undefined;
    assertTruthy(path, "path 쿼리가 필요합니다");
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    const q = req.query.q as string | undefined;
    const status = req.query.status as QuestionListStatus | undefined;
    res.json(await listQuestionsPaged("source", path, { page, pageSize, q, status }));
  }),
);

router.get(
  "/api/projects/:projectId/pending",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const notice = await pendingQuestionNotice(req.params.projectId);
    res.json(withNotices({ questions: await listPendingQuestions(req.params.projectId) }, notice));
  }),
);

router.get(
  "/api/projects/:projectId/pending/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    const notice = await pendingQuestionNotice(req.params.projectId);
    const paged = await listPendingQuestionsPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20));
    res.json(withNotices(paged, notice));
  }),
);

// 문서 탭 "답변 기록" 서브탭이 씀(#document-answer-status-subtabs) -
// "답변 대기"는 기존 /pending/page(open+pending)를 그대로 재사용하고,
// 이건 그 반대(resolved만) 전용 라우트.
router.get(
  "/api/projects/:projectId/questions/resolved/page",
  authenticate,
  requireProjectRole("viewer"),
  asyncRoute(async (req, res) => {
    res.json(await listResolvedQuestionsPaged(req.params.projectId, Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
  }),
);

// 문서 뷰어의 QU-XXXXXXXX 코드 클릭(TrackingCodeText)이 씀 -
// #reserved-tracking-codes.
router.get(
  "/api/questions/:trackingCode",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getQuestionProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "질문을 찾을 수 없습니다" }); return; }
    if (!(await getMemberRole(projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 viewer 권한이 필요합니다" });
      return;
    }
    const question = await getQuestionByTrackingCode(req.params.trackingCode);
    if (!question) { res.status(404).json({ error: "질문을 찾을 수 없습니다" }); return; }
    res.json(question);
  }),
);

router.post(
  "/api/questions/:trackingCode/answer",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getQuestionProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "질문을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    const { body, decision } = req.body as { body?: string; decision?: string };
    res.json(await answerQuestion(req.params.trackingCode, { body, decision }, req.userId!));
  }),
);

router.post(
  "/api/questions/:trackingCode/ack",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = await getQuestionProjectId(req.params.trackingCode);
    if (!projectId) { res.status(404).json({ error: "질문을 찾을 수 없습니다" }); return; }
    if (!(await requireEditorForTarget(projectId, req.userId!))) {
      res.status(403).json({ error: "이 작업은 최소 editor 권한이 필요합니다" });
      return;
    }
    res.json(await acknowledgeQuestion(req.params.trackingCode));
  }),
);

// 소유권 확인(본인이 등록한 질의만)은 withdrawQuestion() 내부에서
// 처리한다 - editComment/deleteComment와 같은 패턴(라우트는
// authenticate만, "본인 소유물만" 거부는 core가 에러로).
router.post(
  "/api/questions/:trackingCode/withdraw",
  authenticate,
  asyncRoute(async (req, res) => {
    res.json(await withdrawQuestion(req.params.trackingCode, req.userId!));
  }),
);

// 선택한 질의들이 서로 다른 프로젝트/권한을 가질 수 있어(document
// bulk-transition과 동일한 이유) 전부-성공/전부-실패가 아니라
// 항목별 결과를 반환한다 - 새 core 함수 없이 기존 단건 함수를 그대로
// 반복 호출한다.
router.post(
  "/api/questions/bulk-ack",
  authenticate,
  asyncRoute(async (req, res) => {
    const { trackingCodes } = req.body as { trackingCodes?: string[] };
    if (!trackingCodes?.length) {
      res.status(400).json({ error: "trackingCodes가 필요합니다" });
      return;
    }
    const results = await Promise.all(
      trackingCodes.map(async (trackingCode) => {
        try {
          const projectId = await getQuestionProjectId(trackingCode);
          if (!projectId) return { trackingCode, ok: false, error: "질문을 찾을 수 없습니다" };
          if (!(await requireEditorForTarget(projectId, req.userId!))) {
            return { trackingCode, ok: false, error: "이 작업은 최소 editor 권한이 필요합니다" };
          }
          const updated = await acknowledgeQuestion(trackingCode);
          return { trackingCode, ok: true, status: updated.status };
        } catch (err) {
          return { trackingCode, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    res.json(results);
  }),
);

export default router;
