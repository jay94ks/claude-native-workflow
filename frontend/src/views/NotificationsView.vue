<script setup lang="ts">
// 알림 종(#notification-bell) 팝업의 "더보기" - 프로젝트 횡단 "답변
// 대기"(open+pending) 질의 전체를 페이지네이션으로 보여주는 전용
// 페이지. 팝업과 같은 API(/auth/me/pending-questions/page)를 페이지
// 크기만 늘려 재사용.
import { onMounted, ref } from "vue";
import { apiCall } from "../api/client";
import { useAsyncAction } from "../composables/useAsyncAction";
import QuestionListPanel from "../components/QuestionListPanel.vue";

interface NotificationQuestion {
  trackingCode: string;
  targetType: string;
  targetKey: string;
  targetLabel: string;
  kind: string;
  text: string;
  status: string;
  projectName: string;
}
interface NotificationPage {
  items: NotificationQuestion[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const result = ref<NotificationPage>({ items: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });
const { loading, error, run } = useAsyncAction();
loading.value = true; // 최초 로드 전(onMounted) 잠깐이라도 "결과 없음"이 보이지 않게
const pageNum = ref(1);

async function load() {
  await run(async () => {
    const qs = new URLSearchParams({ page: String(pageNum.value), pageSize: "30" });
    result.value = await apiCall<NotificationPage>(`/auth/me/pending-questions/page?${qs}`);
  }, "알림을 불러오지 못했습니다");
}
function onPageChange(page: number) {
  pageNum.value = page;
  load();
}

onMounted(load);
</script>

<template>
  <div class="layout">
    <h2>미확인 알림</h2>
    <p class="hint">내가 속한 모든 프로젝트를 통틀어 아직 답변하지 않았거나 AI 확인이 남은 질의입니다.</p>
    <QuestionListPanel
      :items="result.items"
      :page="result.page"
      :total-pages="result.totalPages"
      :total="result.total"
      :loading="loading"
      :error="error"
      empty-text="미확인 알림이 없습니다."
      @page-change="onPageChange"
    />
  </div>
</template>

<style scoped>
.layout {
  max-width: 720px;
}
h2 {
  font-size: 18px;
  margin: 0 0 4px;
}
.hint {
  font-size: 13px;
  color: var(--color-text-faint);
  margin: 0 0 16px;
}
</style>
