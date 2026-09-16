import { getDb } from "./db.js";
import { lookupMonitoringLabel } from "./monitoringRegistry.js";

// #usage-monitoring - "CNW로 어떤 요청/명령/흐름이 자주 목격되는지"를
// 설계자가 직접 보고 어떤 기능을 유지/보완/수정/추가할지 판단하는 데
// 쓰는 사용 통계. 원자적 raw 로그가 아니라 카운터만 쌓는다(설계자
// 확인 - 시계열 아님, 현재 누적 총건수 스냅숏만) - 무한정 쌓이는 로그
// 테이블의 정리/보존 정책이 필요 없다.

const TRANSITION_WINDOW_MS = 5 * 60 * 1000; // 5분 - 이 안의 연이은 호출만 "흐름"으로 집계

// "직전 호출이 뭐였는지"는 DB에 안 남기고 모듈 전역 인메모리로만
// 추적한다(재시작하면 리셋 - 스냅숏 성격과 일치, 영속화 불필요).
// 키는 X-Session-Id가 있으면 그 값, 없으면 userId(다른 세션의 호출이
// 섞여 잘못된 전이로 잡히는 걸 최대한 줄임).
const lastCallByKey = new Map<string, { pattern: string; at: number }>();

/** 요청 하나를 기록한다 - 패턴별 누적 카운트(RequestStat) upsert +
 * 직전 호출과 5분 이내면 전이 카운트(RequestTransitionStat)도
 * upsert. 실패해도 응답 자체를 막으면 안 되므로 호출부(미들웨어)가
 * await 후 에러를 삼킨다. durationMs는 호출부(미들웨어)가 요청 시작~
 * res.on("finish") 사이를 재서 넘긴다 - 평균은 별도 컬럼 없이
 * totalDurationMs/count로 매번 계산(설계자 요청, #usage-monitoring). */
export async function recordRequest(
  method: string,
  routePattern: string,
  projectId: string | null,
  origin: string,
  transitionKey: string,
  durationMs: number,
): Promise<void> {
  const db = getDb();
  // Prisma가 복합 unique where에 null을 못 받는다(실측: "Argument
  // `projectId` must not be null" - 필드 자체는 nullable로 선언해도
  // 컴파운드 유니크 조회 시엔 거부됨) - 그래서 저장은 항상 ""(sentinel)
  // 로 정규화한다(스키마 필드 주석 참고).
  const storedProjectId = projectId ?? "";
  await db.requestStat.upsert({
    where: { projectId_routePattern_method_origin: { projectId: storedProjectId, routePattern, method, origin } },
    create: { projectId: storedProjectId, routePattern, method, origin, count: 1, totalDurationMs: durationMs },
    update: { count: { increment: 1 }, totalDurationMs: { increment: durationMs }, lastSeenAt: new Date() },
  });

  const now = Date.now();
  const previous = lastCallByKey.get(transitionKey);
  lastCallByKey.set(transitionKey, { pattern: `${method} ${routePattern}`, at: now });
  if (previous && now - previous.at <= TRANSITION_WINDOW_MS) {
    const toPattern = `${method} ${routePattern}`;
    if (previous.pattern !== toPattern) {
      await db.requestTransitionStat.upsert({
        where: { projectId_fromPattern_toPattern: { projectId: storedProjectId, fromPattern: previous.pattern, toPattern } },
        create: { projectId: storedProjectId, fromPattern: previous.pattern, toPattern, count: 1 },
        update: { count: { increment: 1 } },
      });
    }
  }
}

interface RequestStatRow {
  projectId: string | null;
  routePattern: string;
  method: string;
  origin: string;
  count: number;
  totalDurationMs: number;
  lastSeenAt: Date;
}

interface RequestTransitionStatRow {
  projectId: string | null;
  fromPattern: string;
  toPattern: string;
  count: number;
}

export interface LabeledStat {
  method: string;
  routePattern: string;
  label: string; // "docs xxx" 또는 매핑이 없으면 "METHOD routePattern" 그대로
  mcp: string | null;
  origin: string;
  count: number;
  avgMs: number; // totalDurationMs / count(반올림) - 호출 하나당 평균 소요 시간
  lastSeenAt: Date;
}

function avgOf(totalDurationMs: number, count: number): number {
  return count > 0 ? Math.round(totalDurationMs / count) : 0;
}

function labelFor(method: string, routePattern: string): { label: string; mcp: string | null } {
  const entry = lookupMonitoringLabel(method, routePattern);
  return entry ? { label: entry.cli, mcp: entry.mcp } : { label: `${method} ${routePattern}`, mcp: null };
}

export interface LabeledTransition {
  from: string;
  to: string;
  count: number;
}

/** RequestTransitionStat에 저장된 "METHOD routePattern" 형태를 다시
 * 쪼개 labelFor()로 명령 이름으로 바꾼다 - 전이 표도 raw route가
 * 아니라 "docs get → docs patch" 식으로 보이게. */
function labelPattern(pattern: string): string {
  const spaceIdx = pattern.indexOf(" ");
  const method = pattern.slice(0, spaceIdx);
  const routePattern = pattern.slice(spaceIdx + 1);
  return labelFor(method, routePattern).label;
}

/** projectId를 주면 그 프로젝트 것만(경로에 :projectId가 없는
 * 라우트는 안 잡힘), null이면 설치 전체(모든 프로젝트 합산 - 같은
 * method/routePattern/origin이면 projectId가 달라도 하나로 묶어서
 * 더함). limit은 각각(패턴/전이) 상위 몇 건까지 반환할지. */
export async function getMonitoringStats(
  projectId: string | null,
  limit: number,
): Promise<{ stats: LabeledStat[]; transitions: LabeledTransition[] }> {
  const db = getDb();
  if (projectId !== null) {
    const rows = await db.requestStat.findMany({ where: { projectId }, orderBy: { count: "desc" }, take: limit });
    const transitionRows = await db.requestTransitionStat.findMany({
      where: { projectId },
      orderBy: { count: "desc" },
      take: limit,
    });
    return {
      stats: rows.map((r: RequestStatRow) => ({ ...labelFor(r.method, r.routePattern), method: r.method, routePattern: r.routePattern, origin: r.origin, count: r.count, avgMs: avgOf(r.totalDurationMs, r.count), lastSeenAt: r.lastSeenAt })),
      transitions: transitionRows.map((r: RequestTransitionStatRow) => ({ from: labelPattern(r.fromPattern), to: labelPattern(r.toPattern), count: r.count })),
    };
  }

  // 설치 전체 - projectId 구분 없이 (method, routePattern, origin)
  // 기준으로 다시 합산한다(같은 패턴이 여러 프로젝트에 걸쳐 따로
  // 저장돼 있으므로). totalDurationMs도 같이 더해뒀다가 마지막에
  // avgMs로 환산한다(LabeledStat 자체엔 totalDurationMs를 안 노출).
  const allStats = await db.requestStat.findMany();
  const statAccMap = new Map<string, { stat: Omit<LabeledStat, "avgMs">; totalDurationMs: number }>();
  for (const r of allStats) {
    const key = `${r.method} ${r.routePattern} ${r.origin}`;
    const existing = statAccMap.get(key);
    if (existing) {
      existing.stat.count += r.count;
      existing.totalDurationMs += r.totalDurationMs;
      if (r.lastSeenAt > existing.stat.lastSeenAt) existing.stat.lastSeenAt = r.lastSeenAt;
    } else {
      statAccMap.set(key, {
        stat: { ...labelFor(r.method, r.routePattern), method: r.method, routePattern: r.routePattern, origin: r.origin, count: r.count, lastSeenAt: r.lastSeenAt },
        totalDurationMs: r.totalDurationMs,
      });
    }
  }
  const stats = [...statAccMap.values()]
    .map((acc) => ({ ...acc.stat, avgMs: avgOf(acc.totalDurationMs, acc.stat.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const allTransitions = await db.requestTransitionStat.findMany();
  const transitionMap = new Map<string, LabeledTransition>();
  for (const r of allTransitions) {
    const key = `${r.fromPattern} -> ${r.toPattern}`;
    const existing = transitionMap.get(key);
    if (existing) existing.count += r.count;
    else transitionMap.set(key, { from: labelPattern(r.fromPattern), to: labelPattern(r.toPattern), count: r.count });
  }
  const transitions = [...transitionMap.values()].sort((a, b) => b.count - a.count).slice(0, limit);

  return { stats, transitions };
}
