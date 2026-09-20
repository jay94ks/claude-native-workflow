<template>
  <div class="q-pa-md" style="max-width: 900px; margin: 0 auto">
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn flat dense round icon="arrow_back" @click="goBack" />
      <div class="text-h6">Q&A 스레드</div>
    </div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <template v-else-if="item">
      <div class="gh-card q-pa-md q-mb-md">
        <div class="row items-center justify-between">
          <div class="row items-center" style="gap: 6px">
            <div class="gh-avatar" style="width: 24px; height: 24px; font-size: 12px">{{ item.author === "agent" ? "C" : "A" }}</div>
            <span class="text-weight-medium">{{ item.author === "agent" ? "claude" : "architect" }}</span>
            <q-badge :color="kindColor(item.kind)" outline dense>{{ kindLabel(item.kind) }}</q-badge>
          </div>
          <q-badge :color="stateColor(item.state)">{{ item.state }}</q-badge>
        </div>
        <div class="text-subtitle1 q-mt-sm">{{ item.title }}</div>
        <div class="text-body2 q-mt-xs" style="white-space: pre-wrap">{{ item.content }}</div>
      </div>

      <div class="text-subtitle2 q-mb-sm">자식 항목 ({{ children.length }})</div>
      <div v-if="children.length === 0" class="text-caption" style="color: var(--gh-fg-muted)">자식 항목이 없습니다.</div>
      <div v-for="child in children" :key="child.code" class="gh-card q-pa-sm q-mb-sm">
        <div class="row items-center justify-between">
          <div class="row items-center" style="gap: 6px">
            <div class="gh-avatar" style="width: 20px; height: 20px; font-size: 10px">{{ child.author === "agent" ? "C" : "A" }}</div>
            <span class="text-caption text-weight-medium">{{ child.author === "agent" ? "claude" : "architect" }}</span>
            <q-badge :color="kindColor(child.kind)" outline dense>{{ kindLabel(child.kind) }}</q-badge>
          </div>
          <div class="row items-center" style="gap: 2px">
            <q-badge :color="stateColor(child.state)">{{ child.state }}</q-badge>
            <q-btn
              v-if="(childCounts[child.code] ?? 0) > 0"
              flat
              dense
              round
              size="sm"
              icon="more_horiz"
              :to="`/projects/${projectId}/thread/${child.code}`"
            >
              <q-tooltip>자식 항목 {{ childCounts[child.code] }}개 보기</q-tooltip>
            </q-btn>
          </div>
        </div>
        <div class="text-body2 q-mt-xs" style="white-space: pre-wrap">{{ child.content }}</div>
      </div>
    </template>
    <div v-else class="text-negative text-caption">문서를 찾을 수 없습니다.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";

interface DocFull {
  code: string;
  kind: string;
  state: string;
  title: string;
  content: string;
  author: string;
}

const props = defineProps<{ projectId: string; code: string }>();
const auth = useAuthStore();
const router = useRouter();

const loading = ref(true);
const item = ref<DocFull | null>(null);
const children = ref<DocFull[]>([]);
const childCounts = ref<Record<string, number>>({});

function parseIdFromCode(code: string): string {
  return code.split("-")[1] ?? code;
}

function kindLabel(kind: string): string {
  if (kind === "QU") return "question";
  if (kind === "AN") return "answer";
  if (kind === "OP") return "opinion";
  return kind;
}
function kindColor(kind: string): string {
  if (kind === "OP") return "teal";
  if (kind === "AN") return "positive";
  return "primary";
}
function stateColor(state: string): string {
  if (state === "done") return "positive";
  if (state === "discard") return "grey-6";
  return "primary";
}

function goBack() {
  router.back();
}

async function load() {
  loading.value = true;
  const result = await api.getDocument(auth.apiKey!, props.projectId, props.code);
  if (!result.ok) {
    item.value = null;
    loading.value = false;
    return;
  }
  item.value = result.data as DocFull;

  const rawId = parseIdFromCode(props.code);
  const listResult = await api.listDocuments(auth.apiKey!, props.projectId, { parentId: rawId });
  const summaries = listResult.ok ? (listResult.data as { items: { code: string }[] }).items : [];
  const fulls = await Promise.all(
    summaries.map(async (s) => {
      const r = await api.getDocument(auth.apiKey!, props.projectId, s.code);
      return r.ok ? (r.data as DocFull) : null;
    })
  );
  children.value = fulls.filter((d): d is DocFull => d !== null);
  loading.value = false;

  // 각 자식이 또 자식을 갖는지(더 깊은 계층) - more 아이콘을 재귀적으로 보여주기 위함.
  await Promise.all(
    children.value.map(async (child) => {
      const childRawId = parseIdFromCode(child.code);
      const r = await api.listDocuments(auth.apiKey!, props.projectId, { parentId: childRawId });
      if (r.ok) childCounts.value[child.code] = (r.data as { items: unknown[] }).items.length;
    })
  );
}

onMounted(load);
watch(() => props.code, load);
</script>
