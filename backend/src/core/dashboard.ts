// 프로젝트 홈(대시보드) 전용 집계 오케스트레이션 - #project-dashboard.
// 각 도메인 모듈에 흩어진 카운트/최근-활동 함수들을 한 번의 호출로
// 묶어준다(server.ts 라우트를 얇게 유지). 이 파일 자체는 새 DB 접근
// 로직을 안 갖고 있다 - 전부 기존/신규 도메인 함수 재사용.

import { countDocumentsByStatus, listStaleDocuments, type DocStatusCount, type StaleDocumentView } from "./documents.js";
import { countKanbanCardsByColumn, type KanbanColumnCount } from "./kanban.js";
import { countOpenAndPendingQuestions } from "./questions.js";
import { countMessages } from "./messages.js";
import { listProjectActivity, type ProjectActivityItem } from "./activity.js";

export interface ProjectDashboard {
  docStatusCounts: DocStatusCount[];
  staleDocuments: StaleDocumentView[];
  openQuestionsCount: number;
  activeMessagesCount: number;
  kanbanColumns: KanbanColumnCount[];
  activity: ProjectActivityItem[];
}

export async function getProjectDashboard(projectId: string, opts: { staleDays?: number } = {}): Promise<ProjectDashboard> {
  const staleDays = opts.staleDays ?? 14;
  const [docStatusCounts, staleDocuments, openQuestionsCount, activeMessagesCount, kanbanColumns, activity] = await Promise.all([
    countDocumentsByStatus(projectId),
    listStaleDocuments(projectId, staleDays),
    countOpenAndPendingQuestions(projectId),
    countMessages(projectId, "active"),
    countKanbanCardsByColumn(projectId),
    listProjectActivity(projectId, 20),
  ]);
  return { docStatusCounts, staleDocuments, openQuestionsCount, activeMessagesCount, kanbanColumns, activity };
}
