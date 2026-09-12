import { getDb } from "./db.js";
import { paginate, type Page } from "./pagination.js";

// 문서 ↔ "연관된 git 브랜치" - DocumentSourceLink(core/documentSourceLinks.ts)
// 를 filePath→branchName으로 그대로 미러링한 패턴. 그 브랜치가 실제로
// 존재하는지는 검증하지 않는다(순수 연관 관계). 브랜치가 나중에 삭제돼도
// 이 링크는 지우지 않는다 - CodeRelation.branchName(웹훅 delete 이벤트로
// 즉시 벌크 삭제됨, core/codeRelations.ts의 deleteRelationsForBranch())과
// 반대 정책이다: 관계도는 "지금 탐색 상태"라 사라진 브랜치를 계속
// 가리키면 오해를 부르지만, 문서-브랜치 연관은 "이 문서가 어느 브랜치들을
// 거쳐 구현됐는지"라는 역사적 기록이라 브랜치가 사라진 뒤에도 유용하다고
// 판단했다.

export interface BranchLinkDetail {
  id: string;
  branchName: string;
  createdBy: string;
  createdAt: Date;
}

export async function addBranchLink(trackingCode: string, branchName: string, userId: string): Promise<BranchLinkDetail> {
  const trimmed = branchName.trim();
  if (!trimmed) throw new Error("branchName이 필요합니다");
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);

  const existing = await db.documentBranchLink.findFirst({ where: { documentId: document.id, branchName: trimmed } });
  if (existing) throw new Error(`이미 연결된 브랜치입니다: ${trimmed}`);

  const row = await db.documentBranchLink.create({
    data: { documentId: document.id, branchName: trimmed, createdBy: userId },
  });
  return { id: row.id, branchName: row.branchName, createdBy: row.createdBy, createdAt: row.createdAt };
}

export async function removeBranchLink(id: string, trackingCode: string): Promise<void> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const link = await db.documentBranchLink.findUnique({ where: { id } });
  if (!link || link.documentId !== document.id) throw new Error(`연결된 브랜치 링크를 찾을 수 없습니다: ${id}`);
  await db.documentBranchLink.delete({ where: { id } });
}

export async function listBranchLinks(trackingCode: string): Promise<BranchLinkDetail[]> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const rows = await db.documentBranchLink.findMany({ where: { documentId: document.id }, orderBy: { createdAt: "asc" } });
  return rows.map((r: BranchLinkDetail) => ({ id: r.id, branchName: r.branchName, createdBy: r.createdBy, createdAt: r.createdAt }));
}

export async function listBranchLinksPaged(
  trackingCode: string,
  page: number,
  pageSize: number,
): Promise<Page<BranchLinkDetail>> {
  const db = getDb();
  const document = await db.document.findUnique({ where: { trackingCode } });
  if (!document) throw new Error(`문서를 찾을 수 없습니다: ${trackingCode}`);
  const result = await paginate<BranchLinkDetail>(
    (args) => db.documentBranchLink.findMany({ where: { documentId: document.id }, orderBy: { createdAt: "asc" }, ...args }),
    () => db.documentBranchLink.count({ where: { documentId: document.id } }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: result.items.map((r: BranchLinkDetail) => ({ id: r.id, branchName: r.branchName, createdBy: r.createdBy, createdAt: r.createdAt })),
  };
}
