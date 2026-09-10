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
  status: string;
}

export interface AnswerDetail {
  body: string;
  answeredBy: string;
  answeredAt: Date;
}

/** 클로드가 어떤 문서에 대해 설계자에게 질의할 때마다 한 행 - 옛
 * "## 답변 대기" 섹션 안 체크리스트를 완전히 대체한다(CRLF 정규식으로
 * 본문을 스캔하던 버그 계열이 구조적으로 사라짐 - 질문 자체가 DB
 * 레코드라 텍스트 스캔이 필요 없다). */
export async function addQuestion(documentTrackingCode: string, text: string): Promise<QuestionDetail> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode: documentTrackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${documentTrackingCode}`);

  const count = await db.question.count({ where: { documentId: document.id } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await withTrackingCode<any>(QUESTION_TYPE_CODE, (trackingCode) =>
    db.question.create({
      data: {
        documentId: document.id,
        trackingCode,
        ordinal: count + 1,
        text,
        status: "open",
      },
    }),
  );

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
    status: row.status,
  };
}

export interface PendingQuestion extends QuestionDetail {
  documentTitle: string;
}

export async function listPendingQuestions(projectId: string): Promise<PendingQuestion[]> {
  const db = getDb();
  const rows = await db.question.findMany({
    where: { status: "open", document: { projectId } },
    include: { document: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(
    (r: { trackingCode: string; ordinal: number; text: string; status: string; document: { trackingCode: string; title: string } }) => ({
      trackingCode: r.trackingCode,
      documentTrackingCode: r.document.trackingCode,
      documentTitle: r.document.title,
      ordinal: r.ordinal,
      text: r.text,
      status: r.status,
    }),
  );
}

export interface ReplyResult {
  question: QuestionDetail;
  answer: AnswerDetail;
  documentStatusTransitioned: string | null; // 자동 전이됐으면 새 상태 코드, 아니면 null
}

/** Answer insert + Question.status 갱신하는 평범한 쓰기 - 그 문서의
 * 모든 질문이 답변되면, 현재 상태에서 갈 수 있는 다음 상태가 정확히
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
  if (question.status === "answered") {
    throw new Error(`이미 답변된 질문입니다: ${questionTrackingCode}`);
  }

  const answerRow = await db.answer.create({
    data: { questionId: question.id, body, answeredBy },
  });
  const updatedQuestion = await db.question.update({
    where: { id: question.id },
    data: { status: "answered" },
  });

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
      status: updatedQuestion.status,
    },
    answer: { body: answerRow.body, answeredBy: answerRow.answeredBy, answeredAt: answerRow.answeredAt },
    documentStatusTransitioned,
  };
}
