import { prisma } from "./prisma";

const ROLE_RANK: Record<string, number> = { READ: 0, WRITE: 1, ADMIN: 2 };

export class MembershipError extends Error {}

/**
 * Phase 1 판단: 액션 payload마다 어떤 프로젝트에 대한 것인지 명시적인
 * `projectId` 필드를 요구한다 - ApiKey는 계정 단위일 뿐 프로젝트에
 * 묶여있지 않으므로(스캐폴딩 절 TODO), 그 계정이 그 프로젝트에 최소
 * 권한을 가졌는지 매 액션마다 검증한다. (design-notes.md에 기록.)
 *
 * Phase 6 추가: "프로젝트 공개/비공개 스코프" - `public` 프로젝트는
 * collaborator가 아니어도 누구나 읽기(READ)는 가능하다. WRITE/ADMIN은
 * visibility와 무관하게 항상 실제 멤버십이 필요하다.
 */
export async function requireMembership(
  projectId: string,
  architectId: string,
  minRole: "READ" | "WRITE" | "ADMIN"
): Promise<void> {
  const membership = await prisma.projectMembership.findUnique({
    where: { projectId_accountId: { projectId, accountId: architectId } },
  });
  if (membership && ROLE_RANK[membership.role] >= ROLE_RANK[minRole]) return;

  if (minRole === "READ" && !membership) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (project?.visibility === "PUBLIC") return;
  }

  throw new MembershipError(`${minRole} access to project "${projectId}" required`);
}
