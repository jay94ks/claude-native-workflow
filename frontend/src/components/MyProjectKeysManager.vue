<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

interface ApiKeyDetailWithProject {
  id: string;
  ownerId: string;
  scope: string;
  projectId: string | null;
  projectName: string | null;
  teamId: string | null;
  label: string | null;
  keyPrefix: string;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

const keys = ref<ApiKeyDetailWithProject[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    keys.value = await apiCall<ApiKeyDetailWithProject[]>("/api-keys/project-mine");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "키 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
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

function statusLabel(k: ApiKeyDetailWithProject): string {
  return k.status === "active" ? "활성" : k.status === "expired" ? "만료됨" : "배제됨";
}

onMounted(load);
</script>

<template>
  <div class="manager">
    <p class="hint">
      여러 프로젝트에 걸쳐 만들어둔 프로젝트 키를 한 곳에 모아본다(조회/배제 전용) - 새 프로젝트 키는 그 프로젝트의
      "키 관리" 화면에서 만든다.
    </p>
    <p v-if="error" class="error">{{ error }}</p>

    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="list">
      <li v-for="k in keys" :key="k.id" :class="{ inactive: k.status !== 'active' }">
        <router-link v-if="k.projectId" :to="`/projects/${k.projectId}/keys`" class="project-name">
          {{ k.projectName || "(알 수 없는 프로젝트)" }}
        </router-link>
        <span v-else class="project-name muted">(알 수 없는 프로젝트)</span>
        <code class="prefix">{{ k.keyPrefix }}••••••••</code>
        <span class="label">{{ k.label || "(라벨 없음)" }}</span>
        <span class="status" :class="k.status">{{ statusLabel(k) }}</span>
        <span class="at">
          {{ new Date(k.createdAt).toLocaleString() }}
          <template v-if="k.expiresAt"> · 만료 {{ new Date(k.expiresAt).toLocaleString() }}</template>
        </span>
        <button v-if="k.status === 'active'" class="revoke-btn" @click="revoke(k.id)">배제</button>
      </li>
      <li v-if="keys.length === 0" class="muted">아직 프로젝트 키가 없습니다.</li>
    </ul>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 12px;
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
  border-bottom: 1px solid var(--color-border-light);
  font-size: 12px;
}
.list li:last-child {
  border-bottom: none;
}
.list li.inactive {
  opacity: 0.55;
}
.project-name {
  font-weight: 600;
  color: var(--color-text);
  text-decoration: none;
}
.project-name:hover {
  text-decoration: underline;
}
.prefix {
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}
.label {
  color: var(--color-text-secondary);
}
.status {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
}
.status.active {
  background: var(--color-success-bg);
  color: var(--color-success);
}
.status.revoked,
.status.expired {
  background: var(--color-surface-hover);
  color: var(--color-text-muted);
}
.at {
  margin-left: auto;
  color: var(--color-text-faint);
  font-size: 11px;
  white-space: nowrap;
}
.revoke-btn {
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
