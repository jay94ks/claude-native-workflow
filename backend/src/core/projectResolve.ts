// 설계자 요청(2026-09-21 후속) - "프로젝트 id는 설계자별로 관리되어야
// 한다"에 따라 이제 밖에서 부르는 project id(Project.slug)는 그 프로젝트
// 생성자(owner) 범위에서만 유일하다 - owner 없이 slug만으로는 어느
// 프로젝트인지 전역에서 특정할 수 없다. 이 함수가 (owner username, slug)
// 쌍을 실제 내부 PK(Project.id, 전역 유일 cuid)로 바꾸는 유일한 통로다 -
// `api/actions.ts`의 dispatch()와 `api/rest.ts`의 web()이 각 요청 진입점
// 한 곳에서만 이걸 부르고, 그 아래 core/*.ts의 기존 액션 핸들러들은
// 지금까지처럼 payload.projectId를 "이미 유일하게 식별된 내부 PK"로 그대로
// 취급한다(핸들러 자체는 이 owner/slug 개념을 몰라도 된다).
import { prisma } from "./prisma";

export async function resolveProjectId(owner: string, slug: string): Promise<string | null> {
  const account = await prisma.account.findUnique({ where: { username: owner } });
  if (!account) return null;

  const project = await prisma.project.findUnique({
    where: { creatorAccountId_slug: { creatorAccountId: account.id, slug } },
    select: { id: true },
  });
  return project?.id ?? null;
}
