<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useAuthStore } from "../stores/auth";

// #usage-monitoring - "어떤 요청/명령/흐름이 자주 목격되는지"를 보고
// 어떤 기능을 유지/보완/수정/추가할지 판단하는 용도(설계자 지시) -
// SKILL.md 등 지침 문서와 나란히 두고 비교하기 좋게 raw route가
// 아니라 CLI/MCP 명령 이름으로 라벨링돼 나온다(백엔드
// core/monitoringRegistry.ts). 조회만 하는 단순 대시보드 - 편집 없음.

const props = defineProps<{ id: string }>();
const auth = useAuthStore();

interface StatRow {
  label: string;
  mcp: string | null;
  origin: string;
  count: number;
  lastSeenAt: string;
}
interface TransitionRow {
  from: string;
  to: string;
  count: number;
}

const stats = ref<StatRow[]>([]);
const transitions = ref<TransitionRow[]>([]);
const loading = ref(true);
const error = ref("");
const showInstallWide = ref(false);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const path = showInstallWide.value ? "/monitoring/stats?limit=100" : `/projects/${props.id}/monitoring/stats?limit=100`;
    const data = await apiCall<{ stats: StatRow[]; transitions: TransitionRow[] }>(path);
    stats.value = data.stats;
    transitions.value = data.transitions;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "사용 통계를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

const originLabel: Record<string, string> = { designer: "설계자", ai: "AI", notice: "알림" };

onMounted(load);
watch(showInstallWide, load);
</script>

<template>
  <section class="panel">
    <h1>사용 모니터링</h1>
    <p class="hint">
      어떤 명령이 자주 쓰이는지 + 어떤 명령 다음에 자주 이어지는지 - SKILL.md 등 지침 문서와 비교해 어떤 기능을 유지/보완/수정/추가할지
      판단하는 용도.
    </p>
    <label v-if="auth.me?.isSuperAdmin" class="toggle">
      <input type="checkbox" v-model="showInstallWide" />
      설치 전체(모든 프로젝트 합산)
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <template v-else>
      <section class="block">
        <h2>명령 사용 빈도</h2>
        <table v-if="stats.length > 0" class="stat-table">
          <thead>
            <tr>
              <th>명령</th>
              <th>MCP</th>
              <th>출처</th>
              <th>횟수</th>
              <th>마지막 호출</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in stats" :key="`${s.label}-${s.origin}`">
              <td class="mono">{{ s.label }}</td>
              <td class="mono muted">{{ s.mcp ?? "-" }}</td>
              <td>{{ originLabel[s.origin] ?? s.origin }}</td>
              <td class="num">{{ s.count }}</td>
              <td class="muted">{{ new Date(s.lastSeenAt).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">아직 기록된 사용 통계가 없습니다.</p>
      </section>

      <section class="block">
        <h2>연이은 패턴 (A 다음 B, 5분 이내)</h2>
        <table v-if="transitions.length > 0" class="stat-table">
          <thead>
            <tr>
              <th>이전 명령</th>
              <th>다음 명령</th>
              <th>횟수</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in transitions" :key="`${t.from}->${t.to}`">
              <td class="mono">{{ t.from }}</td>
              <td class="mono">{{ t.to }}</td>
              <td class="num">{{ t.count }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">아직 기록된 연이은 패턴이 없습니다.</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.panel {
  font-size: 13px;
}
h1 {
  font-size: 18px;
  margin: 0 0 4px;
}
.hint {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 0 0 12px;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 16px;
  cursor: pointer;
}
.block {
  margin-top: 20px;
}
.block h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
.stat-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.stat-table th {
  text-align: left;
  font-size: 11px;
  color: var(--color-text-faint);
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-light);
}
.stat-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 12px;
}
.stat-table tr:last-child td {
  border-bottom: none;
}
.mono {
  font-family: monospace;
}
.num {
  text-align: right;
  font-weight: 600;
}
.muted {
  color: var(--color-text-muted);
  font-size: 12px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
