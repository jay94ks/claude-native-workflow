<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useAuthStore } from "../stores/auth";
import AccessOverviewPanel from "../components/AccessOverviewPanel.vue";

interface AdminUserListItem {
  id: string;
  username: string;
  email: string | null;
  nickname: string | null;
  displayLabel: string;
  createdAt: string;
}

const auth = useAuthStore();
const users = ref<AdminUserListItem[]>([]);
const loading = ref(true);
const error = ref("");
const resettingId = ref("");
const revealedFor = ref("");
const revealedPassword = ref("");
const copied = ref(false);
const expandedAccessId = ref("");

function toggleAccess(u: AdminUserListItem) {
  expandedAccessId.value = expandedAccessId.value === u.id ? "" : u.id;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    users.value = await apiCall<AdminUserListItem[]>("/admin/users");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "사용자 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function resetPassword(u: AdminUserListItem) {
  resettingId.value = u.id;
  error.value = "";
  copied.value = false;
  try {
    const result = await apiCall<{ username: string; temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, {
      method: "POST",
    });
    revealedFor.value = result.username;
    revealedPassword.value = result.temporaryPassword;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "재설정에 실패했습니다";
  } finally {
    resettingId.value = "";
  }
}

async function copyPassword() {
  try {
    await navigator.clipboard.writeText(revealedPassword.value);
    copied.value = true;
  } catch {
    // 무시 - 값은 화면에 그대로 남아 있음
  }
}

function dismissReveal() {
  revealedFor.value = "";
  revealedPassword.value = "";
  copied.value = false;
}

onMounted(load);
</script>

<template>
  <section class="card">
    <h2>사용자 관리</h2>
    <p v-if="!auth.me?.isSuperAdmin" class="error">권한이 없습니다 - 최고 관리자만 볼 수 있는 화면입니다.</p>
    <template v-else>
      <p class="hint">
        비밀번호를 잊은 설계자를 위해 임시 비밀번호를 발급한다 - 이 시스템엔 이메일 발송 기능이 없어 관리자가 직접
        전달해야 한다.
      </p>
      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="revealedPassword" class="reveal-box">
        <p class="reveal-warning">⚠ {{ revealedFor }}의 새 임시 비밀번호 - 지금 한 번만 표시됩니다. 안전하게 전달하세요.</p>
        <code class="secret">{{ revealedPassword }}</code>
        <div class="reveal-actions">
          <button type="button" @click="copyPassword">{{ copied ? "복사됨" : "복사" }}</button>
          <button type="button" class="dismiss-btn" @click="dismissReveal">확인했습니다</button>
        </div>
      </div>

      <p v-if="loading" class="muted">불러오는 중...</p>
      <ul v-else class="list">
        <li v-for="u in users" :key="u.id">
          <div class="row">
            <span class="username">{{ u.username }}</span>
            <span class="label">{{ u.displayLabel }}</span>
            <span class="email">{{ u.email || "(이메일 없음)" }}</span>
            <span class="at">{{ new Date(u.createdAt).toLocaleString() }}</span>
            <button class="reset-btn" @click="toggleAccess(u)">
              {{ expandedAccessId === u.id ? "접근 제한 닫기" : "접근 제한 보기" }}
            </button>
            <button class="reset-btn" :disabled="resettingId === u.id" @click="resetPassword(u)">비밀번호 재설정</button>
          </div>
          <div v-if="expandedAccessId === u.id" class="access-panel">
            <AccessOverviewPanel :endpoint="`/admin/users/${u.id}/access-overview`" />
          </div>
        </li>
        <li v-if="users.length === 0" class="muted">사용자가 없습니다.</li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.card {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 16px;
  margin-bottom: 20px;
}
h2 {
  font-size: 14px;
  margin: 0 0 4px;
  color: var(--color-text-secondary);
}
.hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 12px;
}
.reveal-box {
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}
.reveal-warning {
  font-size: 12px;
  color: var(--color-warning-text);
  margin: 0 0 8px;
  font-weight: 600;
}
.secret {
  display: block;
  background: var(--color-terminal-bg);
  color: var(--color-terminal-text);
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
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.dismiss-btn {
  margin-left: auto;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.list li {
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 12px;
}
.list li:last-child {
  border-bottom: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.access-panel {
  margin-top: 8px;
  padding: 10px;
  background: var(--color-surface-hover);
  border-radius: 6px;
}
.username {
  font-weight: 600;
  color: var(--color-text);
}
.label {
  color: var(--color-text-secondary);
}
.email {
  color: var(--color-text-muted);
}
.at {
  margin-left: auto;
  color: var(--color-text-faint);
  font-size: 11px;
  white-space: nowrap;
}
.reset-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
