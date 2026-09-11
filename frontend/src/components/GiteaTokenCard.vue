<script setup lang="ts">
import { ref } from "vue";
import { apiCall, ApiError } from "../api/client";

const error = ref("");
const regenerating = ref(false);
const revealedUsername = ref("");
const revealedToken = ref("");
const copied = ref(false);

async function regenerate() {
  regenerating.value = true;
  error.value = "";
  copied.value = false;
  try {
    const result = await apiCall<{ username: string; token: string }>("/auth/me/git-token", { method: "POST" });
    revealedUsername.value = result.username;
    revealedToken.value = result.token;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "재발급에 실패했습니다";
  } finally {
    regenerating.value = false;
  }
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(revealedToken.value);
    copied.value = true;
  } catch {
    // 클립보드 접근 실패 시 그냥 무시 - 값은 여전히 화면에 보임
  }
}

function dismiss() {
  revealedUsername.value = "";
  revealedToken.value = "";
  copied.value = false;
}
</script>

<template>
  <section class="card">
    <h2>Gitea 개인 접근 토큰</h2>
    <p class="hint">
      외부 git 클라이언트로 이 시스템이 관리하는 저장소를 직접 clone/push할 때 쓰는 자격증명 - 사용자 이름 자리에
      Gitea 계정 이름을, 비밀번호 자리에 이 토큰을 넣는다. 이 웹 UI/CLI를 거쳐 저장하는 커밋도 이 토큰으로 그
      설계자 신원으로 귀속된다.
    </p>
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="revealedToken" class="reveal-box">
      <p class="reveal-warning">⚠ 이 값은 지금 한 번만 표시됩니다 - 안전한 곳에 저장하세요. 화면을 벗어나면 다시 볼 수 없습니다.</p>
      <div class="field"><span class="label">사용자 이름</span> <code>{{ revealedUsername }}</code></div>
      <code class="secret">{{ revealedToken }}</code>
      <div class="reveal-actions">
        <button type="button" @click="copyToken">{{ copied ? "복사됨" : "복사" }}</button>
        <button type="button" class="dismiss-btn" @click="dismiss">확인했습니다</button>
      </div>
    </div>

    <button type="button" class="regen-btn" :disabled="regenerating" @click="regenerate">
      {{ regenerating ? "발급 중..." : "재발급" }}
    </button>
    <p class="hint small">재발급하면 기존 토큰은 즉시 무효화된다(이미 clone해둔 로컬 자격증명이 있다면 새 값으로 갱신해야 함).</p>
  </section>
</template>

<style scoped>
.card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 16px;
  margin-bottom: 20px;
}
h2 {
  font-size: 14px;
  margin: 0 0 12px;
  color: #555;
}
.hint {
  font-size: 12px;
  color: #888;
  margin: 0 0 12px;
}
.hint.small {
  margin: 8px 0 0;
}
.reveal-box {
  background: #fff8e1;
  border: 1px solid #f0c14b;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.reveal-warning {
  font-size: 12px;
  color: #8a6300;
  margin: 0 0 8px;
  font-weight: 600;
}
.field {
  font-size: 13px;
  margin-bottom: 8px;
}
.field .label {
  color: #888;
  margin-right: 6px;
}
.secret {
  display: block;
  background: #1a1a2e;
  color: #d6f8d6;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  word-break: break-all;
  margin-bottom: 8px;
}
.reveal-actions {
  display: flex;
  gap: 8px;
}
.reveal-actions button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.dismiss-btn {
  margin-left: auto;
}
.regen-btn {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 7px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
