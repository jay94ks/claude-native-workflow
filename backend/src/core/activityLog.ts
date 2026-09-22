// design-notes.md "문서 코드별 활동 히트맵/로그" - 각 추적 코드에 실제로
// 어떤 동작이 언제 있었는지 기록하고, DocTypeWorkspace의 "종합 현황"이
// 쓸 히트맵/최근 활동 로그를 만들어준다.

import { prisma } from "./prisma";
import { trackingCode } from "./trackingCode";
import { guardMembership, fail } from "./actionHelpers";
import type { ActionContext } from "./documents";
import type { ActionResult } from "./types";

/**
 * docsAdd/docsGet/docsUpdate/docsDelete/docsTransition/docsTag/docsGrep가
 * syncAfterWrite()/publishDocEvent()와 같은 자리에서 호출한다(한 액션 =
 * 한 추적 코드에 대한 기록 한 줄, docsTransition은 실제로 적용된 코드마다
 * 각각). 실패해도 원래 액션의 응답에 영향을 주면 안 되므로
 * fire-and-forget - await하지 않고 실패는 경고 로그만 남긴다.
 */
export function recordActivity(projectId: string, code: string, action: string, ctx: ActionContext): void {
  prisma.activityLog
    .create({ data: { projectId, code, action, channel: ctx.channel, actorId: ctx.architectId } })
    .catch((err) => console.warn(`[activityLog] "${action}" on ${code} 기록 실패(무시):`, (err as Error).message));
}

interface HeatmapDay {
  date: string;
  count: number;
}

/**
 * docs.list와 같은 필터 모양(type 필수, kind/state 선택) - 지금
 * DocTypeWorkspace 화면에 걸려 있는 필터를 그대로 반영해서 그 필터에
 * 해당하는 문서들의 활동만 집계한다. days(기본 30, 최대 90)일치
 * 히트맵(빈 날짜는 0으로 채움)과 최근 30건 활동 로그를 함께 반환한다.
 */
export async function activitySummary(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "READ");
  if (membershipFailure) return membershipFailure;

  const { projectId, type, kind, state, days } = payload;
  if (typeof type !== "string" || !type) return fail("type이 필요합니다.");

  // 날짜 경계는 전부 UTC로만 계산한다 - `setHours`/`setDate`는 로컬
  // 타임존 기준인데 라벨은 `toISOString()`(UTC)로 뽑다 보면, 로컬이
  // UTC보다 앞선 타임존(KST 등)에서 "오늘"이 라벨에서 하루 밀려
  // 통째로 빠지는 실제 버그가 났었다(실기동 확인) - 시작점도 라벨도
  // 전부 UTC 달력 날짜로만 다루면 이 어긋남이 없어진다.
  const rangeDays = typeof days === "number" && days > 0 && days <= 90 ? Math.floor(days) : 30;
  const now = new Date();
  const sinceMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (rangeDays - 1));
  const since = new Date(sinceMs);

  const buildEmptyHeatmap = (): HeatmapDay[] => {
    const out: HeatmapDay[] = [];
    for (let i = 0; i < rangeDays; i++) {
      const d = new Date(sinceMs + i * 86_400_000);
      out.push({ date: d.toISOString().slice(0, 10), count: 0 });
    }
    return out;
  };

  const docs = await prisma.document.findMany({
    where: { projectId, type, ...(kind ? { kind } : {}), ...(state ? { state } : {}) },
    select: { id: true, kind: true },
  });
  const codes = docs.map((d) => trackingCode(d.kind, d.id));
  if (codes.length === 0) {
    return { ok: true, data: { heatmap: buildEmptyHeatmap(), recent: [] } };
  }

  const [logs, recent] = await Promise.all([
    prisma.activityLog.findMany({
      where: { projectId, code: { in: codes }, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.activityLog.findMany({
      where: { projectId, code: { in: codes } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { code: true, action: true, channel: true, createdAt: true },
    }),
  ]);

  const countsByDate = new Map<string, number>();
  for (const log of logs) {
    const key = log.createdAt.toISOString().slice(0, 10);
    countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
  }
  const heatmap = buildEmptyHeatmap().map((d) => ({ date: d.date, count: countsByDate.get(d.date) ?? 0 }));

  return { ok: true, data: { heatmap, recent } };
}
