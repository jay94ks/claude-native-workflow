import { getDb } from "./db.js";
import { canSeeHiddenProject } from "./projects.js";

export interface ActivityItem {
  type: "document_create" | "document_edit" | "question_ask" | "answer" | "comment" | "message";
  projectId: string;
  trackingCode: string | null;
  summary: string;
  at: string; // ISO
}

/** 이미 있는 작성자 FK들(Document.createdBy/DocumentRevision.editedBy/
 * Question.askedBy/Answer.answeredBy/Comment.authorId/Message.authorId)을
 * 재사용해 하나의 타임라인으로 합친다 - 별도 감사 로그 테이블 신설 안 함
 * (이 프로젝트의 정규화 원칙과 일치). 숨겨진 프로젝트의 활동은
 * viewerId가 그 프로젝트의 Member이거나 소속 팀의 팀장일 때만 포함. */
export async function listUserActivity(viewerId: string, targetUserId: string, limit = 30): Promise<ActivityItem[]> {
  const db = getDb();

  const [documents, revisions, questions, answers, comments, messages] = await Promise.all([
    db.document.findMany({ where: { createdBy: targetUserId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.documentRevision.findMany({
      where: { editedBy: targetUserId },
      include: { document: true },
      orderBy: { editedAt: "desc" },
      take: limit,
    }),
    db.question.findMany({
      where: { askedBy: targetUserId },
      include: { document: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.answer.findMany({
      where: { answeredBy: targetUserId },
      include: { question: { include: { document: true } } },
      orderBy: { answeredAt: "desc" },
      take: limit,
    }),
    db.comment.findMany({ where: { authorId: targetUserId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.message.findMany({ where: { authorId: targetUserId }, orderBy: { createdAt: "desc" }, take: limit }),
  ]);

  const items: ActivityItem[] = [
    ...documents.map(
      (d: { projectId: string; trackingCode: string; title: string; createdAt: Date }): ActivityItem => ({
        type: "document_create",
        projectId: d.projectId,
        trackingCode: d.trackingCode,
        summary: `문서 "${d.title}"를 작성했습니다`,
        at: d.createdAt.toISOString(),
      }),
    ),
    ...revisions.map(
      (r: { document: { projectId: string; trackingCode: string; title: string }; editedAt: Date }): ActivityItem => ({
        type: "document_edit",
        projectId: r.document.projectId,
        trackingCode: r.document.trackingCode,
        summary: `문서 "${r.document.title}"를 수정했습니다`,
        at: r.editedAt.toISOString(),
      }),
    ),
    ...questions.map(
      (q: { document: { projectId: string; trackingCode: string }; trackingCode: string; createdAt: Date }): ActivityItem => ({
        type: "question_ask",
        projectId: q.document.projectId,
        trackingCode: q.trackingCode,
        summary: `${q.document.trackingCode}에 질의를 등록했습니다`,
        at: q.createdAt.toISOString(),
      }),
    ),
    ...answers.map(
      (a: {
        question: { document: { projectId: string; trackingCode: string }; trackingCode: string };
        answeredAt: Date;
      }): ActivityItem => ({
        type: "answer",
        projectId: a.question.document.projectId,
        trackingCode: a.question.trackingCode,
        summary: `${a.question.document.trackingCode}의 질의에 답변했습니다`,
        at: a.answeredAt.toISOString(),
      }),
    ),
    ...comments.map(
      (c: { projectId: string; trackingCode: string; createdAt: Date }): ActivityItem => ({
        type: "comment",
        projectId: c.projectId,
        trackingCode: c.trackingCode,
        summary: `${c.trackingCode}에 코멘트를 남겼습니다`,
        at: c.createdAt.toISOString(),
      }),
    ),
    ...messages.map(
      (m: { projectId: string; createdAt: Date }): ActivityItem => ({
        type: "message",
        projectId: m.projectId,
        trackingCode: null,
        summary: "메시지를 보냈습니다",
        at: m.createdAt.toISOString(),
      }),
    ),
  ];

  const visibleByProject = new Map<string, boolean>();
  const filtered: ActivityItem[] = [];
  for (const item of items) {
    let visible = visibleByProject.get(item.projectId);
    if (visible === undefined) {
      const project = await db.project.findUnique({ where: { id: item.projectId } });
      visible = !project?.hidden || (await canSeeHiddenProject(item.projectId, viewerId));
      visibleByProject.set(item.projectId, visible);
    }
    if (visible) filtered.push(item);
  }

  filtered.sort((a, b) => (a.at < b.at ? 1 : -1));
  return filtered.slice(0, limit);
}
