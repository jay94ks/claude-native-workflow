import { defineStore } from "pinia";
import { Notify } from "quasar";
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

// design-notes.md "메시지 시스템": notices는 예외 없이 모든 액션 응답에
// 피기백되어 온다 - CLI/MCP는 이미 이걸 항상 출력하는데(Phase 4에서
// "notices를 버리고 있던" 버그를 고친 이력이 있다), WEB UI도 그냥
// 버리지 않고 토스트로 띄워서 architect가 실제로 보게 한다.
function surfaceNotices(notices: unknown[]): void {
  for (const notice of notices) {
    Notify.create({ type: "info", message: String(notice), position: "top-right", timeout: 6000 });
  }
}

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
    /** 로그인된 apiKey로 액션 하나를 보낸다 - 컴포넌트들이 매번 apiKey를 꺼내지 않아도 되게. */
    async run(action: api.Action): Promise<api.ActionResult> {
      if (!this.apiKey) throw new Error("로그인이 필요합니다.");
      const envelope = await api.runActions(this.apiKey, [action]);
      surfaceNotices(envelope.notices);
      return envelope.result[0];
    },
    async runBulk(actions: api.Action[]): Promise<api.Envelope> {
      if (!this.apiKey) throw new Error("로그인이 필요합니다.");
      const envelope = await api.runActions(this.apiKey, actions);
      surfaceNotices(envelope.notices);
      return envelope;
    },
  },
});
