import { getDb } from "./db.js";
import { paginateInMemory, type Page } from "./pagination.js";

// 같은 계정으로 여러 Claude 세션을 동시에 띄울 때 서로를 구분하고
// "지금 뭘 작업 중인지"를 광고판처럼 등록해 동시성 충돌을 줄인다
// (SP-976DD4ED, #multi-session-workclaim). Session.id는 CLI/MCP가
// 공유하는 apiFetch()가 자동으로 붙이는 X-Session-Id 헤더 값을 그대로
// 쓴다 - 이 파일은 순수 데이터 계층이라 헤더 파싱은 api/server.ts가
// 담당하고 여기엔 이미 뽑아낸 sessionId 문자열만 넘어온다.

export type WorkTargetType = "document" | "plan" | "sourceFile";

export interface SessionDetail {
  id: string;
  userId: string;
  name: string;
  clientKind: string;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface WorkClaimDetail {
  id: string;
  sessionId: string;
  sessionName: string;
  projectId: string;
  targetType: string;
  targetKey: string;
  claimedAt: Date;
}

const DEFAULT_ALIVE_MINUTES = 30;

function aliveSince(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

// 마지막 갱신에서 일정 시간 안 지났으면 쓰기를 건너뛴다 - 매 요청마다
// DB에 쓰면 부담이 크지만, 이 스로틀 자체는 프로세스 메모리에만 있는
// 캐시라 재시작하면 초기화된다(그래도 다음 요청에서 다시 쓰기만 할
// 뿐 문제 없음).
const HEARTBEAT_THROTTLE_MS = 60_000;
const lastHeartbeatWriteAt = new Map<string, number>();

/** 인증 미들웨어가 매 요청마다 부른다(#multi-session-workclaim) -
 * X-Session-Id 헤더가 있는 요청에서만 호출됨. 호출부(middleware/
 * auth.ts)는 반드시 await해야 한다 - fire-and-forget으로 뒀더니
 * 같은 요청 안에서 방금 등록한 세션을 곧장 이어 쓰는 흐름(등록 직후
 * work_claim/session_rename 호출)이 "세션을 찾을 수 없음"으로 깨지는
 * 경합을 실측으로 발견해 고쳤다 - 아래 스로틀 덕에 대부분의 호출은
 * DB 왕복 없이 즉시 반환되므로 await해도 비용이 크지 않다. */
export async function touchSession(sessionId: string, userId: string, clientKind: string): Promise<void> {
  const now = Date.now();
  const last = lastHeartbeatWriteAt.get(sessionId);
  if (last && now - last < HEARTBEAT_THROTTLE_MS) return;
  lastHeartbeatWriteAt.set(sessionId, now);

  const db = getDb();
  await db.session.upsert({
    where: { id: sessionId },
    update: { lastSeenAt: new Date(), clientKind },
    // 기본 이름은 세션 id 그대로 - CNW_SESSION_NAME으로 사람이 직접
    // 정한 값이면 그 자체가 이미 알아보기 좋은 이름이고, 랜덤
    // UUID라도 8자로 잘라 뭉개는 것보다 전체를 두는 편이 `docs session
    // rename`으로 나중에 바꾸기 전까지 최소한 서로 다른 세션임을
    // 확실히 구분할 수 있다.
    create: { id: sessionId, userId, name: sessionId, clientKind },
  });
}

export async function listSessions(userId: string, sinceMinutes?: number): Promise<SessionDetail[]> {
  const db = getDb();
  const where = { userId, ...(sinceMinutes !== undefined ? { lastSeenAt: { gte: aliveSince(sinceMinutes) } } : {}) };
  return db.session.findMany({ where, orderBy: { lastSeenAt: "desc" } });
}

/** "이 프로젝트에서 어떤 설계자의 어떤 세션이 활동 중인지"(설계자
 * 지시, 프로젝트 홈 "더보기" → 전체 목록 페이지) - WorkClaim을 한
 * 번이라도 남긴 적 있는 세션들을 계정(User)과 함께, 최근 활동순으로
 * 보여준다. WorkClaim은 프로젝트에 묶여 있지만 Session 자체는 계정
 * 전체 스코프라 두 단계로 조회한다: 이 프로젝트의 distinct
 * sessionId 목록 → 그 세션들을 lastSeenAt 역순으로 조회 후 메모리에서
 * 페이지네이션(#project-dashboard의 paginateInMemory와 같은 이유 -
 * 세션 개수는 애초에 그 프로젝트 멤버 수 규모라 적음). */
export async function listProjectSessions(projectId: string, page: number, pageSize: number): Promise<Page<SessionDetail>> {
  const db = getDb();
  const claimSessions = await db.workClaim.findMany({ where: { projectId }, select: { sessionId: true }, distinct: ["sessionId"] });
  const sessionIds = claimSessions.map((c: { sessionId: string }) => c.sessionId);
  if (sessionIds.length === 0) return paginateInMemory([], page, pageSize);
  const sessions = await db.session.findMany({ where: { id: { in: sessionIds } }, orderBy: { lastSeenAt: "desc" } });
  return paginateInMemory(sessions, page, pageSize);
}

/** 본인 세션만 이름을 바꿀 수 있다(다른 세션 이름을 마음대로 못
 * 바꾸게). */
export async function renameSession(sessionId: string, requesterId: string, name: string): Promise<SessionDetail> {
  if (!name.trim()) throw new Error("이름이 필요합니다");
  const db = getDb();
  const existing = await db.session.findUnique({ where: { id: sessionId } });
  if (!existing) throw new Error(`세션을 찾을 수 없습니다: ${sessionId}`);
  if (existing.userId !== requesterId) throw new Error("본인 세션만 이름을 바꿀 수 있습니다");
  return db.session.update({ where: { id: sessionId }, data: { name: name.trim() } });
}

/** targetType/targetKey와 "1단계 링크"로 연결된 대상들 - 문서↔문서
 * 링크(DocumentLink 양방향), 계획↔문서 근거(PlanDocumentRef 양방향),
 * 문서↔소스 파일 연결(DocumentSourceLink 양방향)까지만 본다(설계자
 * 확정 - 전이적 확장은 안 함, SP-976DD4ED). */
async function relatedTargets(targetType: WorkTargetType, targetKey: string): Promise<{ targetType: WorkTargetType; targetKey: string }[]> {
  const db = getDb();
  const related: { targetType: WorkTargetType; targetKey: string }[] = [];

  if (targetType === "document") {
    const doc = await db.document.findUnique({ where: { trackingCode: targetKey } });
    if (doc) {
      const [linksOut, backlinks, planRefs, sourceLinks] = await Promise.all([
        db.documentLink.findMany({ where: { fromDocumentId: doc.id }, select: { toTrackingCode: true } }),
        db.documentLink.findMany({ where: { toTrackingCode: targetKey }, include: { fromDocument: { select: { trackingCode: true } } } }),
        db.planDocumentRef.findMany({ where: { trackingCode: targetKey }, include: { plan: { select: { trackingCode: true } } } }),
        db.documentSourceLink.findMany({ where: { documentId: doc.id }, select: { filePath: true } }),
      ]);
      for (const l of linksOut) related.push({ targetType: "document", targetKey: l.toTrackingCode });
      for (const b of backlinks) related.push({ targetType: "document", targetKey: b.fromDocument.trackingCode });
      for (const p of planRefs) related.push({ targetType: "plan", targetKey: p.plan.trackingCode });
      for (const s of sourceLinks) related.push({ targetType: "sourceFile", targetKey: s.filePath });
    }
  } else if (targetType === "plan") {
    const plan = await db.plan.findUnique({ where: { trackingCode: targetKey } });
    if (plan) {
      const refs = await db.planDocumentRef.findMany({ where: { planId: plan.id }, select: { trackingCode: true } });
      for (const r of refs) related.push({ targetType: "document", targetKey: r.trackingCode });
    }
  } else if (targetType === "sourceFile") {
    const links = await db.documentSourceLink.findMany({ where: { filePath: targetKey }, include: { document: { select: { trackingCode: true } } } });
    for (const l of links) related.push({ targetType: "document", targetKey: l.document.trackingCode });
  }

  return related;
}

export async function claimWork(sessionId: string, projectId: string, targetType: WorkTargetType, targetKey: string): Promise<WorkClaimDetail> {
  const db = getDb();
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`세션을 찾을 수 없습니다: ${sessionId} - 먼저 아무 docs 명령이나 호출해 세션을 등록하세요`);
  const row = await db.workClaim.create({ data: { sessionId, projectId, targetType, targetKey } });
  return { ...row, sessionName: session.name };
}

export async function releaseWork(sessionId: string, projectId: string, targetType: WorkTargetType, targetKey: string): Promise<void> {
  const db = getDb();
  await db.workClaim.deleteMany({ where: { sessionId, projectId, targetType, targetKey } });
}

export async function listWorkClaims(projectId: string, aliveMinutes = DEFAULT_ALIVE_MINUTES): Promise<WorkClaimDetail[]> {
  const db = getDb();
  const rows = await db.workClaim.findMany({
    where: { projectId, session: { lastSeenAt: { gte: aliveSince(aliveMinutes) } } },
    include: { session: { select: { name: true } } },
    orderBy: { claimedAt: "desc" },
  });
  return rows.map((r: { id: string; sessionId: string; projectId: string; targetType: string; targetKey: string; claimedAt: Date; session: { name: string } }) => ({
    id: r.id,
    sessionId: r.sessionId,
    sessionName: r.session.name,
    projectId: r.projectId,
    targetType: r.targetType,
    targetKey: r.targetKey,
    claimedAt: r.claimedAt,
  }));
}

/** 저장/전이 직전에 부른다 - 대상 자체 + 1단계 링크 대상까지에 걸린,
 * *다른* 세션의 살아있는 클레임을 찾아 notices 문구로 돌려준다(락이
 * 아니라 경고만, SP-976DD4ED). 호출한 세션 자신의 클레임은 제외. */
export async function findConflictNotices(
  projectId: string,
  targetType: WorkTargetType,
  targetKey: string,
  excludeSessionId: string | undefined,
  aliveMinutes = DEFAULT_ALIVE_MINUTES,
): Promise<string[]> {
  const targets = [{ targetType, targetKey }, ...(await relatedTargets(targetType, targetKey))];
  const db = getDb();
  const claims = await db.workClaim.findMany({
    where: {
      projectId,
      OR: targets.map((t) => ({ targetType: t.targetType, targetKey: t.targetKey })),
      ...(excludeSessionId ? { sessionId: { not: excludeSessionId } } : {}),
      session: { lastSeenAt: { gte: aliveSince(aliveMinutes) } },
    },
    include: { session: { select: { name: true, lastSeenAt: true } } },
  });
  const now = Date.now();
  return claims.map((c: { targetType: string; targetKey: string; session: { name: string; lastSeenAt: Date } }) => {
    const minutesAgo = Math.max(0, Math.round((now - c.session.lastSeenAt.getTime()) / 60_000));
    const where = c.targetType === targetType && c.targetKey === targetKey ? "이 대상" : `연결된 ${c.targetType} ${c.targetKey}`;
    // 앞에 "⚠ "를 안 붙인다 - CLI/MCP의 notices 프롤로그 출력기가 이미
    // 매 줄 앞에 그 기호를 붙이므로, 여기서 또 붙이면 중복 표시된다
    // (permissions.ts의 formatPermissionBanner()도 같은 이유로 안 붙임).
    return `세션 "${c.session.name}"이 ${minutesAgo}분 전까지 활동하며 ${where}을(를) 작업 중이라고 등록했습니다 - 겹치는 작업이면 조율하세요.`;
  });
}
