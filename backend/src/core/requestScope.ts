// docs/plan-nickname-apikey-policy.md - v2의 core/requestScope.ts를 그대로
// 계승한 패턴: API 키 인증의 "스코프 제한"을 요청 전체에 전파하는 최하위
// 모듈이다. api/server.ts(/api/actions)와 api/rest.ts(web())가 요청당 한 번
// 이 스코프로 핸들러 실행을 감싸면, 그 안에서 실행되는 모든 core 함수
// (membership.ts의 requireMembership 등, 매개변수로 스코프를 안 받는 함수
// 포함)가 매개변수 없이도 "지금 이 요청이 어떤 키로 인증됐는가"를 알 수
// 있다 - 액션 핸들러 수십 개에 개별적으로 체크를 끼워 넣는 것보다 누락
// 위험이 없다. 다른 core 모듈에 대한 의존성이 없는 최하위 모듈로 유지해
// 순환 참조를 만들지 않는다(v2와 동일 원칙).

import { AsyncLocalStorage } from "node:async_hooks";

export type KeyScope =
  | { type: "unrestricted" } // personal 키 또는 로그인 - 제한 없음
  | { type: "project"; projectId: string }; // "프로젝트 단위 키" - 그 프로젝트 안에서만

const UNRESTRICTED: KeyScope = { type: "unrestricted" };

const als = new AsyncLocalStorage<KeyScope>();

export function runWithKeyScope<T>(scope: KeyScope, fn: () => T): T {
  return als.run(scope, fn);
}

/** 요청 컨텍스트 밖(서버 기동 시 시드, 브로드캐스트 구독자 등)에서
 * 호출되면 항상 unrestricted - 특정 API 키를 대행하는 게 아니라 시스템
 * 자신의 동작이므로 제한 대상이 아니다. */
export function getActiveKeyScope(): KeyScope {
  return als.getStore() ?? UNRESTRICTED;
}
