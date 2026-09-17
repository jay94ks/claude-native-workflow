// 문서간 링크(DocumentLink - link/backlink/그래프) - 원래 documents.ts
// 안에 있었는데(943줄, 34개 export로 여러 하위 관심사가 섞여있던 것 중
// 하나), documentSourceLinks.ts/documentBranchLinks.ts와 같은 기존
// 관례를 따라 별도 파일로 분리했다(#documents-links-split,
// BL-57F8DF17 #62) - 이 파일의 함수들은 getDb()/paginate()만 쓰고
// documents.ts 안의 다른 함수(toSearchable/syncAndPublish 등)에는
// 의존하지 않아 그대로 잘라낼 수 있는 독립적인 하위 도메인이었다.

import { getDb } from "./db.js";
import { paginate, type Page } from "./pagination.js";

/** 새 링크는 항상 그 문서의 현재 아웃바운드 링크 목록 맨 끝에
 * 붙는다(order = 현재 개수) - report처럼 여러 문서를 순서 있는
 * 챕터로 엮는 용도에서, addDocumentLink를 호출한 순서가 곧 초기
 * 챕터 순서가 되게 하기 위함(#document-link-ordering). */
export async function addDocumentLink(
  fromTrackingCode: string,
  toTrackingCode: string,
  linkType?: string,
): Promise<void> {
  const db = getDb();
  const from = await db.document.findUnique({ where: { trackingCode: fromTrackingCode } });
  if (!from) throw new Error(`문서를 찾을 수 없습니다: ${fromTrackingCode}`);
  const to = await db.document.findUnique({ where: { trackingCode: toTrackingCode } });
  if (!to) throw new Error(`링크 대상 문서를 찾을 수 없습니다: ${toTrackingCode}`);

  const count = await db.documentLink.count({ where: { fromDocumentId: from.id } });
  await db.documentLink.create({
    data: { fromDocumentId: from.id, toTrackingCode, linkType: linkType ?? null, order: count },
  });
}

export interface DocumentLinkView {
  trackingCode: string;
  title: string;
  linkType: string | null;
  order: number;
}

/** 정방향: 이 문서가 링크한 문서 전부, 순서대로(#document-link-ordering) -
 * report/매뉴얼처럼 여러 문서를 챕터로 엮은 구조를 그대로 조회할 때
 * 쓴다. 역참조인 listBacklinks와 대칭. */
export async function listDocumentLinksOut(trackingCode: string): Promise<DocumentLinkView[]> {
  const db = getDb();
  const from = await db.document.findUnique({ where: { trackingCode } });
  if (!from) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const links = await db.documentLink.findMany({
    where: { fromDocumentId: from.id },
    include: { toDocument: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  return links.map((l: { order: number; linkType: string | null; toDocument: { trackingCode: string; title: string } }) => ({
    trackingCode: l.toDocument.trackingCode,
    title: l.toDocument.title,
    linkType: l.linkType,
    order: l.order,
  }));
}

/** orderedTrackingCodes는 이 문서의 현재 아웃바운드 링크 대상 집합과
 * 정확히 같은 순열이어야 한다(빠지거나 새로 생기면 거부 - "몰라서
 * 조용히 하나가 사라짐"보다 명확한 에러가 낫다는 원칙). */
export async function reorderDocumentLinks(trackingCode: string, orderedTrackingCodes: string[]): Promise<void> {
  const db = getDb();
  const from = await db.document.findUnique({ where: { trackingCode } });
  if (!from) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const links = await db.documentLink.findMany({ where: { fromDocumentId: from.id } });

  const currentTargets = links.map((l: { toTrackingCode: string }) => l.toTrackingCode).sort();
  const wantedTargets = [...orderedTrackingCodes].sort();
  if (currentTargets.length !== wantedTargets.length || currentTargets.some((t: string, i: number) => t !== wantedTargets[i])) {
    throw new Error(
      `orderedTrackingCodes가 이 문서의 현재 링크 대상(${links.length}건)과 정확히 같은 집합이어야 합니다 - ` +
        `누락/추가 없이 순서만 바꿀 수 있습니다`,
    );
  }

  await db.$transaction(
    orderedTrackingCodes.map((toTrackingCode, order) =>
      db.documentLink.updateMany({ where: { fromDocumentId: from.id, toTrackingCode }, data: { order } }),
    ),
  );
}

/** linkType을 생략했는데 같은 대상으로의 링크가 여러 개(서로 다른
 * linkType)면 어느 걸 지울지 특정할 수 없어 에러로 거부한다. 삭제
 * 후 남은 형제 링크들의 order를 0..n-1로 재정렬해 빈 구멍이 안
 * 남게 한다. */
export async function removeDocumentLink(fromTrackingCode: string, toTrackingCode: string, linkType?: string): Promise<void> {
  const db = getDb();
  const from = await db.document.findUnique({ where: { trackingCode: fromTrackingCode } });
  if (!from) throw new Error(`문서를 찾을 수 없습니다: ${fromTrackingCode}`);
  const matches = await db.documentLink.findMany({
    where: { fromDocumentId: from.id, toTrackingCode, ...(linkType !== undefined ? { linkType } : {}) },
  });
  if (matches.length === 0) throw new Error(`링크를 찾을 수 없습니다: ${fromTrackingCode} -> ${toTrackingCode}`);
  if (matches.length > 1) {
    throw new Error(`같은 대상으로의 링크가 ${matches.length}개 있어 특정할 수 없습니다 - --type으로 linkType을 지정하세요`);
  }
  await db.documentLink.delete({ where: { id: matches[0].id } });

  const remaining = await db.documentLink.findMany({
    where: { fromDocumentId: from.id },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  await db.$transaction(
    remaining.map((l: { id: string }, order: number) => db.documentLink.update({ where: { id: l.id }, data: { order } })),
  );
}

/** 역참조: 이 문서를 링크한 문서 전부(JSON 배열로는 불가능했던 조회 -
 * DocumentLink를 join 테이블로 정규화한 이유). */
export async function listBacklinks(trackingCode: string): Promise<{ trackingCode: string; title: string }[]> {
  const db = getDb();
  const links = await db.documentLink.findMany({
    where: { toTrackingCode: trackingCode },
    include: { fromDocument: true },
  });
  return links.map((l: { fromDocument: { trackingCode: string; title: string } }) => ({
    trackingCode: l.fromDocument.trackingCode,
    title: l.fromDocument.title,
  }));
}

export async function listBacklinksPaged(
  trackingCode: string,
  page: number,
  pageSize: number,
): Promise<Page<{ trackingCode: string; title: string }>> {
  const db = getDb();
  const where = { toTrackingCode: trackingCode };
  const result = await paginate<{ fromDocument: { trackingCode: string; title: string } }>(
    (args) => db.documentLink.findMany({ where, include: { fromDocument: true }, ...args }),
    () => db.documentLink.count({ where }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: result.items.map((l: { fromDocument: { trackingCode: string; title: string } }) => ({
      trackingCode: l.fromDocument.trackingCode,
      title: l.fromDocument.title,
    })),
  };
}

export interface DocumentLinkGraphNode {
  trackingCode: string;
  title: string;
  docTypeCode: string;
}
export interface DocumentLinkGraphEdge {
  fromTrackingCode: string;
  toTrackingCode: string;
  linkType: string | null;
}
export interface DocumentLinkGraph {
  nodes: DocumentLinkGraphNode[];
  edges: DocumentLinkGraphEdge[];
}

/** 이 프로젝트의 문서 간 링크(DocumentLink) 전체를 그래프 하나로
 * 반환한다 - listDocumentLinksOut/listBacklinks는 문서 한 건 기준
 * 정방향/역방향만 주는데, "문서간 관계 그래프"(웹 UI)는 프로젝트
 * 전체를 한 번에 그려야 해서 별도로 둔다(#document-link-graph).
 * 양쪽 문서 다 이 프로젝트 소속인 링크만 포함(스키마상 링크가 다른
 * 프로젝트 문서를 가리키는 것 자체는 막혀있지 않지만, 그런 링크까지
 * 섞이면 "이 프로젝트의" 그래프라는 전제가 깨짐). 노드는 실제로 링크에
 * 참여하는 문서만(고립 문서는 관계가 없으니 그래프에 안 나온다 -
 * 코드 관계도와 같은 원칙). */
export async function getProjectDocumentLinkGraph(projectId: string): Promise<DocumentLinkGraph> {
  const db = getDb();
  const links = await db.documentLink.findMany({
    where: { fromDocument: { projectId }, toDocument: { projectId } },
    include: {
      fromDocument: { include: { docType: { select: { code: true } } } },
      toDocument: { include: { docType: { select: { code: true } } } },
    },
  });
  type LinkRow = (typeof links)[number];
  const nodeMap = new Map<string, DocumentLinkGraphNode>();
  for (const l of links as LinkRow[]) {
    nodeMap.set(l.fromDocument.trackingCode, {
      trackingCode: l.fromDocument.trackingCode,
      title: l.fromDocument.title,
      docTypeCode: l.fromDocument.docType.code,
    });
    nodeMap.set(l.toDocument.trackingCode, {
      trackingCode: l.toDocument.trackingCode,
      title: l.toDocument.title,
      docTypeCode: l.toDocument.docType.code,
    });
  }
  return {
    nodes: [...nodeMap.values()],
    edges: (links as LinkRow[]).map((l) => ({
      fromTrackingCode: l.fromDocument.trackingCode,
      toTrackingCode: l.toTrackingCode,
      linkType: l.linkType,
    })),
  };
}
