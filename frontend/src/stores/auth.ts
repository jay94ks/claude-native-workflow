import { defineStore } from "pinia";
import { apiCall, setTokens, clearTokens, isLoggedIn } from "../api/client";

interface LoginResponse {
  access_token: string;
  refresh_token: string;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    loggedIn: isLoggedIn(),
  }),
  actions: {
    async login(usernameOrEmail: string, password: string): Promise<void> {
      const res = await apiCall<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username_or_email: usernameOrEmail, password }),
      });
      setTokens(res.access_token, res.refresh_token);
      this.loggedIn = true;
    },
    async register(username: string, password: string, email?: string): Promise<void> {
      await apiCall("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password, email }),
      });
    },
    logout(): void {
      clearTokens();
      this.loggedIn = false;
    },
  },
});
