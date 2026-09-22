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

/**
 * 설계자 요청(2026-09-22 후속) - "AI 에이전트 N개와 그 에이전트를 돌리는
 * 설계자 1명은 같은 계정으로 작업할거야" 다음 지적: "에이전트들이
 * 설계자의 계정으로 모든 동작을 하기 때문에 API 키 단에서 처리를 해야
 * 할거 같은데. 추가로 뭘 더 설계하는게 아니라" - 맞는 지적이라 별도
 * 헤더/환경변수(X-Cnw-Agent-Id/CNW_AGENT_ID)를 새로 만들었던 걸
 * 되돌렸다. 같은 계정을 쓰는 여러 에이전트를 구별하는 건 이미 있는
 * apiKey 체계로 충분하다 - 에이전트마다 라벨을 붙여 키를 따로 발급하면
 * (`apiKey.create`) "어떤 API 키로 인증됐는지"가 곧 "어느 에이전트인지"
 * 다. WEB UI(architect)는 사람 한 명이라 구별할 필요가 없으므로 항상
 * undefined.
 */
export function resolveAgentId(channel: Channel, apiKeyLabel: string | null | undefined, apiKeyId: string | undefined): string | undefined {
  if (channel !== "agent") return undefined;
  return apiKeyLabel ?? apiKeyId;
}
