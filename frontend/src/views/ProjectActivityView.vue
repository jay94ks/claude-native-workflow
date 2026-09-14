<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import TrackingCodeText from "../components/TrackingCodeText.vue";

const props = defineProps<{ id: string }>();

interface ActivityItem {
  type: string;
  trackingCode: string | null;
  summary: string;
  at: string;
}

const activity = ref<ActivityItem[]>([]);
const loading = ref(true);
const error = ref("");

// RecentCommentsView.vue의 "최근 코멘트" 더보기와 같은 관례 - 실제
// 페이지네이션 없이 더 큰 limit 하나로 "더 보여준다"(여러 엔티티
// 타입을 매번 병합정렬하는 활동 피드는 커서 기반 페이지네이션을
// 붙이기엔 비용 대비 이득이 적다고 판단, #project-dashboard 후속).
async function load() {
  loading.value = true;
  error.value = "";
  try {
    activity.value = await apiCall<ActivityItem[]>(`/projects/${props.id}/activity?limit=100`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "최근 활동을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <h2 class="heading">최근 활동</h2>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading">불러오는 중...</p>
  <ul v-else class="activity-list">
    <li v-for="(item, i) in activity" :key="i">
      <TrackingCodeText :text="item.summary" />
      <span class="right muted">{{ new Date(item.at).toLocaleString() }}</span>
    </li>
    <li v-if="activity.length === 0" class="muted">최근 활동이 없습니다.</li>
  </ul>
</template>

<style scoped>
.heading {
  font-size: 15px;
  margin: 0 0 12px;
}
.activity-list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.activity-list li {
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.activity-list li:last-child {
  border-bottom: none;
}
.right {
  flex-shrink: 0;
  margin-left: 12px;
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
