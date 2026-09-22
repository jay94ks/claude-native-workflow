// documents.ts/activityLog.ts가 공유하는 작은 헬퍼들 - 별도 파일로 뺀
// 이유는 두 파일이 서로를 값으로 import하면(activityLog.ts의
// recordActivity를 documents.ts가 쓰고, documents.ts의 guardMembership/
// fail을 activityLog.ts가 쓰면) 런타임 순환 참조가 생기기 때문이다.
// 의존 방향을 documents.ts/activityLog.ts -> actionHelpers.ts 한 방향으로만
// 두면 순환이 아예 없어진다.

import { requireMembership, MembershipError } from "./membership";
import type { ActionResult } from "./types";

export function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

export async function guardMembership(
  projectId: unknown,
  ctx: { architectId: string },
  minRole: "READ" | "WRITE"
): Promise<ActionResult | null> {
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, minRole);
    return null;
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }
}
