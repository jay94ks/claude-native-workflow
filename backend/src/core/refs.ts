import { prisma } from "./prisma";
import { parseTrackingCode, trackingCode } from "./trackingCode";

export interface TaggedRef {
  code: string;
  etag: string;
}

/**
 * docs/design-notes.md "문서간 참조"/"의존성" - related/dependsOn 입력은
 * `{code, etag}` 쌍이다: 태깅하려는 시점에 봤던 etag와 실제 etag가
 * 다르면(그 사이 대상 문서가 바뀌었으면) 실패시킨다.
 */
export async function verifyTaggedRefs(projectId: string, refs: unknown): Promise<{ ok: true } | { ok: false; reason: string[] }> {
  if (!Array.isArray(refs)) return { ok: false, reason: ["related/dependsOn은 {code, etag} 배열이어야 합니다."] };

  for (const ref of refs as TaggedRef[]) {
    if (typeof ref?.code !== "string" || typeof ref?.etag !== "string") {
      return { ok: false, reason: ["related/dependsOn의 각 항목은 { code, etag } 형태여야 합니다."] };
    }
    const parsed = parseTrackingCode(ref.code);
    if (!parsed) return { ok: false, reason: [`"${ref.code}"는 유효한 추적 코드가 아닙니다.`] };

    const target = await prisma.document.findFirst({ where: { id: parsed.id, projectId } });
    if (!target) return { ok: false, reason: [`${ref.code} 문서를 찾을 수 없습니다.`] };
    if (target.etag !== ref.etag) {
      return { ok: false, reason: [`${ref.code}의 etag가 태깅 시점과 다릅니다 - 최신 상태를 다시 읽어오세요.`] };
    }
  }

  return { ok: true };
}

/**
 * related/dependsOn을 각각 별도 테이블(DocumentRelated/DocumentDependsOn)로
 * 정규화한 것(설계자 지시, 2026-09-20) - 이전엔 Document.related/dependsOn
 * Json 컬럼이었다(Phase 1 스캐폴딩 "다음 라운드에서 필요하면 정규화" 메모
 * 그대로). docsAdd/docsUpdate/docsTag가 매번 "전체 교체" 시맨틱을 쓰므로
 * (관련 문서를 하나씩 추가/제거하는 액션이 아니라 항상 새 배열 전체를
 * 받는다), 여기서도 그대로 deleteMany + createMany로 통째로 교체한다.
 */
export async function replaceRelated(documentId: string, refs: TaggedRef[]): Promise<void> {
  const rows = refs.map((r) => ({ documentId, targetId: parseTrackingCode(r.code)!.id, etag: r.etag }));
  await prisma.$transaction([
    prisma.documentRelated.deleteMany({ where: { documentId } }),
    ...(rows.length > 0 ? [prisma.documentRelated.createMany({ data: rows })] : []),
  ]);
}

export async function replaceDependsOn(documentId: string, refs: TaggedRef[]): Promise<void> {
  const rows = refs.map((r) => ({ documentId, targetId: parseTrackingCode(r.code)!.id, etag: r.etag }));
  await prisma.$transaction([
    prisma.documentDependsOn.deleteMany({ where: { documentId } }),
    ...(rows.length > 0 ? [prisma.documentDependsOn.createMany({ data: rows })] : []),
  ]);
}

/** API 응답의 related/dependsOn은 여전히 `{code, etag}[]` 모양이다 - 정규화된
 * 테이블에서 target의 kind를 조인해 추적 코드 문자열로 다시 조립한다. */
export async function loadRelated(documentId: string): Promise<TaggedRef[]> {
  const rows = await prisma.documentRelated.findMany({ where: { documentId }, include: { target: { select: { kind: true } } } });
  return rows.map((r) => ({ code: trackingCode(r.target.kind, r.targetId), etag: r.etag }));
}

export async function loadDependsOn(documentId: string): Promise<TaggedRef[]> {
  const rows = await prisma.documentDependsOn.findMany({ where: { documentId }, include: { target: { select: { kind: true } } } });
  return rows.map((r) => ({ code: trackingCode(r.target.kind, r.targetId), etag: r.etag }));
}

/** docs.list처럼 여러 문서를 한 번에 내려줄 때 N+1을 피하려고 한 번에 조회하는 배치 버전. */
export async function loadRelatedBatch(documentIds: string[]): Promise<Map<string, TaggedRef[]>> {
  if (documentIds.length === 0) return new Map();
  const rows = await prisma.documentRelated.findMany({
    where: { documentId: { in: documentIds } },
    include: { target: { select: { kind: true } } },
  });
  const map = new Map<string, TaggedRef[]>();
  for (const r of rows) {
    const arr = map.get(r.documentId) ?? [];
    arr.push({ code: trackingCode(r.target.kind, r.targetId), etag: r.etag });
    map.set(r.documentId, arr);
  }
  return map;
}

export async function loadDependsOnBatch(documentIds: string[]): Promise<Map<string, TaggedRef[]>> {
  if (documentIds.length === 0) return new Map();
  const rows = await prisma.documentDependsOn.findMany({
    where: { documentId: { in: documentIds } },
    include: { target: { select: { kind: true } } },
  });
  const map = new Map<string, TaggedRef[]>();
  for (const r of rows) {
    const arr = map.get(r.documentId) ?? [];
    arr.push({ code: trackingCode(r.target.kind, r.targetId), etag: r.etag });
    map.set(r.documentId, arr);
  }
  return map;
}

export function toDocResponse(doc: {
  id: string;
  kind: string;
  parentId: string | null;
  etag: string;
  type: string;
  state: string;
  branch: string | null;
  commitId: string | null;
  chapter: string | null;
  title: string;
  author: string;
  content: string;
  related: TaggedRef[];
  dependsOn: TaggedRef[];
  fileRefs: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    code: trackingCode(doc.kind, doc.id),
    parent_id: doc.parentId,
    etag: doc.etag,
    type: doc.type,
    kind: doc.kind,
    state: doc.state,
    branch: doc.branch,
    commit_id: doc.commitId,
    chapter: doc.chapter,
    title: doc.title,
    author: doc.author,
    content: doc.content,
    related: doc.related,
    dependsOn: doc.dependsOn,
    fileRefs: doc.fileRefs,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Phase 8 "로컬 캐시(list=요약/get=본문 분리)": `docs.list`는 본문(`content`)을
 * 뺀 요약만 돌려준다 - 문서가 많아지면 `docs.list` 응답이 본문까지 실어
 * 불필요하게 비대해지는 걸 막는다. 본문이 필요하면 `docs.get`으로 이어서
 * 조회한다 (`docs.search`는 검색 스니펫 성격이 강해 이번엔 그대로 둔다 -
 * CLAUDE.md 규칙 6의 `--codes-only`/`--lines`처럼 CLI 쪽에서 다듬는다).
 */
export function toDocSummary(doc: Parameters<typeof toDocResponse>[0]) {
  const { content, ...summary } = toDocResponse(doc);
  return summary;
}
