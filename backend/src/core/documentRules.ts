// docs/design-notes.md의 "문서 상태 전이 규칙"/"type별 상세 제약"/
// "question/answer 액터 규칙 — 통합 정리"를 코드로 옮긴 순수 검증 로직.
// DB 접근은 하지 않는다 - documents.ts가 필요한 컨텍스트(부모 문서,
// 기존 자식 개수 등)를 조회해서 넘겨준다.

export type Channel = "agent" | "architect";

export const SUPPORTED_TYPES = ["doc", "plan", "question", "answer", "tracker", "test", "opinion", "issue"] as const;
export type DocType = (typeof SUPPORTED_TYPES)[number];

// Phase 2 판단: design-notes.md는 tracker의 kind를 한 번도 정하지 않았다
// (doc=SP/RP/RM/QA/BT, plan=PL, question=QU, answer=AN, test=TC,
// opinion=OP까지만 있었음) - 추적 코드 스킴(`${kind}-${id}`)에 필요해서
// 다른 2글자 코드들과 같은 관례로 `TR`을 부여했다(design-notes.md에 기록).
export const KINDS_BY_TYPE: Record<string, readonly string[]> = {
  doc: ["SP", "RP", "RM", "QA", "BT"],
  plan: ["PL"],
  question: ["QU"],
  answer: ["AN"],
  tracker: ["TR"],
  test: ["TC"],
  opinion: ["OP"],
  // Issues 탭(설계자 요청, 2026-09-20) - Plans와는 완전히 별개인 새 개념
  // (design-notes.md 기록). open/closed 두 상태만 쓰는 GitHub Issues와
  // 같은 감각이라 kind는 하나뿐이다.
  issue: ["IS"],
};

export const STATES_BY_TYPE: Record<string, readonly string[]> = {
  doc: ["draft", "review", "active", "done", "discard"],
  plan: ["added", "read", "done", "discard"],
  question: ["added", "read", "done", "discard"],
  answer: ["added", "read", "done"],
  tracker: ["added", "resumed", "ended", "canceled"],
  test: ["added", "discard"],
  opinion: ["added", "read", "done", "discard"],
  issue: ["open", "closed"],
};

export function isSupportedType(type: string): type is DocType {
  return (SUPPORTED_TYPES as readonly string[]).includes(type);
}

export function isValidKindForType(type: string, kind: string): boolean {
  return KINDS_BY_TYPE[type]?.includes(kind) ?? false;
}

export function isValidState(type: string, state: string): boolean {
  return STATES_BY_TYPE[type]?.includes(state) ?? false;
}

/** The state a freshly-created document of this type starts in. */
export function defaultStateFor(type: string): string {
  if (type === "doc") return "draft";
  if (type === "issue") return "open";
  return "added";
}

export interface ParentInfo {
  id: string;
  type: string;
  author: Channel;
}

export interface ChainCheckInput {
  type: string;
  parent: ParentInfo | null;
  existingAnswerCountForQuestion?: number; // only relevant when type === 'answer'
  chapter?: string | null;
}

/** docs/design-notes.md "type별 상세 제약" - 부모 타입/카디널리티 검증. */
export function checkChainConstraint(input: ChainCheckInput): { ok: true } | { ok: false; reason: string[] } {
  const { type, parent, chapter } = input;

  if (type === "answer") {
    if (!parent || parent.type !== "question") {
      return { ok: false, reason: ["answer의 parent_id는 반드시 question이어야 합니다."] };
    }
    if ((input.existingAnswerCountForQuestion ?? 0) > 0) {
      return {
        ok: false,
        reason: ["이 질의에는 이미 답변이 등록돼 있습니다. 새로 쓰려면 기존 답변을 docs.delete로 철회한 뒤 다시 등록하세요."],
      };
    }
  }

  if (type === "doc" && parent && parent.type !== "doc") {
    return { ok: false, reason: ["doc의 parent_id가 있다면 그 부모는 반드시 doc이어야 합니다."] };
  }

  // question/plan/tracker/test/opinion/issue: 부모 타입 제한 없음 (design-notes.md 그대로).

  if (chapter && type !== "question" && type !== "opinion") {
    return { ok: false, reason: ["chapter는 question/opinion에만 지정할 수 있습니다."] };
  }
  if (chapter && parent?.type !== "doc") {
    return { ok: false, reason: ["chapter를 지정하려면 parent가 doc이어야 합니다."] };
  }

  return { ok: true };
}

export interface TransitionInput {
  type: string;
  kind: string;
  currentState: string;
  nextState: string;
  requesterChannel: Channel;
  authorChannel: Channel; // 문서를 등록한 쪽 (question이면 질의자, answer면 그 답변을 단 쪽)
  isChainedFromArchitectRequest?: boolean; // "연쇄 전이": architect가 요청한 작업을 처리하는 흐름인지
}

const opposite = (c: Channel): Channel => (c === "agent" ? "architect" : "agent");

/** docs/design-notes.md "문서 상태 전이 규칙" - 누가 어떤 전이를 할 수 있는지. */
export function checkTransition(input: TransitionInput): { ok: true } | { ok: false; reason: string[] } {
  const { type, kind, currentState, nextState, requesterChannel, authorChannel } = input;

  if (!isValidState(type, nextState)) {
    return { ok: false, reason: [`"${nextState}"는 ${type}의 유효한 상태가 아닙니다.`] };
  }

  // BT는 클로드가 스스로 승인/폐기까지 처리하는 예외 (discard도 architect 제한 없음).
  const isSelfManagedByAgent = type === "doc" && kind === "BT";

  switch (type) {
    case "doc": {
      if (currentState === "draft" && nextState === "review") return { ok: true };
      if (currentState === "review" && nextState === "active") {
        if (requesterChannel === "architect" || isSelfManagedByAgent) return { ok: true };
        return { ok: false, reason: ["review -> active 전이는 architect만 할 수 있습니다."] };
      }
      if (currentState === "active" && nextState === "done") return { ok: true };
      if (nextState === "discard") {
        if (requesterChannel === "architect" || isSelfManagedByAgent) return { ok: true };
        return { ok: false, reason: ["discard 전이는 architect만 할 수 있습니다."] };
      }
      return { ok: false, reason: [`doc을 ${currentState}에서 ${nextState}로 전이할 수 없습니다.`] };
    }
    case "plan": {
      if (currentState === "added" && nextState === "read") {
        if (requesterChannel === "architect") return { ok: true };
        return { ok: false, reason: ["plan의 read 전이는 architect만 할 수 있습니다."] };
      }
      if (nextState === "done" || nextState === "discard") {
        if (requesterChannel === "architect") return { ok: true };
        return { ok: false, reason: ["plan의 done/discard 전이는 architect만 할 수 있습니다."] };
      }
      return { ok: false, reason: [`plan을 ${currentState}에서 ${nextState}로 전이할 수 없습니다.`] };
    }
    case "question": {
      if (currentState === "added" && nextState === "read") {
        if (requesterChannel === opposite(authorChannel)) return { ok: true };
        return { ok: false, reason: ["question의 read 전이는 답변할 쪽(질의자의 반대 채널)만 할 수 있습니다."] };
      }
      if (nextState === "discard") {
        if ((currentState === "added" || currentState === "read") && requesterChannel === authorChannel) {
          return { ok: true };
        }
        return { ok: false, reason: ["question의 discard는 질의자 본인만, 아직 해소되지 않은 상태에서만 가능합니다."] };
      }
      if (nextState === "done") {
        // 답변이 done으로 전이될 때 documents.ts가 원 질의를 함께 done으로 옮기는 경로로만 도달한다.
        return { ok: true };
      }
      return { ok: false, reason: [`question을 ${currentState}에서 ${nextState}로 전이할 수 없습니다.`] };
    }
    case "answer": {
      // authorChannel here is the ANSWERER's channel; the questioner is its opposite.
      if (currentState === "added" && nextState === "read") {
        if (requesterChannel === opposite(authorChannel)) return { ok: true };
        return { ok: false, reason: ["answer의 read 전이는 질의자만 할 수 있습니다."] };
      }
      if (currentState === "read" && nextState === "done") {
        if (requesterChannel === opposite(authorChannel)) return { ok: true };
        return { ok: false, reason: ["answer의 done 전이는 질의자만 할 수 있습니다."] };
      }
      return { ok: false, reason: [`answer를 ${currentState}에서 ${nextState}로 전이할 수 없습니다.`] };
    }
    // tracker: "클로드가 전적으로 알아서 관리한다" - architect 개입 없이 agent만.
    case "tracker": {
      if (requesterChannel !== "agent") {
        return { ok: false, reason: ["tracker의 모든 전이는 클로드(agent)만 할 수 있습니다."] };
      }
      return { ok: true };
    }
    // test: BT와 동일한 성격의 기록성 문서 - agent가 스스로 등록/폐기.
    case "test": {
      if (nextState === "discard") {
        if (requesterChannel !== "agent") {
          return { ok: false, reason: ["test의 discard는 클로드(agent)만 할 수 있습니다."] };
        }
        return { ok: true };
      }
      return { ok: false, reason: [`test를 ${currentState}에서 ${nextState}로 전이할 수 없습니다.`] };
    }
    // opinion: 설계자 → 클로드 고정 방향. authorChannel은 항상 architect다.
    case "opinion": {
      if (currentState === "added" && nextState === "read") {
        if (requesterChannel === "agent") return { ok: true };
        return { ok: false, reason: ["opinion의 read 전이는 클로드(agent)만 할 수 있습니다."] };
      }
      if (currentState === "read" && nextState === "done") {
        if (requesterChannel === "agent") return { ok: true };
        return { ok: false, reason: ["opinion의 done 전이는 클로드(agent)만 할 수 있습니다."] };
      }
      if (nextState === "discard") {
        if ((currentState === "added" || currentState === "read") && requesterChannel === "architect") {
          return { ok: true };
        }
        return { ok: false, reason: ["opinion의 discard는 architect 본인만, 아직 해소되지 않은 상태에서만 가능합니다."] };
      }
      return { ok: false, reason: [`opinion을 ${currentState}에서 ${nextState}로 전이할 수 없습니다.`] };
    }
    // issue: GitHub Issues와 같은 감각 - open/closed 둘 다 어느 채널이든
    // 오갈 수 있다(질의자/답변자 같은 비대칭 액터 구분이 필요 없는 단순한
    // open-closed 토글이라 question/answer류와 다르게 채널 제한을 두지 않았다).
    case "issue": {
      if ((currentState === "open" && nextState === "closed") || (currentState === "closed" && nextState === "open")) {
        return { ok: true };
      }
      return { ok: false, reason: [`issue를 ${currentState}에서 ${nextState}로 전이할 수 없습니다.`] };
    }
    default:
      return { ok: false, reason: [`type "${type}"의 상태 전이는 아직 구현되지 않았습니다.`] };
  }
}

/** answer가 등록될 때 답변자가 질의자의 반대 채널인지 검증. */
export function checkAnswerAuthor(questionAuthorChannel: Channel, answerAuthorChannel: Channel): boolean {
  return answerAuthorChannel === opposite(questionAuthorChannel);
}

// dependsOn readiness(위 "문서 의존성" 절 - "아직 해소되지 않은 dependsOn
// 개수") 계산용: 그 타입에서 "더 이상 진행할 게 없는" 상태들.
// Phase 2 판단: `test`는 `added` 자체가 이미 완결된 기록이라 둘 다 종결
// 상태로 취급한다(design-notes.md에 기록).
const TERMINAL_STATES_BY_TYPE: Record<string, readonly string[]> = {
  doc: ["done", "discard"],
  plan: ["done", "discard"],
  question: ["done", "discard"],
  answer: ["done"],
  tracker: ["ended", "canceled"],
  test: ["added", "discard"],
  opinion: ["done", "discard"],
  issue: ["closed"],
};

export function isTerminalState(type: string, state: string): boolean {
  return TERMINAL_STATES_BY_TYPE[type]?.includes(state) ?? false;
}
