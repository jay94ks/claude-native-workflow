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
 *
 * 설계자 요청(2026-09-22 후속) - "특정 액션이 같은 대상에 연속되는
 * 경우 마지막꺼만 유지해" - 예를 들어 문서 하나를 화면에서 여러 번
 * 클릭해서 볼 때마다(전이/저장 뒤 재조회 포함) 매번 `docs.get`이
 * 찍혀 활동 로그/히트맵이 사실상 같은 조회 하나를 여러 줄로 부풀린다.
 * 그 코드에 찍힌 가장 최근 행이 지금 기록하려는 것과 action **및
 * 행위자**(agentId - 없으면 architectId)가 같으면(연속) 그 행을 지우고
 * 새로 하나만 남긴다 - 중간에 다른 action이 끼거나, 같은 계정이어도
 * 다른 에이전트(agentId)가 한 것이면 연속으로 안 치고 둘 다 남긴다
 * (설계자 요청 - "에이전트 N개가 같은 계정을 쓴다"는 후속 확인에 따라
 * actorId만으로는 서로 다른 에이전트를 구별할 수 없어서 추가한 조건).
 */
export function recordActivity(projectId: string, code: string, action: string, ctx: ActionContext): void {
  const identity = ctx.agentId ?? ctx.architectId;
  (async () => {
    const last = await prisma.activityLog.findFirst({ where: { projectId, code }, orderBy: { createdAt: "desc" } });
    if (last && last.action === action && (last.agentId ?? last.actorId) === identity) {
      await prisma.activityLog.delete({ where: { id: last.id } });
    }
    await prisma.activityLog.create({
      data: { projectId, code, action, channel: ctx.channel, actorId: ctx.architectId, agentId: ctx.agentId ?? null },
    });
  })().catch((err) => console.warn(`[activityLog] "${action}" on ${code} 기록 실패(무시):`, (err as Error).message));
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
      select: { code: true, action: true, channel: true, agentId: true, createdAt: true },
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
