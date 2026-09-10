import { AsyncLocalStorage } from "node:async_hooks";

// API 키 인증의 "스코프 제한"을 요청 전체에 전파하는 낮은 레벨 모듈 -
// middleware/auth.ts가 요청당 한 번 설정하면, 그 요청 안에서 실행되는
// 모든 core 함수(getMemberRole/isTeamAdmin/resolveEffectivePermission
// 등, req를 매개변수로 안 받는 함수 포함)가 매개변수 없이도 "지금
// 이 요청이 어떤 키로 인증됐는가"를 알 수 있다 - 라우트 수십 개에
// 개별적으로 체크를 끼워 넣는 것보다 누락 위험이 없다(core/members.ts
// 등이 이 모듈을 가져다 쓴다). 다른 core 모듈에 대한 의존성이 전혀
// 없는 최하위 모듈로 유지해 순환 참조를 만들지 않는다.

export type KeyScope =
  | { type: "unrestricted" } // JWT 로그인 또는 "개인 키" - 제한 없음(로그인과 동등)
  | { type: "project"; projectId: string } // "프로젝트 단위 개인 키"
  | { type: "team"; teamId: string }; // "팀 단위 관리 키"

const UNRESTRICTED: KeyScope = { type: "unrestricted" };

const als = new AsyncLocalStorage<KeyScope>();

export function runWithKeyScope<T>(scope: KeyScope, fn: () => T): T {
  return als.run(scope, fn);
}

/** 요청 컨텍스트 밖(서버 기동 시 시드, 웹훅, 내부 배경 작업 등)에서
 * 호출되면 항상 unrestricted - 이런 호출은 특정 API 키를 대행하는 게
 * 아니라 시스템 자신의 동작이므로 제한 대상이 아니다. */
export function getActiveKeyScope(): KeyScope {
  return als.getStore() ?? UNRESTRICTED;
}
