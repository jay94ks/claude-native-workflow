import { prisma } from "./prisma";
import { getActiveKeyScope } from "./requestScope";

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
 *
 * "Admin은 프로젝트당 1명"은 `projects.ts`의 create/invite/transfer
 * 세 경로가 애플리케이션 레이어에서 지키지만, DB 부분 unique
 * 인덱스(`ProjectMembership_admin_per_project`, 2026-09-21 후속
 * 마이그레이션)로도 이중 강제된다 - design-notes.md 참고.
 */
export async function requireMembership(
  projectId: string,
  architectId: string,
  minRole: "READ" | "WRITE" | "ADMIN"
): Promise<void> {
  // docs/plan-nickname-apikey-policy.md (v2 계승) - 이 요청이 "프로젝트
  // 단위" API 키로 인증됐다면, 실제 멤버십 role과 무관하게 그 키가 발급된
  // 프로젝트가 아닌 다른 프로젝트는 아예 접근 자체를 거부한다 - 개인 키가
  // 유출돼도 그 프로젝트 밖으로는 새어나가지 않게 하는 게 이 스코프의
  // 존재 이유라, 멤버십 조회보다 먼저 확인한다.
  const scope = getActiveKeyScope();
  if (scope.type === "project" && scope.projectId !== projectId) {
    throw new MembershipError("이 API 키는 다른 프로젝트에 대한 접근 권한이 없습니다.");
  }

  const membership = await prisma.projectMembership.findUnique({
    where: { projectId_accountId: { projectId, accountId: architectId } },
  });
  if (membership && ROLE_RANK[membership.role] >= ROLE_RANK[minRole]) return;

  if (minRole === "READ" && !membership) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (project?.visibility === "PUBLIC") return;
  }

  // 설계자 요청(2026-09-21 후속)으로 이 시점의 projectId는 이미 owner/slug가
  // 내부 PK로 바꿔치기된 뒤라(api/actions.ts dispatch(), api/rest.ts web())
  // 호출자가 알아볼 수 있는 값이 아니다 - 메시지에 더는 싣지 않는다.
  throw new MembershipError(`${minRole} access to this project is required`);
}
