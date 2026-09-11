import type { InjectionKey, Ref } from "vue";

// ProjectShellView.vue가 provide하고, 그 하위 라우트(문서/칸반/설정 등)
// 전체가 inject해 쓴다 - "이 프로젝트에서 내 역할"을 뷰마다 따로
// fetch하지 않게(getMemberRole이 admin-aware라 최고 관리자는 항상
// "owner"). 비멤버는 null.
export const PROJECT_MY_ROLE_KEY: InjectionKey<Ref<string | null>> = Symbol("projectMyRole");

const ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };

/** roleSatisfies(backend/src/core/members.ts)와 동일한 순서 비교 -
 * 프런트에서 "editor 이상" 같은 CUD 버튼 가시성 판정에 쓴다. */
export function roleSatisfies(actualRole: string | null | undefined, requiredRole: string): boolean {
  if (!actualRole) return false;
  return (ROLE_RANK[actualRole] ?? -1) >= (ROLE_RANK[requiredRole] ?? Infinity);
}
