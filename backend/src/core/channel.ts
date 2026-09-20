import type { Channel } from "./documentRules";

/**
 * Phase 1 판단 (design-notes.md "역할 구분" 절이 "CLI/MCP=클로드,
 * WEB UI=architect"라고만 정했고, 그 판별을 서버가 실제로 어떻게 하는지는
 * 안 정해져 있었음): CLI/MCP가 공유하는 shared/apiclient.ts가 모든 요청에
 * `X-Cnw-Channel: agent`를 싣는다. 이 헤더가 없으면 architect로 간주한다 -
 * Phase 9에서 만들 WEB UI는 이 헤더를 보내지 않을 것이므로 자연히
 * architect로 판별된다. (design-notes.md에 이 판단을 기록해뒀다.)
 */
export function resolveChannel(header: string | undefined): Channel {
  return header === "agent" ? "agent" : "architect";
}
