// docs.add / docs.get / docs.update / docs.delete / docs.transition / docs.tag /
// docs.list / docs.search / docs.status / docs.grep 실제 구현.
// Phase 1: doc/plan/question/answer. Phase 2: tracker/test/opinion +
// dependsOn readiness 정렬. Phase 3: Meilisearch(`docs.search`의 `q`),
// PostgreSQL POSIX 정규식(`docs.grep`, `docs.search`의 `grep`),
// `docs.status` 집계, 백엔드 캐시.

import { prisma } from "./prisma";
import { generateDocumentId, trackingCode, parseTrackingCode } from "./trackingCode";
import {
  verifyTaggedRefs,
  toDocResponse,
  toDocSummary,
  replaceRelated,
  replaceDependsOn,
  loadRelated,
  loadDependsOn,
  loadRelatedBatch,
  loadDependsOnBatch,
} from "./refs";
import {
  isSupportedType,
  isValidKindForType,
  defaultStateFor,
  checkChainConstraint,
  checkTransition,
  checkAnswerAuthor,
  isTerminalState,
  type Channel,
  type ParentInfo,
} from "./documentRules";
import type { ActionResult } from "./types";
import { searchDocuments } from "./searchIndex";
import { grepDocument, grepProjectDocumentIds } from "./grep";
import { getCached, setCached } from "./cache";
import { notify } from "./messages";
import { publishDocEvent } from "./emqx";
import { recordActivity } from "./activityLog";
import { fail, guardMembership } from "./actionHelpers";

const opposite = (c: Channel): Channel => (c === "agent" ? "architect" : "agent");

export interface ActionContext {
  architectId: string;
  channel: Channel;
}

function randomEtag(): string {
  return generateDocumentId() + generateDocumentId(); // 16 chars is plenty for a scaffold-stage etag
}

async function insertWithFreshId(data: Record<string, unknown>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateDocumentId();
    try {
      return await prisma.document.create({ data: { ...data, id } as any });
    } catch (err: unknown) {
      const isUniqueClash = (err as { code?: string })?.code === "P2002";
      if (!isUniqueClash || attempt === 4) throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * 문서가 등록/수정/전이/태깅될 때마다 EMQX로 브로드캐스트한다 - 검색
 * 인덱싱/캐시 무효화는 이제 이 브로드캐스트를 구독하는 쪽
 * (broadcastSubscriber.ts)이 비동기로 처리한다(Phase 3/4의 직접 동기
 * 호출을 대체 - design-notes.md "실시간 브로드캐스트(EMQX)").
 */
function syncAfterWrite(doc: {
  id: string;
  projectId: string;
  type: string;
  kind: string;
  state: string;
  branch: string | null;
  author: string;
  title: string;
  content: string;
}): void {
  publishDocEvent({ op: "upsert", projectId: doc.projectId, doc });
}

function removeAfterDelete(id: string, projectId: string): void {
  publishDocEvent({ op: "delete", projectId, id });
}

export async function docsAdd(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "WRITE");
  if (membershipFailure) return membershipFailure;

  const { projectId, type, kind, parentId, chapter, title, content, related, dependsOn, fileRefs, branch, commitId } = payload;

  if (typeof type !== "string" || !isSupportedType(type)) {
    return fail(`type "${type}"은 지원하지 않습니다.`);
  }
  if (typeof kind !== "string" || !isValidKindForType(type, kind)) {
    return fail(`"${kind}"는 ${type}의 유효한 kind가 아닙니다.`);
  }
  if (typeof title !== "string" || !title) return fail("title이 필요합니다.");

  // opinion은 방향이 고정돼 있다: architect가 클로드에게 쓰는 용도뿐.
  if (type === "opinion" && ctx.channel !== "architect") {
    return fail("opinion은 architect만 등록할 수 있습니다.");
  }

  let parent: ParentInfo | null = null;
  if (parentId != null) {
    if (typeof parentId !== "string") return fail("parent는 추적 코드 문자열이어야 합니다.");
    const parsed = parseTrackingCode(parentId);
    if (!parsed) return fail(`"${parentId}"는 유효한 추적 코드가 아닙니다.`);
    const parentDoc = await prisma.document.findFirst({ where: { id: parsed.id, projectId } });
    if (!parentDoc) return fail(`부모 문서 ${parentId}를 찾을 수 없습니다.`);
    parent = { id: parentDoc.id, type: parentDoc.type, author: parentDoc.author as Channel };
  }

  let existingAnswerCountForQuestion = 0;
  if (type === "answer" && parent) {
    existingAnswerCountForQuestion = await prisma.document.count({ where: { parentId: parent.id, type: "answer" } });
  }

  const chainCheck = checkChainConstraint({ type, parent, existingAnswerCountForQuestion, chapter });
  if (!chainCheck.ok) return fail(chainCheck.reason);

  if (type === "answer" && parent && !checkAnswerAuthor(parent.author, ctx.channel)) {
    return fail("answer는 질의자의 반대 채널만 등록할 수 있습니다.");
  }

  if (related !== undefined) {
    const check = await verifyTaggedRefs(projectId, related);
    if (!check.ok) return fail(check.reason);
  }
  if (dependsOn !== undefined) {
    const check = await verifyTaggedRefs(projectId, dependsOn);
    if (!check.ok) return fail(check.reason);
  }

  const doc = await insertWithFreshId({
    project: { connect: { id: projectId } },
    parent: parent ? { connect: { id: parent.id } } : undefined,
    etag: randomEtag(),
    type,
    kind,
    state: defaultStateFor(type),
    branch: branch ?? null,
    commitId: commitId ?? null,
    chapter: chapter ?? null,
    title,
    author: ctx.channel,
    content: content ?? "",
    fileRefs: fileRefs ?? [],
  } as any);

  if (related !== undefined) await replaceRelated(doc.id, related);
  if (dependsOn !== undefined) await replaceDependsOn(doc.id, dependsOn);

  await syncAfterWrite(doc);

  // design-notes.md "notice 예시" - 질의/답변/의견 등록은 상대 채널에게 자동으로 알린다.
  const code = trackingCode(doc.kind, doc.id);
  recordActivity(projectId, code, "docs.add", ctx);
  if (type === "question") {
    await notify(projectId, opposite(ctx.channel), `[${code}]에 질의가 등록되었습니다.`);
  } else if (type === "answer" && parent) {
    await notify(projectId, opposite(ctx.channel), `[${code}]에 답변이 등록되었습니다.`);
  } else if (type === "opinion") {
    await notify(projectId, "agent", `[${code}]에 의견이 등록되었습니다.`);
  }

  return { ok: true, data: { code, etag: doc.etag } };
}

export async function docsGet(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "READ");
  if (membershipFailure) return membershipFailure;

  const parsed = parseTrackingCode(payload.code ?? "");
  if (!parsed) return fail(`"${payload.code}"는 유효한 추적 코드가 아닙니다.`);

  const doc = await prisma.document.findFirst({ where: { id: parsed.id, projectId: payload.projectId } });
  if (!doc) return fail(`${payload.code} 문서를 찾을 수 없습니다.`);

  const [related, dependsOn] = await Promise.all([loadRelated(doc.id), loadDependsOn(doc.id)]);
  recordActivity(payload.projectId, payload.code, "docs.get", ctx);
  return { ok: true, data: toDocResponse({ ...doc, related, dependsOn }) };
}

/**
 * 여러 문서의 dependsOn 중 아직 "해소"(isTerminalState)되지 않은 참조
 * 개수를 한 번에 센다 - DocumentDependsOn 테이블로 정규화된 덕에 문서
 * 하나당 쿼리 한 번(N+1)이 아니라 배치 하나로 끝난다(이전 Json 배열
 * 버전은 "대규모 데이터셋 최적화는 다음 라운드 스코프"라고 미뤄뒀던
 * 부분인데, 이번 정규화로 자연스럽게 해결됐다).
 */
async function countUnresolvedDependsOnBatch(documentIds: string[]): Promise<Map<string, number>> {
  if (documentIds.length === 0) return new Map();
  const rows = await prisma.documentDependsOn.findMany({
    where: { documentId: { in: documentIds } },
    include: { target: { select: { type: true, state: true } } },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!isTerminalState(r.target.type, r.target.state)) {
      map.set(r.documentId, (map.get(r.documentId) ?? 0) + 1);
    }
  }
  return map;
}

export async function docsList(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "READ");
  if (membershipFailure) return membershipFailure;

  const { projectId, type, kind, state, parentId, page, sort } = payload;
  const pageSize = 50;
  const pageNumber = typeof page === "number" && page > 0 ? page : 1;

  const where = {
    projectId,
    ...(type ? { type } : {}),
    ...(kind ? { kind } : {}),
    ...(state ? { state } : {}),
    ...(parentId ? { parentId } : {}),
  };

  // docs/design-notes.md "문서 의존성": sort: 'dependency'는 readiness(아직
  // 해소되지 않은 dependsOn 개수) 오름차순 - DocumentDependsOn 정규화 덕에
  // 배치 쿼리 한 번으로 계산한다(이전 Json 버전이 "다음 라운드 스코프"로
  // 미뤄뒀던 대규모 최적화가 자연스럽게 해결됨).
  if (sort === "dependency") {
    const all = await prisma.document.findMany({ where, orderBy: { createdAt: "desc" } });
    const unresolvedByDoc = await countUnresolvedDependsOnBatch(all.map((d) => d.id));
    const withReadiness = all.map((doc) => ({ doc, unresolved: unresolvedByDoc.get(doc.id) ?? 0 }));
    withReadiness.sort((a, b) => a.unresolved - b.unresolved);
    const total = withReadiness.length;
    const page_ = withReadiness.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    const [relatedByDoc, dependsOnByDoc] = await Promise.all([
      loadRelatedBatch(page_.map(({ doc }) => doc.id)),
      loadDependsOnBatch(page_.map(({ doc }) => doc.id)),
    ]);
    return {
      ok: true,
      data: {
        page: pageNumber,
        total,
        items: page_.map(({ doc }) =>
          toDocSummary({ ...doc, related: relatedByDoc.get(doc.id) ?? [], dependsOn: dependsOnByDoc.get(doc.id) ?? [] })
        ),
      },
    };
  }

  const [total, items] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pageNumber - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const [relatedByDoc, dependsOnByDoc] = await Promise.all([
    loadRelatedBatch(items.map((d) => d.id)),
    loadDependsOnBatch(items.map((d) => d.id)),
  ]);
  return {
    ok: true,
    data: {
      page: pageNumber,
      total,
      items: items.map((doc) => toDocSummary({ ...doc, related: relatedByDoc.get(doc.id) ?? [], dependsOn: dependsOnByDoc.get(doc.id) ?? [] })),
    },
  };
}

export async function docsUpdate(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "WRITE");
  if (membershipFailure) return membershipFailure;

  const { projectId, code, etag, title, content, chapter, related, dependsOn, fileRefs } = payload;
  const parsed = parseTrackingCode(code ?? "");
  if (!parsed) return fail(`"${code}"는 유효한 추적 코드가 아닙니다.`);

  const doc = await prisma.document.findFirst({ where: { id: parsed.id, projectId } });
  if (!doc) return fail(`${code} 문서를 찾을 수 없습니다.`);
  if (doc.etag !== etag) return fail(`${code}의 etag가 일치하지 않습니다 - 최신 상태를 다시 읽어오세요.`);

  if (related !== undefined) {
    const check = await verifyTaggedRefs(projectId, related);
    if (!check.ok) return fail(check.reason);
  }
  if (dependsOn !== undefined) {
    const check = await verifyTaggedRefs(projectId, dependsOn);
    if (!check.ok) return fail(check.reason);
  }

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: {
      title: title ?? doc.title,
      content: content ?? doc.content,
      chapter: chapter === undefined ? doc.chapter : chapter,
      fileRefs: fileRefs ?? (doc.fileRefs as any),
      etag: randomEtag(),
    },
  });

  if (related !== undefined) await replaceRelated(doc.id, related);
  if (dependsOn !== undefined) await replaceDependsOn(doc.id, dependsOn);

  await syncAfterWrite(updated);
  recordActivity(projectId, code, "docs.update", ctx);
  return { ok: true, data: { code, etag: updated.etag } };
}

/** design-notes.md: 하드 삭제는 answer 철회 용도로만. */
export async function docsDelete(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "WRITE");
  if (membershipFailure) return membershipFailure;

  const { projectId, code, etag } = payload;
  const parsed = parseTrackingCode(code ?? "");
  if (!parsed) return fail(`"${code}"는 유효한 추적 코드가 아닙니다.`);

  const doc = await prisma.document.findFirst({ where: { id: parsed.id, projectId } });
  if (!doc) return fail(`${code} 문서를 찾을 수 없습니다.`);
  if (doc.type !== "answer") {
    return fail("docs.delete는 answer 철회 용도로만 사용할 수 있습니다. 다른 타입은 docs.transition으로 상태를 옮기세요.");
  }
  if (doc.etag !== etag) return fail(`${code}의 etag가 일치하지 않습니다 - 최신 상태를 다시 읽어오세요.`);
  if (doc.author !== ctx.channel) {
    return fail("자신이 등록한 answer만 철회할 수 있습니다.");
  }

  await prisma.document.delete({ where: { id: doc.id } });
  await removeAfterDelete(doc.id, projectId);
  recordActivity(projectId, code, "docs.delete", ctx);
  return { ok: true };
}

export async function docsTransition(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "WRITE");
  if (membershipFailure) return membershipFailure;

  const { projectId, state } = payload;
  if (typeof state !== "object" || state === null) {
    return fail('state는 { "XX-xxxxxxxx": [새 상태, 기존 상태] } 형태여야 합니다.');
  }

  const entries = Object.entries(state as Record<string, [string, string]>);
  const reasons: string[] = [];
  const toApply: { id: string; nextState: string }[] = [];
  const cascades: { id: string; nextState: string }[] = [];

  for (const [code, tuple] of entries) {
    const [nextState, expectedState] = tuple;
    const parsed = parseTrackingCode(code);
    if (!parsed) {
      reasons.push(`"${code}"는 유효한 추적 코드가 아닙니다.`);
      continue;
    }
    const doc = await prisma.document.findFirst({ where: { id: parsed.id, projectId } });
    if (!doc) {
      reasons.push(`${code} 문서를 찾을 수 없습니다.`);
      continue;
    }
    if (doc.state !== expectedState) {
      reasons.push(`${code}의 현재 상태(${doc.state})가 예상한 상태(${expectedState})와 다릅니다.`);
      continue;
    }
    const check = checkTransition({
      type: doc.type,
      kind: doc.kind,
      currentState: doc.state,
      nextState,
      requesterChannel: ctx.channel,
      authorChannel: doc.author as Channel,
    });
    if (!check.ok) {
      reasons.push(...check.reason.map((r) => `${code}: ${r}`));
      continue;
    }
    toApply.push({ id: doc.id, nextState });

    // design-notes.md: answer가 done으로 전이되면 원 질의도 함께 done으로 전이한다.
    if (doc.type === "answer" && nextState === "done" && doc.parentId) {
      cascades.push({ id: doc.parentId, nextState: "done" });
    }
  }

  if (reasons.length > 0) return fail(reasons);

  const data: Record<string, { etag: string }> = {};
  const touched: Awaited<ReturnType<typeof prisma.document.update>>[] = [];
  await prisma.$transaction(async (tx) => {
    for (const { id, nextState } of [...toApply, ...cascades]) {
      const updated = await tx.document.update({ where: { id }, data: { state: nextState, etag: randomEtag() } });
      data[trackingCode(updated.kind, updated.id)] = { etag: updated.etag };
      touched.push(updated);
    }
  });

  for (const doc of touched) {
    await syncAfterWrite(doc);
    recordActivity(projectId, trackingCode(doc.kind, doc.id), "docs.transition", ctx);
  }
  return { ok: true, data };
}

export async function docsTag(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "WRITE");
  if (membershipFailure) return membershipFailure;

  const { projectId, code, etag, related, dependsOn } = payload;
  const parsed = parseTrackingCode(code ?? "");
  if (!parsed) return fail(`"${code}"는 유효한 추적 코드가 아닙니다.`);

  const doc = await prisma.document.findFirst({ where: { id: parsed.id, projectId } });
  if (!doc) return fail(`${code} 문서를 찾을 수 없습니다.`);
  if (doc.etag !== etag) return fail(`${code}의 etag가 일치하지 않습니다 - 최신 상태를 다시 읽어오세요.`);

  if (related !== undefined) {
    const check = await verifyTaggedRefs(projectId, related);
    if (!check.ok) return fail(check.reason);
  }
  if (dependsOn !== undefined) {
    const check = await verifyTaggedRefs(projectId, dependsOn);
    if (!check.ok) return fail(check.reason);
  }

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: { etag: randomEtag() },
  });

  if (related !== undefined) await replaceRelated(doc.id, related);
  if (dependsOn !== undefined) await replaceDependsOn(doc.id, dependsOn);

  await syncAfterWrite(updated);
  recordActivity(projectId, code, "docs.tag", ctx);
  return { ok: true, data: { code, etag: updated.etag } };
}

export async function docsSearch(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "READ");
  if (membershipFailure) return membershipFailure;

  const { projectId, q, grep, type, kind, state, branch, author, page } = payload;
  if (q && grep) return fail("q와 grep은 동시에 쓸 수 없습니다 - 파라미터 이름으로 일반 검색/정규식 검색을 구분합니다.");
  if (!q && !grep) return fail("q(일반 검색) 또는 grep(POSIX 정규식) 중 하나가 필요합니다.");

  const pageSize = 50;
  const pageNumber = typeof page === "number" && page > 0 ? page : 1;
  const cacheKey = `search::${JSON.stringify(payload)}`;
  const cached = getCached<ActionResult["data"]>(projectId, cacheKey);
  if (cached) return { ok: true, data: cached };

  let ids: string[];
  let total: number;

  if (grep) {
    // docs.grep과 같은 문법(PostgreSQL POSIX ERE) - 정규식은 raw SQL로,
    // 구조화 필터는 그 결과 id 목록에 대해 Prisma로 다시 좁힌다.
    const matchedIds = await grepProjectDocumentIds(projectId, grep);
    const filtered = await prisma.document.findMany({
      where: {
        id: { in: matchedIds },
        ...(type ? { type } : {}),
        ...(kind ? { kind } : {}),
        ...(state ? { state } : {}),
        ...(branch ? { branch } : {}),
        ...(author ? { author } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    total = filtered.length;
    ids = filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize).map((d) => d.id);
  } else {
    const result = await searchDocuments({ projectId, q, type, kind, state, branch, author, page: pageNumber, pageSize });
    ids = result.ids;
    total = result.total;
  }

  // Meilisearch/grep 둘 다 id만 주므로, 응답에 필요한 전체 문서 내용은 PostgreSQL에서 채운다
  // (Meilisearch 인덱스는 검색 전용이고 PostgreSQL이 정본 - "Meilisearch 활용 최적화 방안" 원칙).
  const docs = await prisma.document.findMany({ where: { id: { in: ids }, projectId } });
  const byId = new Map(docs.map((d) => [d.id, d]));
  const [relatedByDoc, dependsOnByDoc] = await Promise.all([loadRelatedBatch(docs.map((d) => d.id)), loadDependsOnBatch(docs.map((d) => d.id))]);
  const items = ids
    .map((id) => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map((doc) => toDocResponse({ ...doc, related: relatedByDoc.get(doc.id) ?? [], dependsOn: dependsOnByDoc.get(doc.id) ?? [] }));

  const data = { page: pageNumber, total, items };
  setCached(projectId, cacheKey, data);
  return { ok: true, data };
}

export async function docsStatus(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "READ");
  if (membershipFailure) return membershipFailure;

  const { projectId } = payload;
  const cacheKey = "status";
  const cached = getCached<ActionResult["data"]>(projectId, cacheKey);
  if (cached) return { ok: true, data: cached };

  const [grouped, latest] = await Promise.all([
    prisma.document.groupBy({
      by: ["kind", "state"],
      where: { projectId },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.document.findFirst({ where: { projectId }, orderBy: { updatedAt: "desc" } }),
  ]);

  const byKind: Record<string, { byState: Record<string, { count: number; lastUpdatedAt: Date | null }> }> = {};
  for (const row of grouped) {
    byKind[row.kind] ??= { byState: {} };
    byKind[row.kind].byState[row.state] = { count: row._count._all, lastUpdatedAt: row._max.updatedAt };
  }

  const data = { lastEtag: latest?.etag ?? null, byKind };
  setCached(projectId, cacheKey, data);
  return { ok: true, data };
}

export async function docsGrep(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "READ");
  if (membershipFailure) return membershipFailure;

  const { projectId, code, pattern } = payload;
  if (typeof pattern !== "string" || !pattern) return fail("pattern이 필요합니다(POSIX ERE).");

  const parsed = parseTrackingCode(code ?? "");
  if (!parsed) return fail(`"${code}"는 유효한 추적 코드가 아닙니다.`);

  const doc = await prisma.document.findFirst({ where: { id: parsed.id, projectId } });
  if (!doc) return fail(`${code} 문서를 찾을 수 없습니다.`);

  const matches = await grepDocument(doc.content, pattern);
  recordActivity(projectId, code, "docs.grep", ctx);
  return { ok: true, data: { code, matches } };
}
