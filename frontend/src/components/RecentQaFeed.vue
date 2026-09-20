<template>
  <div class="q-pa-md">
    <div class="text-caption q-mb-sm" style="color: var(--gh-fg-muted)">
      프로젝트 전체의 최근 질의/답변/의견 모아보기 - 읽기 전용이며, 실제로 질문/답변/의견을 달거나 처리하려면 그 문서 화면의
      Discussion으로 이동해야 합니다.
    </div>
    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <q-list v-else bordered separator>
      <q-item v-for="item in feed" :key="item.code">
        <q-item-section>
          <q-item-label>{{ item.title }}</q-item-label>
          <q-item-label caption>
            {{ item.code }} · author: {{ item.author }} · {{ new Date(item.createdAt).toLocaleString() }}
            <span v-if="item.parent_id"> · parent: {{ item.parent_id }}</span>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="column items-end" style="gap: 4px">
            <q-badge :color="item.type === 'opinion' ? 'teal' : 'primary'" outline dense>{{ item.type }}</q-badge>
            <q-badge :color="stateColor(item.state)">{{ item.state }}</q-badge>
          </div>
        </q-item-section>
      </q-item>
      <q-item v-if="feed.length === 0"><q-item-section class="text-caption">최근 질의/의견이 없습니다.</q-item-section></q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "stores/auth";

interface DocSummary {
  code: string;
  parent_id: string | null;
  type: string;
  state: string;
  title: string;
  author: string;
  createdAt: string;
}

const props = defineProps<{ projectId: string }>();
const auth = useAuthStore();
const feed = ref<DocSummary[]>([]);
const loading = ref(true);

function stateColor(state: string): string {
  if (state === "done") return "positive";
  if (state === "discard") return "grey-6";
  return "primary";
}

async function load() {
  loading.value = true;
  const [q, a, o] = await Promise.all([
    auth.run({ action: "docs.list", projectId: props.projectId, type: "question" }),
    auth.run({ action: "docs.list", projectId: props.projectId, type: "answer" }),
    auth.run({ action: "docs.list", projectId: props.projectId, type: "opinion" }),
  ]);
  const items: DocSummary[] = [];
  for (const r of [q, a, o]) {
    if (r.ok) items.push(...(r.data as { items: DocSummary[] }).items);
  }
  items.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  feed.value = items.slice(0, 30);
  loading.value = false;
}

onMounted(load);
</script>
