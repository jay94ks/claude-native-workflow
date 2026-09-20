<template>
  <div class="q-pa-md" style="max-width: 800px; margin: 0 auto">
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn flat dense round icon="arrow_back" :to="`/projects/${projectId}/code`" />
      <div class="text-h6">{{ branch }} 브랜치 최근 커밋</div>
    </div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <q-list v-else bordered separator>
      <q-item v-for="c in commits" :key="c.id" clickable :to="`/projects/${projectId}/commit/${c.id}`">
        <q-item-section>
          <q-item-label>{{ c.message }}</q-item-label>
          <q-item-label caption>{{ c.id.slice(0, 8) }} · {{ c.author }} · {{ new Date(c.time).toLocaleString() }}</q-item-label>
        </q-item-section>
      </q-item>
      <q-item v-if="commits.length === 0"><q-item-section class="text-caption">커밋이 없습니다.</q-item-section></q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
// 설계자 요청(2026-09-21, 항목 9) - Code 탭 좌측 패널의 "최근 커밋" 목록을
// 없애고, 브랜치 선택기 옆 눈알 아이콘을 누르면 이 별도 페이지에서
// 그 브랜치의 최근 커밋을 본다. 항목을 누르면 CommitDiffPage(항목 10).
import { ref, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";

interface CommitInfo {
  id: string;
  message: string;
  author: string;
  time: string;
}

const props = defineProps<{ projectId: string }>();
const auth = useAuthStore();
const route = useRoute();

const loading = ref(true);
const commits = ref<CommitInfo[]>([]);
const branch = ref("");

async function load() {
  const b = route.query.branch;
  branch.value = typeof b === "string" ? b : "";
  if (!branch.value) {
    commits.value = [];
    return;
  }
  loading.value = true;
  const result = await api.listCommits(auth.apiKey!, props.projectId, branch.value, 50);
  if (result.ok) commits.value = (result.data as { items: CommitInfo[] }).items;
  loading.value = false;
}

onMounted(load);
watch(() => route.query.branch, load);
</script>
