import { defineStore } from "pinia";
import { apiCall, setTokens, clearTokens, isLoggedIn } from "../api/client";

interface LoginResponse {
  access_token: string;
  refresh_token: string;
}

export interface Me {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  emailVisible: boolean;
  phoneVisible: boolean;
  nickname: string | null;
  nicknameNumber: number;
  displayLabel: string;
  nicknameChangedAt: string | null;
  giteaUsername: string | null;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    loggedIn: isLoggedIn(),
    me: null as Me | null,
  }),
  actions: {
    async login(usernameOrEmail: string, password: string): Promise<void> {
      const res = await apiCall<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username_or_email: usernameOrEmail, password }),
      });
      setTokens(res.access_token, res.refresh_token);
      this.loggedIn = true;
      await this.loadMe();
    },
    async register(username: string, password: string, email?: string): Promise<void> {
      await apiCall("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password, email }),
      });
    },
    // 실패해도 조용히 무시 - teamsEnabled 조회 실패 시 기본값을 유지하는
    // 기존 관례와 동일(내 정보가 없어도 나머지 화면은 정상 동작해야 함).
    async loadMe(): Promise<void> {
      try {
        this.me = await apiCall<Me>("/auth/me");
      } catch {
        // 무시
      }
    },
    logout(): void {
      clearTokens();
      this.loggedIn = false;
      this.me = null;
    },
  },
});
