import { getDb } from "./db.js";
import { canSeeProject } from "./projects.js";
import { listRecentKanbanCards } from "./kanban.js";

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
 * (이 프로젝트의 정규화 원칙과 일치). 각 프로젝트의 활동은
 * canSeeProject()가 통과하는 프로젝트만 포함(멤버/팀장/그룹 관리자,
 * 또는 공개+그룹 읽기 권한). */
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
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.answer.findMany({
      where: { answeredBy: targetUserId },
      include: { question: true },
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
      (q: { projectId: string; targetKey: string; trackingCode: string; createdAt: Date }): ActivityItem => ({
        type: "question_ask",
        projectId: q.projectId,
        trackingCode: q.trackingCode,
        summary: `${q.targetKey}에 질의를 등록했습니다`,
        at: q.createdAt.toISOString(),
      }),
    ),
    ...answers.map(
      (a: {
        question: { projectId: string; targetKey: string; trackingCode: string };
        answeredAt: Date;
      }): ActivityItem => ({
        type: "answer",
        projectId: a.question.projectId,
        trackingCode: a.question.trackingCode,
        summary: `${a.question.targetKey}의 질의에 답변했습니다`,
        at: a.answeredAt.toISOString(),
      }),
    ),
    ...comments.map(
      (c: { projectId: string; targetKey: string; createdAt: Date }): ActivityItem => ({
        type: "comment",
        projectId: c.projectId,
        trackingCode: null,
        summary: `${c.targetKey}에 코멘트를 남겼습니다`,
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
      visible = project ? await canSeeProject(project, viewerId) : false;
      visibleByProject.set(item.projectId, visible);
    }
    if (visible) filtered.push(item);
  }

  filtered.sort((a, b) => (a.at < b.at ? 1 : -1));
  return filtered.slice(0, limit);
}

export interface ProjectActivityItem {
  type: "document_create" | "document_edit" | "question_ask" | "answer" | "comment" | "message" | "kanban_card_create";
  trackingCode: string | null;
  summary: string;
  at: string; // ISO
}

/** listUserActivity와 같은 구조(Promise.all + 타입 태깅 + 시간순
 * 병합정렬 + slice)를 프로젝트 단위로 복제한 대시보드용 버전 -
 * 이미 한 프로젝트로 좁혀진 호출이라(라우트에서 requireProjectRole로
 * 인가) listUserActivity처럼 프로젝트별 canSeeProject 필터링 루프가
 * 필요 없다(#project-dashboard). listUserActivity의 document_create/
 * document_edit summary는 trackingCode를 문자열에 안 박아서
 * TrackingCodeText로 클릭이 안 되는 흠이 있었는데(질문/코멘트 항목만
 * targetKey가 우연히 본문에 들어가 클릭됐음), 여기서는 모든 항목의
 * summary에 추적 코드를 직접 박아 일관되게 클릭 가능하게 했다. */
export async function listProjectActivity(projectId: string, limit = 20): Promise<ProjectActivityItem[]> {
  const db = getDb();

  const [documents, revisions, questions, answers, comments, messages, kanbanCards] = await Promise.all([
    db.document.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { trackingCode: true, title: true, createdAt: true },
    }),
    db.documentRevision.findMany({
      where: { document: { projectId } },
      include: { document: { select: { trackingCode: true, title: true } } },
      orderBy: { editedAt: "desc" },
      take: limit,
    }),
    db.question.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { targetKey: true, trackingCode: true, createdAt: true },
    }),
    db.answer.findMany({
      where: { question: { projectId } },
      include: { question: { select: { targetKey: true, trackingCode: true } } },
      orderBy: { answeredAt: "desc" },
      take: limit,
    }),
    db.comment.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { targetKey: true, createdAt: true },
    }),
    db.message.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: limit, select: { createdAt: true } }),
    listRecentKanbanCards(projectId, limit),
  ]);

  const items: ProjectActivityItem[] = [
    ...documents.map(
      (d: { trackingCode: string; title: string; createdAt: Date }): ProjectActivityItem => ({
        type: "document_create",
        trackingCode: d.trackingCode,
        summary: `문서 "${d.title}"(${d.trackingCode})를 작성했습니다`,
        at: d.createdAt.toISOString(),
      }),
    ),
    ...revisions.map(
      (r: { document: { trackingCode: string; title: string }; editedAt: Date }): ProjectActivityItem => ({
        type: "document_edit",
        trackingCode: r.document.trackingCode,
        summary: `문서 "${r.document.title}"(${r.document.trackingCode})를 수정했습니다`,
        at: r.editedAt.toISOString(),
      }),
    ),
    ...questions.map(
      (q: { targetKey: string; trackingCode: string; createdAt: Date }): ProjectActivityItem => ({
        type: "question_ask",
        trackingCode: q.trackingCode,
        summary: `${q.targetKey}에 질의(${q.trackingCode})를 등록했습니다`,
        at: q.createdAt.toISOString(),
      }),
    ),
    ...answers.map(
      (a: { question: { targetKey: string; trackingCode: string }; answeredAt: Date }): ProjectActivityItem => ({
        type: "answer",
        trackingCode: a.question.trackingCode,
        summary: `${a.question.targetKey}의 질의(${a.question.trackingCode})에 답변했습니다`,
        at: a.answeredAt.toISOString(),
      }),
    ),
    ...comments.map(
      (c: { targetKey: string; createdAt: Date }): ProjectActivityItem => ({
        type: "comment",
        trackingCode: null,
        summary: `${c.targetKey}에 코멘트를 남겼습니다`,
        at: c.createdAt.toISOString(),
      }),
    ),
    ...messages.map(
      (m: { createdAt: Date }): ProjectActivityItem => ({
        type: "message",
        trackingCode: null,
        summary: "메시지를 보냈습니다",
        at: m.createdAt.toISOString(),
      }),
    ),
    ...kanbanCards.map(
      (c: { trackingCode: string; title: string; createdAt: Date }): ProjectActivityItem => ({
        type: "kanban_card_create",
        trackingCode: c.trackingCode,
        summary: `칸반 카드 "${c.title}"(${c.trackingCode})를 만들었습니다`,
        at: c.createdAt.toISOString(),
      }),
    ),
  ];

  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items.slice(0, limit);
}
