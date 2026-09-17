// server.ts의 37개 도메인 섹션이 공통으로 쓰는 헬퍼 8개 - 원래
// server.ts 안에 흩어져 있었는데(각자 처음 쓰이는 섹션 바로 앞에
// 선언돼 있어, 실제로는 여러 섹션이 서로의 헬퍼를 앞쪽 정의에
// 의존하는 형태였다), 도메인별 라우트 파일 분리(#api-route-domain-split,
// BL-57F8DF17 #58) 1단계로 여기로 옮겼다. 이 파일은 순수 구조 정리
// 단계라 동작은 전혀 안 바뀐다 - 헬퍼 위치만 바뀜.
import type { Request, Response, NextFunction } from "express";
import type { AuthedRequest } from "../middleware/auth.js";
import type { MessageOrigin } from "../core/messages.js";
import type { DocumentSortKey } from "../core/documents.js";
import { countPendingQuestions } from "../core/questions.js";
import { getMemberRole, roleSatisfies } from "../core/members.js";

export function asyncRoute(
  fn: (req: AuthedRequest, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req as AuthedRequest, res).catch(next);
  };
}

// #message-origin-tagging - CLI/MCP가 공유하는 apiclient.ts 하나가
// 모든 요청에 X-Client-Kind: cli를 자동으로 붙인다(새 명령을 만들지
// 않고 기존 message send/message_send 그대로 자동 태깅, 설계자
// 지시). 웹 프런트엔드는 이 헤더를 붙이는 코드 경로가 없으므로
// 자연히 "designer"로 남는다.
export function resolveMessageOrigin(req: AuthedRequest): MessageOrigin {
  return req.headers["x-client-kind"] === "cli" ? "ai" : "designer";
}

// 문서는 trackingCode로만 식별되고(경로에 projectId 없음) 지금까지
// requireProjectRole을 못 걸어 GET/PUT/transition/links가 authenticate만
// 걸린 채 남아있었다(신규 버그 수정 - questions/comments 라우트에서
// 이미 겪은 것과 같은 원인). resolveEffectivePermission()으로
// read/write/delete를 확인하고, 오버라이드가 적용됐으면 notices 배열에
// 안내 배너를 얹는다(없으면 필드 생략 - 평소엔 노이즈 없음).
export function withNotices<T extends object>(payload: T, ...noticeSources: (string | string[] | null | undefined)[]): T & { notices?: string[] } {
  const notices = noticeSources.flatMap((n) => (n ? (Array.isArray(n) ? n : [n]) : []));
  return notices.length ? { ...payload, notices } : payload;
}

// #opinion-target-notice - 문서/계획을 AI가 다시 열 때 미확인 의견을
// 자동으로 눈에 띄게 하는 알림(설계자 요청). pendingQuestionNotice와
// 같은 모양이지만 "이 대상 하나"만 본다.
export function openOpinionNotice(openCount: number, trackingCode: string): string | null {
  if (openCount === 0) return null;
  return `이 대상에 AI가 아직 확인하지 않은 의견이 ${openCount}건 있습니다 - docs opinion list <projectId> --target ${trackingCode}로 확인하세요`;
}

/** X-Session-Id 헤더 값(있으면) - 세션 자신의 클레임은 충돌 경고에서
 * 제외할 때 쓴다(#multi-session-workclaim). */
export function resolveSessionId(req: AuthedRequest): string | undefined {
  const value = req.headers["x-session-id"];
  return typeof value === "string" && value ? value : undefined;
}

const DOCUMENT_SORT_KEYS: DocumentSortKey[] = ["createdAt:desc", "createdAt:asc", "updatedAt:desc"];
export function parseDocumentSort(raw: unknown): DocumentSortKey | undefined {
  return DOCUMENT_SORT_KEYS.includes(raw as DocumentSortKey) ? (raw as DocumentSortKey) : undefined;
}

export async function pendingQuestionNotice(projectId: string): Promise<string | null> {
  const n = await countPendingQuestions(projectId);
  if (n === 0) return null;
  return `이 프로젝트에 설계자가 답변했지만 아직 확인하지 않은 질의가 ${n}건 있습니다 - docs question ack <trackingCode>로 처리하세요`;
}

export async function requireEditorForTarget(projectId: string, userId: string): Promise<boolean> {
  const role = await getMemberRole(projectId, userId);
  return roleSatisfies(role, "editor");
}
