import { getDb } from "./db.js";
import { withTrackingCode } from "./tracking.js";
import { allowedNextStatuses } from "./docTypes.js";
import { resyncDocumentIndex } from "./documents.js";
import { realtimePublish, projectChangesTopic, type ChangeEvent } from "./realtime.js";

const QUESTION_TYPE_CODE = "QU";

export interface QuestionDetail {
  trackingCode: string;
  documentTrackingCode: string;
  ordinal: number;
  text: string;
  askedBy: string;
  status: string; // open(AI 질의, 설계자 답변 대기) | pending(설계자 답변 완료, AI 확인 대기) | resolved(AI 확인 완료)
  refs: string[];
}

export interface AnswerDetail {
  body: string;
  answeredBy: string;
  answeredAt: Date;
}

/** 질의는 AI가 등록하고 설계자가 답변하는 것 - 옛 "## 답변 대기" 섹션
 * 안 체크리스트를 완전히 대체한다(CRLF 정규식으로 본문을 스캔하던
 * 버그 계열이 구조적으로 사라짐 - 질문 자체가 DB 레코드라 텍스트 스캔이
 * 필요 없다). refTrackingCodes는 AI가 판단에 참고한 문서들을 구조적으로
 * 태깅한다(DocumentLink와 같은 조인 테이블 패턴 - 본문 텍스트에 욱여넣지
 * 않음), 존재하지 않는 trackingCode가 섞여 있으면 명확한 에러. */
export async function addQuestion(
  documentTrackingCode: string,
  text: string,
  askedBy: string,
  refTrackingCodes?: string[],
): Promise<QuestionDetail> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode: documentTrackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${documentTrackingCode}`);

  const refs = refTrackingCodes?.filter(Boolean) ?? [];
  for (const ref of refs) {
    const refDoc = await db.document.findUnique({ where: { trackingCode: ref } });
    if (!refDoc) throw new Error(`참고 문서를 찾을 수 없습니다: ${ref}`);
  }

  const count = await db.question.count({ where: { documentId: document.id } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await withTrackingCode<any>(document.projectId, QUESTION_TYPE_CODE, "question", (trackingCode) =>
    db.question.create({
      data: {
        documentId: document.id,
        trackingCode,
        ordinal: count + 1,
        text,
        askedBy,
        status: "open",
      },
    }),
  );

  if (refs.length > 0) {
    await db.questionReference.createMany({
      data: refs.map((trackingCode) => ({ questionId: row.id, trackingCode })),
    });
  }

  await realtimePublish(projectChangesTopic(document.projectId), {
    entity: "question",
    action: "create",
    id: row.id,
    trackingCode: row.trackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  return {
    trackingCode: row.trackingCode,
    documentTrackingCode,
    ordinal: row.ordinal,
    text: row.text,
    askedBy: row.askedBy,
    status: row.status,
    refs,
  };
}

export interface QuestionWithAnswer extends QuestionDetail {
  answer: AnswerDetail | null;
}

/** 문서 하나의 전체 질문(open+pending+resolved) 스레드 - `listPendingQuestions`는
 * 프로젝트 전체의 미해결(open+pending)만 보므로, 문서 상세 화면(QAPanel)이
 * 그 문서의 질문/답변 전체를 순서대로 보여주려면 이 함수가 필요하다. */
export async function listQuestions(documentTrackingCode: string): Promise<QuestionWithAnswer[]> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode: documentTrackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${documentTrackingCode}`);

  const rows = await db.question.findMany({
    where: { documentId: document.id },
    include: { answer: true, refs: true },
    orderBy: { ordinal: "asc" },
  });
  return rows.map(
    (r: {
      trackingCode: string;
      ordinal: number;
      text: string;
      askedBy: string;
      status: string;
      refs: { trackingCode: string }[];
      answer: { body: string; answeredBy: string; answeredAt: Date } | null;
    }) => ({
      trackingCode: r.trackingCode,
      documentTrackingCode,
      ordinal: r.ordinal,
      text: r.text,
      askedBy: r.askedBy,
      status: r.status,
      refs: r.refs.map((x) => x.trackingCode),
      answer: r.answer ? { body: r.answer.body, answeredBy: r.answer.answeredBy, answeredAt: r.answer.answeredAt } : null,
    }),
  );
}

export interface PendingQuestion extends QuestionDetail {
  documentTitle: string;
}

/** "미해결" 질의(open|pending) 목록 - open은 설계자가 아직 답 안 한 것,
 * pending은 답은 했지만 AI가 아직 확인(ack) 안 한 것. 둘 다 "아직 끝나지
 * 않은 것"이라 같은 명령이 함께 보여준다(각 행의 status로 호출부가
 * 구분). */
export async function listPendingQuestions(projectId: string): Promise<PendingQuestion[]> {
  const db = getDb();
  const rows = await db.question.findMany({
    where: { status: { in: ["open", "pending"] }, document: { projectId } },
    include: { document: true, refs: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(
    (r: {
      trackingCode: string;
      ordinal: number;
      text: string;
      askedBy: string;
      status: string;
      document: { trackingCode: string; title: string };
      refs: { trackingCode: string }[];
    }) => ({
      trackingCode: r.trackingCode,
      documentTrackingCode: r.document.trackingCode,
      documentTitle: r.document.title,
      ordinal: r.ordinal,
      text: r.text,
      askedBy: r.askedBy,
      status: r.status,
      refs: r.refs.map((x) => x.trackingCode),
    }),
  );
}

/** AI가 아직 확인(ack)하지 않은 답변 건수 - C/F가 공유하는 `notices`
 * 배너("확인 안 한 질의 N건")가 씀. */
export async function countPendingQuestions(projectId: string): Promise<number> {
  const db = getDb();
  return db.question.count({ where: { status: "pending", document: { projectId } } });
}

export interface ReplyResult {
  question: QuestionDetail;
  answer: AnswerDetail;
  documentStatusTransitioned: string | null; // 자동 전이됐으면 새 상태 코드, 아니면 null
}

/** 질문 트래킹 코드로 그 질문이 속한 문서의 projectId를 구한다 - API
 * 레이어가 답변/ack 라우트의 인가(멤버 role)를 검사할 때 씀(경로에
 * projectId가 없어 requireProjectRole 미들웨어를 못 쓰므로). */
export async function getQuestionProjectId(questionTrackingCode: string): Promise<string | null> {
  const db = getDb();
  const question = await db.question.findUnique({
    where: { trackingCode: questionTrackingCode },
    include: { document: true },
  });
  return question?.document.projectId ?? null;
}

/** Answer insert + Question.status를 "pending"으로 갱신하는 평범한
 * 쓰기(설계자 답변 완료 = AI 확인 대기, 종결 아님) - 그 문서의 모든
 * 질문이 open을 벗어나면, 현재 상태에서 갈 수 있는 다음 상태가 정확히
 * 하나뿐일 때만(모호하지 않을 때만) 자동으로 그리로 전이시킨다(옛
 * reply_pending 플래그가 하던 "다 답변되면 상태 올리기" 역할을
 * 정규화된 형태로 계승 - 다만 다음 상태가 여러 개면 자동으로 고르지
 * 않고 설계자/클로드의 명시적 전이 호출에 맡긴다). */
export async function answerQuestion(
  questionTrackingCode: string,
  body: string,
  answeredBy: string,
): Promise<ReplyResult> {
  const db = getDb();
  const question = await db.question.findUnique({
    where: { trackingCode: questionTrackingCode },
    include: { document: true },
  });
  if (!question) throw new Error(`질문을 찾을 수 없습니다: ${questionTrackingCode}`);
  if (question.status !== "open") {
    throw new Error(`이미 답변됐거나 처리된 질문입니다: ${questionTrackingCode}`);
  }

  const answerRow = await db.answer.create({
    data: { questionId: question.id, body, answeredBy },
  });
  const updatedQuestion = await db.question.update({
    where: { id: question.id },
    data: { status: "pending" },
  });
  const refRows = await db.questionReference.findMany({ where: { questionId: question.id } });

  await realtimePublish(projectChangesTopic(question.document.projectId), {
    entity: "answer",
    action: "create",
    id: answerRow.id,
    trackingCode: questionTrackingCode,
    at: new Date().toISOString(),
  } satisfies ChangeEvent);

  const remainingOpen = await db.question.count({
    where: { documentId: question.documentId, status: "open" },
  });

  let documentStatusTransitioned: string | null = null;
  if (remainingOpen === 0) {
    const next = await allowedNextStatuses(question.document.docTypeId, question.document.statusId);
    if (next.length === 1) {
      await db.document.update({ where: { id: question.documentId }, data: { statusId: next[0].id } });
      documentStatusTransitioned = next[0].code;
      await resyncDocumentIndex(question.document.trackingCode);
    }
  }

  return {
    question: {
      trackingCode: updatedQuestion.trackingCode,
      documentTrackingCode: question.document.trackingCode,
      ordinal: updatedQuestion.ordinal,
      text: updatedQuestion.text,
      askedBy: updatedQuestion.askedBy,
      status: updatedQuestion.status,
      refs: refRows.map((x: { trackingCode: string }) => x.trackingCode),
    },
    answer: { body: answerRow.body, answeredBy: answerRow.answeredBy, answeredAt: answerRow.answeredAt },
    documentStatusTransitioned,
  };
}

/** AI가 pending(설계자 답변 완료) 질의를 확인 완료로 표시 - resolved로
 * 전이. pending이 아닌 상태(open/resolved)에서 호출하면 막힌다(open은
 * 아직 답변 자체가 없어 확인할 게 없고, resolved는 이미 끝났음). */
export async function acknowledgeQuestion(questionTrackingCode: string): Promise<QuestionDetail> {
  const db = getDb();
  const question = await db.question.findUnique({ where: { trackingCode: questionTrackingCode } });
  if (!question) throw new Error(`질문을 찾을 수 없습니다: ${questionTrackingCode}`);
  if (question.status !== "pending") {
    throw new Error(`답변 대기 중이거나 이미 처리된 질의입니다: ${questionTrackingCode}`);
  }
  const updated = await db.question.update({ where: { id: question.id }, data: { status: "resolved" } });
  const document = await db.document.findUnique({ where: { id: updated.documentId } });
  const refRows = await db.questionReference.findMany({ where: { questionId: question.id } });
  return {
    trackingCode: updated.trackingCode,
    documentTrackingCode: document?.trackingCode ?? "",
    ordinal: updated.ordinal,
    text: updated.text,
    askedBy: updated.askedBy,
    status: updated.status,
    refs: refRows.map((x: { trackingCode: string }) => x.trackingCode),
  };
}
