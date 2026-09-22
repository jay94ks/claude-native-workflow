<template>
  <div class="q-gutter-md">
    <!-- About -->
    <div>
      <div class="text-subtitle2 q-mb-sm">About</div>
      <div v-if="project.current?.description" class="text-body2 q-mb-sm">{{ project.current.description }}</div>
      <div class="q-gutter-xs">
        <div class="row items-center text-body2" style="gap: 6px; color: var(--gh-fg-muted)">
          <q-icon :name="project.current?.visibility === 'PUBLIC' ? 'public' : 'lock'" size="16px" />
          <span>{{ project.current?.visibility === "PUBLIC" ? "Public" : "Private" }}</span>
        </div>
        <div class="row items-center text-body2" style="gap: 6px; color: var(--gh-fg-muted)">
          <q-icon name="account_tree" size="16px" />
          <span>{{ project.current?.defaultBranch }}</span>
        </div>
        <div v-if="project.current?.createdAt" class="row items-center text-body2" style="gap: 6px; color: var(--gh-fg-muted)">
          <q-icon name="schedule" size="16px" />
          <span>{{ new Date(project.current.createdAt).toLocaleDateString() }} 생성</span>
        </div>
      </div>

      <q-separator class="q-my-sm" />

      <div class="q-gutter-xs">
        <router-link :to="`/${owner}/${projectId}/settings/collaborators`" class="row items-center gh-link" style="gap: 6px">
          <q-icon name="group" size="16px" />
          <span>{{ loading ? "…" : members.length }} collaborators</span>
        </router-link>
        <router-link :to="`/${owner}/${projectId}/settings/template`" class="row items-center gh-link" style="gap: 6px">
          <q-icon name="integration_instructions" size="16px" />
          <span>Template</span>
        </router-link>
      </div>
    </div>

    <q-separator />

    <!-- Contributors - 설계자 요청(2026-09-21): 기여자 아이콘을 늘어놓지 말고,
         라벨을 누르면 팝업(q-menu)으로 목록만 보여준다. -->
    <div>
      <div class="text-subtitle2 cursor-pointer gh-link" style="width: fit-content">
        Contributors <span style="color: var(--gh-fg-muted)">{{ loading ? "…" : members.length }}</span>
        <q-menu anchor="bottom left" self="top left">
          <q-list style="min-width: 180px">
            <q-item v-for="m in members" :key="m.username">
              <q-item-section avatar>
                <div class="gh-avatar" style="width: var(--gh-avatar-md); height: var(--gh-avatar-md); font-size: 11px">{{ m.username.charAt(0).toUpperCase() }}</div>
              </q-item-section>
              <q-item-section>{{ m.username }}</q-item-section>
            </q-item>
            <q-item v-if="!loading && members.length === 0"><q-item-section class="text-caption">아직 없음</q-item-section></q-item>
          </q-list>
        </q-menu>
      </div>
    </div>

    <q-separator />

    <!-- Languages 자리 - 문서 타입 구성 비율로 대체 -->
    <div>
      <div class="text-subtitle2 q-mb-sm">문서 타입 구성</div>
      <div v-if="loading" class="text-caption">불러오는 중...</div>
      <template v-else-if="typeBreakdown.length > 0">
        <div class="row" style="height: 8px; border-radius: 4px; overflow: hidden">
          <div
            v-for="t in typeBreakdown"
            :key="t.type"
            :style="{ width: t.percent + '%', background: t.color }"
          />
        </div>
        <div class="row q-mt-sm" style="gap: 12px; flex-wrap: wrap">
          <div v-for="t in typeBreakdown" :key="t.type" class="row items-center text-caption" style="gap: 4px">
            <div style="width: 10px; height: 10px; border-radius: 50%" :style="{ background: t.color }" />
            <span>{{ t.type }} {{ t.percent }}%</span>
          </div>
        </div>
      </template>
      <EmptyState v-else message="아직 문서가 없습니다." />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import EmptyState from "components/EmptyState.vue";
import { useProjectStore } from "stores/project";
import * as api from "src/api/client";

const props = defineProps<{ owner: string; projectId: string }>();
const auth = useAuthStore();
const project = useProjectStore();

interface Member {
  username: string;
  role: string;
}
const members = ref<Member[]>([]);

// documentRules.ts의 KINDS_BY_TYPE을 뒤집은 것 - kind는 type을 1:1로 결정한다.
const KIND_TO_TYPE: Record<string, string> = {
  SP: "doc",
  RP: "doc",
  RM: "doc",
  QA: "doc",
  BT: "doc",
  PL: "plan",
  QU: "question",
  AN: "answer",
  TR: "tracker",
  TC: "test",
  OP: "opinion",
};
const TYPE_COLOR: Record<string, string> = {
  doc: "#3178c6",
  plan: "#8250df",
  question: "#e36209",
  answer: "#2da44e",
  tracker: "#cf222e",
  test: "#bf8700",
  opinion: "#1b7c83",
};

// backend/src/core/documents.ts의 docsStatus 응답 실제 모양:
// byKind[kind] = { byState: { [state]: { count, lastUpdatedAt } } } - kind
// 바로 아래 state map이 아니라 "byState" 한 겹이 더 있다.
interface KindStatus {
  byState: Record<string, { count: number }>;
}
const statusByKind = ref<Record<string, KindStatus>>({});
const loading = ref(true);

const typeBreakdown = computed(() => {
  const totalsByType: Record<string, number> = {};
  let grandTotal = 0;
  for (const [kind, { byState }] of Object.entries(statusByKind.value)) {
    const type = KIND_TO_TYPE[kind] ?? kind;
    for (const { count } of Object.values(byState)) {
      totalsByType[type] = (totalsByType[type] ?? 0) + count;
      grandTotal += count;
    }
  }
  if (grandTotal === 0) return [];
  return Object.entries(totalsByType)
    .map(([type, count]) => ({ type, percent: Math.round((count / grandTotal) * 100), color: TYPE_COLOR[type] ?? "#999" }))
    .sort((a, b) => b.percent - a.percent);
});

async function load() {
  loading.value = true;
  const [membersResult, statusResult] = await Promise.all([
    api.getProjectMembers(auth.apiKey!, props.owner, props.projectId),
    api.getDocsStatus(auth.apiKey!, props.owner, props.projectId),
  ]);
  if (membersResult.ok) members.value = (membersResult.data as { members: Member[] }).members;
  if (statusResult.ok) statusByKind.value = (statusResult.data as { byKind: Record<string, KindStatus> }).byKind;
  loading.value = false;
}

onMounted(load);
</script>
