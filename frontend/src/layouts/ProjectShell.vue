<template>
  <q-page v-if="project.current">
    <!-- 브레드크럼/타이틀/배지 줄은 MainLayout의 탑바로 통합됐다(설계자
         요청) - 여기는 그 밑의 GitHub 탭바만 담당한다. Code/Issues/PRs
         자리에 우리 앱의 실제 화면들을 그대로 매핑. -->
    <q-tabs
      align="left"
      class="gh-tabs q-px-md"
      style="background: var(--gh-canvas); border-bottom: 1px solid var(--gh-border)"
      indicator-style="height: 2px"
      no-caps
      dense
    >
      <q-route-tab v-for="t in tabs" :key="t.to" :to="`/projects/${projectId}/${t.to}`" content-class="row items-center no-wrap">
        <q-icon :name="t.icon" size="16px" class="q-mr-xs" />
        <div>{{ t.label }}</div>
      </q-route-tab>
    </q-tabs>

    <div style="max-width: 1280px; margin: 0 auto; width: 100%">
      <router-view />
    </div>
  </q-page>
  <q-page v-else-if="project.loading" class="q-pa-md">
    <div class="text-caption">불러오는 중...</div>
  </q-page>
  <q-page v-else class="q-pa-md">
    <div class="text-negative">{{ loadError }}</div>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useProjectStore } from "stores/project";

const props = defineProps<{ projectId: string }>();
const project = useProjectStore();
const loadError = ref("");

// design-notes.md "UI 설계" - question/answer/opinion은 별도 Q&A 탭을
// 두지 않는다(각 문서 화면에 DocumentDiscussion으로 통합) - 그래서
// 여기 탭 목록에 Q&A가 없다.
// 설계자 요청(2026-09-20) - Code/Pull requests/Issues는 Documents 앞에 둔다.
// 설계자 요청(2026-09-21) - Collaborators/Template은 독립 탭이 아니라
// Settings 탭 안 좌측 메뉴(기본 설정/Collaborators/Template)로 통합됐다
// - layouts/SettingsShell.vue 참고.
const tabs = [
  { to: "code", icon: "code", label: "Code" },
  { to: "pull-requests", icon: "call_merge", label: "Pull requests" },
  { to: "issues", icon: "error_outline", label: "Issues" },
  { to: "documents", icon: "description", label: "Documents" },
  { to: "plans", icon: "checklist", label: "Plans" },
  { to: "trackers-tests", icon: "science", label: "Trackers" },
  { to: "settings", icon: "settings", label: "Settings" },
];

async function load() {
  const result = await project.load(props.projectId);
  if (!result.ok) loadError.value = result.reason?.join(", ") ?? "프로젝트를 불러올 수 없습니다.";
}

onMounted(load);
watch(() => props.projectId, load);
</script>

<style scoped>
/* GitHub 저장소 페이지 탭바(Code/Issues/…) 스타일 그대로 - 아이콘+라벨 한 줄,
   비활성 탭은 muted 텍스트, 활성 탭은 굵은 텍스트 + 주황빛 밑줄. */
.gh-tabs :deep(.q-tab) {
  min-height: 44px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--gh-fg-muted);
  text-transform: none;
}
/* Quasar가 .q-tab__content에 기본으로 붙이는 "column" 클래스가 시트 순서상
   content-class="row"보다 나중에 이겨서 아이콘이 라벨 위로 쌓인다 - 강제로
   가로 배치(아이콘 왼쪽, 텍스트 오른쪽)로 되돌린다. */
.gh-tabs :deep(.q-tab__content) {
  flex-direction: row !important;
}
.gh-tabs :deep(.q-tab--active) {
  color: var(--gh-fg);
  font-weight: 600;
}
.gh-tabs :deep(.q-tab__indicator) {
  background: #fd8c73 !important;
}
.gh-tabs :deep(.q-tab:hover) {
  color: var(--gh-fg);
}
</style>
