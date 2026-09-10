<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

interface ApiKeyDetail {
  id: string;
  ownerId: string;
  scope: string;
  projectId: string | null;
  teamId: string | null;
  label: string | null;
  keyPrefix: string;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

const keys = ref<ApiKeyDetail[]>([]);
const loading = ref(true);
const error = ref("");
const label = ref("");
const creating = ref(false);
const revealedSecret = ref("");
const copied = ref(false);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    keys.value = await apiCall<ApiKeyDetail[]>("/api-keys/personal");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "키 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function create() {
  creating.value = true;
  error.value = "";
  copied.value = false;
  try {
    const result = await apiCall<{ key: ApiKeyDetail; secret: string }>("/api-keys/personal", {
      method: "POST",
      body: JSON.stringify({ label: label.value.trim() || undefined }),
    });
    revealedSecret.value = result.secret;
    label.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "키 생성에 실패했습니다";
  } finally {
    creating.value = false;
  }
}

async function copySecret() {
  try {
    await navigator.clipboard.writeText(revealedSecret.value);
    copied.value = true;
  } catch {
    // 무시 - 값은 화면에 그대로 남아 있음
  }
}

function dismissSecret() {
  revealedSecret.value = "";
  copied.value = false;
}

async function revoke(id: string) {
  error.value = "";
  try {
    await apiCall(`/api-keys/${id}`, { method: "DELETE" });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "배제에 실패했습니다";
  }
}

onMounted(load);
</script>

<template>
  <section class="card">
    <h2>API 키</h2>
    <p class="hint">이 계정으로 접근 가능한 모든 프로젝트에 접근하는 개인 키 - 로그인과 동등한 권한이므로 신중히 관리한다. 본인만 만들고 배제할 수 있다.</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="revealedSecret" class="reveal-box">
      <p class="reveal-warning">⚠ 이 값은 지금 한 번만 표시됩니다 - 안전한 곳에 저장하세요.</p>
      <code class="secret">{{ revealedSecret }}</code>
      <div class="reveal-actions">
        <button type="button" @click="copySecret">{{ copied ? "복사됨" : "복사" }}</button>
        <button type="button" class="dismiss-btn" @click="dismissSecret">확인했습니다</button>
      </div>
    </div>

    <form class="create-row" @submit.prevent="create">
      <input v-model="label" type="text" placeholder="라벨(선택)" />
      <button type="submit" :disabled="creating">개인 키 만들기</button>
    </form>

    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="list">
      <li v-for="k in keys" :key="k.id" :class="{ revoked: k.status === 'revoked' }">
        <code class="prefix">{{ k.keyPrefix }}••••••••</code>
        <span class="label">{{ k.label || "(라벨 없음)" }}</span>
        <span class="status" :class="k.status">{{ k.status === "active" ? "활성" : "배제됨" }}</span>
        <span class="at">{{ new Date(k.createdAt).toLocaleString() }}</span>
        <button v-if="k.status === 'active'" class="revoke-btn" @click="revoke(k.id)">배제</button>
      </li>
      <li v-if="keys.length === 0" class="muted">아직 개인 키가 없습니다.</li>
    </ul>
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
  margin: 0 0 4px;
  color: #555;
}
.hint {
  font-size: 12px;
  color: #888;
  margin: 0 0 12px;
}
.reveal-box {
  background: #fff8e1;
  border: 1px solid #f0c14b;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}
.reveal-warning {
  font-size: 12px;
  color: #8a6300;
  margin: 0 0 8px;
  font-weight: 600;
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
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.create-row input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
}
.create-row button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 7px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
  font-size: 12px;
}
.list li:last-child {
  border-bottom: none;
}
.list li.revoked {
  opacity: 0.55;
}
.prefix {
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.label {
  color: #555;
}
.status {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
}
.status.active {
  background: #e3f6ec;
  color: #1f9254;
}
.status.revoked {
  background: #f3f0f0;
  color: #888;
}
.at {
  margin-left: auto;
  color: #999;
  font-size: 11px;
  white-space: nowrap;
}
.revoke-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
