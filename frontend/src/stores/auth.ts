import { defineStore } from "pinia";
import * as api from "../api/client";

const STORAGE_KEY = "cnw.auth";

interface StoredAuth {
  architectId: string;
  apiKey: string;
  username: string;
}

function loadStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

// 설계자 지시(2026-09-21) - WEB UI는 더 이상 단일 /api/actions로 액션을
// 몰아넣지 않고 액션별 REST 엔드포인트를 직접 호출한다(api/client.ts).
// 이 스토어는 로그인 상태(apiKey)만 들고 있고, 각 화면 컴포넌트가
// `import * as api from "src/api/client"`로 그 apiKey를 넘겨 직접
// 호출한다 - notices 토스트는 api/client.ts의 request() 공용 지점에서
// 처리하므로 여기서 따로 감쌀 필요가 없다.
export const useAuthStore = defineStore("auth", {
  state: () => ({
    architectId: null as string | null,
    apiKey: null as string | null,
    username: null as string | null,
  }),
  getters: {
    isLoggedIn: (state) => !!state.apiKey,
  },
  actions: {
    restore() {
      const stored = loadStored();
      if (stored) {
        this.architectId = stored.architectId;
        this.apiKey = stored.apiKey;
        this.username = stored.username;
      }
    },
    async login(username: string, password: string) {
      const { architectId, apiKey } = await api.login(username, password);
      this.architectId = architectId;
      this.apiKey = apiKey;
      this.username = username;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ architectId, apiKey, username }));
    },
    async signup(username: string, password: string) {
      await api.signup(username, password);
      await this.login(username, password);
    },
    logout() {
      this.architectId = null;
      this.apiKey = null;
      this.username = null;
      localStorage.removeItem(STORAGE_KEY);
    },
  },
});
