import { lookupTrackingCode, extractTrackingCodes } from "./tracking.js";
import { getDocument } from "./documents.js";
import { getPlanByTrackingCode } from "./plans.js";
import { getKanbanCardByTrackingCode } from "./kanban.js";
import { getQuestionByTrackingCode } from "./questions.js";

// SP-47F91774 - "완료된 계획이 참조 문서/계획에 반영 안 됨" 패턴(문서/
// 계획 본문에 "이 PN은 아직 미구현"이라고 적혀 있는데 실제로는
// completed인 경우)을 검토 세션이 매번 본문에서 코드를 눈으로 찾아
// 하나씩 다시 조회해 대조해야 했던 것을 한 번의 호출로 대체한다.
// core/tracking.ts의 중앙 레지스트리(withTrackingCode로 모든 타입이
// 등록됨)를 그대로 재사용해, 새 매핑 테이블 없이 어떤 프리픽스든
// 타입을 알아낸다.

export interface RefStatus {
  trackingCode: string;
  which: string | null; // 레지스트리에 없으면(삭제/오탈자 등) null
  title: string | null;
  status: string | null;
}

/** 대상 하나(문서/계획/칸반카드/질의)의 title+status만 가볍게 뽑는다 -
 * 본문은 안 가져옴(상태 대조가 목적이라 필요 없음). 대상을 못 찾으면
 * (지운 문서를 아직 언급하는 경우 등) null들로 조용히 채운다 - 하나
 * 못 찾았다고 나머지 조회 전체가 실패하면 안 됨. */
async function resolveOne(projectId: string, code: string): Promise<RefStatus> {
  const lookup = await lookupTrackingCode(projectId, code);
  if (!lookup) return { trackingCode: code, which: null, title: null, status: null };
  if (lookup.which === "document") {
    const doc = await getDocument(code);
    return { trackingCode: code, which: "document", title: doc?.title ?? null, status: doc?.statusCode ?? null };
  }
  if (lookup.which === "plan") {
    const plan = await getPlanByTrackingCode(code);
    return { trackingCode: code, which: "plan", title: plan?.title ?? null, status: plan?.status ?? null };
  }
  if (lookup.which === "kanbanCard") {
    const card = await getKanbanCardByTrackingCode(code);
    return { trackingCode: code, which: "kanbanCard", title: card?.title ?? null, status: card?.columnName ?? null };
  }
  if (lookup.which === "question") {
    const q = await getQuestionByTrackingCode(code);
    return { trackingCode: code, which: "question", title: q?.text.slice(0, 60) ?? null, status: q?.status ?? null };
  }
  return { trackingCode: code, which: lookup.which, title: null, status: null };
}

/** questions.ts의 resolveTargetByTrackingCode와 같은 이유로
 * projectId를 안 받는다 - trackingCode는 각 엔티티 테이블 자체에
 * 전역 unique라(중앙 레지스트리는 프로젝트 단위 유일성 보장용) 어느
 * 테이블에 있는지 순서대로 시도하는 것만으로 충분하고, 호출부(REST
 * 라우트)가 projectId를 미리 알 필요가 없다 - 대상을 찾으면서
 * projectId도 같이 얻는다(이후 참조 코드 조회에 재사용). */
async function sourceBody(sourceTrackingCode: string): Promise<{ body: string; projectId: string }> {
  const doc = await getDocument(sourceTrackingCode);
  if (doc) return { body: doc.body, projectId: doc.projectId };
  const plan = await getPlanByTrackingCode(sourceTrackingCode);
  if (plan) return { body: plan.body, projectId: plan.projectId };
  const card = await getKanbanCardByTrackingCode(sourceTrackingCode);
  if (card) return { body: card.body ?? "", projectId: card.projectId };
  throw new Error(`대상을 찾을 수 없습니다(문서/계획/칸반 카드만 지원): ${sourceTrackingCode}`);
}

/** source(문서/계획/칸반 카드)의 본문에서 언급된 모든 추적 코드를
 * 찾아, 각각의 현재 title/status를 병렬로 모아 반환한다. */
export async function getRefsStatus(sourceTrackingCode: string): Promise<RefStatus[]> {
  const { body, projectId } = await sourceBody(sourceTrackingCode);
  const codes = extractTrackingCodes(body, sourceTrackingCode);
  return Promise.all(codes.map((code) => resolveOne(projectId, code)));
}

/** REST 라우트가 권한 확인에 쓴다(대상을 소유한 프로젝트를 알아야
 * requireProjectRole과 같은 방식으로 viewer 이상인지 확인 가능). */
export async function getRefsStatusSourceProjectId(sourceTrackingCode: string): Promise<string | null> {
  try {
    const { projectId } = await sourceBody(sourceTrackingCode);
    return projectId;
  } catch {
    return null;
  }
}
