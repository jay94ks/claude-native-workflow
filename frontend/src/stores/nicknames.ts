import { defineStore } from "pinia";
import { apiCall } from "../api/client";

interface PublicProfile {
  displayLabel: string;
}

// UserRef.vue 등 설계자를 "[닉네임 #N]"으로 표시하는 모든 자리가 공유하는
// 캐시 - 같은 userId를 여러 컴포넌트/여러 번 참조해도 실제 GET /users/:id
// 요청은 세션 동안 한 번만 나간다(N+1 방지, 백엔드 응답 스키마는 그대로
// 두고 프런트 레이어에서만 흡수).
export const useNicknamesStore = defineStore("nicknames", {
  state: () => ({
    labels: {} as Record<string, string>,
    pending: new Set<string>(),
  }),
  actions: {
    async ensure(userId: string): Promise<void> {
      if (this.labels[userId] || this.pending.has(userId)) return;
      this.pending.add(userId);
      try {
        const profile = await apiCall<PublicProfile>(`/users/${userId}`);
        this.labels[userId] = profile.displayLabel;
      } catch {
        this.labels[userId] = userId; // 실패 시 원문 id로 폴백(영원히 "..."로 안 남게)
      } finally {
        this.pending.delete(userId);
      }
    },
  },
});
