// listDocumentsPaged/listMessagesPaged/listQuestionsPaged에 이미
// 반복된 "findMany({skip,take}) + count()" → {items,page,pageSize,
// total,totalPages} 패턴을 함수 하나로 뽑았다 - 이 세 함수는 이미
// 동작 중이라 안 건드리고, 이후 새로 추가하는 Paged 자매 함수들만
// 이 헬퍼를 쓴다.

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const MAX_PAGE_SIZE = 200;

export async function paginate<T>(
  findMany: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
  page: number,
  pageSize: number,
): Promise<Page<T>> {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safeSize = Math.max(1, Math.min(Math.trunc(pageSize) || 20, MAX_PAGE_SIZE));
  const [items, total] = await Promise.all([
    findMany({ skip: (safePage - 1) * safeSize, take: safeSize }),
    count(),
  ]);
  return { items, page: safePage, pageSize: safeSize, total, totalPages: Math.max(1, Math.ceil(total / safeSize)) };
}

/** Gitea Contents API처럼 상류 자체가 페이지 파라미터를 안 받는
 * 목록에 쓴다 - 전체 배열을 받아온 뒤 여기서 자른다. */
export function paginateInMemory<T>(all: T[], page: number, pageSize: number): Page<T> {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safeSize = Math.max(1, Math.min(Math.trunc(pageSize) || 20, MAX_PAGE_SIZE));
  const start = (safePage - 1) * safeSize;
  return {
    items: all.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total: all.length,
    totalPages: Math.max(1, Math.ceil(all.length / safeSize)),
  };
}
