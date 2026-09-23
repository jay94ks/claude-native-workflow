<template>
  <div class="gh-card" :class="[paddingClass, { 'qa-highlighted': highlighted }]" :id="`qa-${code}`">
    <div class="row items-center justify-between">
      <div class="row items-center" style="gap: 6px; min-width: 0">
        <CategoryPill :color="kindColor">{{ kindLabel }}</CategoryPill>
        <span class="text-weight-medium ellipsis">{{ title }}</span>
      </div>
      <div class="row items-center" style="gap: 4px; flex-shrink: 0">
        <q-badge :color="stateColorValue">{{ state }}</q-badge>
        <div class="gh-avatar" :style="{ width: avatarSize, height: avatarSize, fontSize: `calc(${avatarSize} * 0.5)` }">
          {{ author === "agent" ? "C" : "A" }}
        </div>
        <q-btn v-if="hasMenu" flat dense round size="sm" icon="more_vert">
          <q-menu auto-close>
            <q-list style="min-width: 160px">
              <slot name="menu" />
            </q-list>
          </q-menu>
        </q-btn>
      </div>
    </div>
    <div v-if="!editing" class="text-body2 q-mt-xs markdown-body" v-html="renderMarkdownSafe(content)"></div>
    <!-- 설계자 요청(2026-09-23) - "question이나 opinion들에서 아직
         확인전인 것들은 수정을 할 수 있어야해" - 목록 카드는 대부분
         v-html로 가볍게 렌더링하고(스레드 하나에 항목이 10~50개일 수
         있어 전부 MarkdownSourceView/yiitap로 띄우면 무겁다), 실제로
         "수정" 중인 카드 하나만 편집기로 바뀐다(editing은 부모가
         한 번에 하나만 켜준다 - answeringCode와 같은 패턴). -->
    <MarkdownSourceView v-else :content="content" start-in-edit @save="$emit('update', $event)" @cancel="$emit('cancelEdit')" />
    <div v-if="error" class="text-negative text-caption q-mt-xs">{{ error }}</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdownSafe } from "src/utils/renderMarkdown";
import { stateColor } from "src/utils/stateColor";
import CategoryPill from "components/CategoryPill.vue";
import MarkdownSourceView from "components/MarkdownSourceView.vue";

const props = withDefaults(
  defineProps<{
    code: string;
    kind: string;
    title: string;
    state: string;
    author: string;
    content: string;
    error?: string;
    hasMenu: boolean;
    highlighted?: boolean;
    avatarSize?: string;
    paddingClass?: string;
    // 이 카드가 지금 "수정" 중인지 - 부모가 한 번에 최대 하나의 카드만
    // true로 켜준다(어느 카드를 편집 중인지는 부모가 소유·판단한다 -
    // 이 카드 자체는 그 여부를 그대로 반영만 하는 순수 표시 컴포넌트).
    editing?: boolean;
  }>(),
  { avatarSize: "var(--gh-avatar-md)", paddingClass: "q-pa-sm q-mb-sm", editing: false }
);
defineEmits<{ update: [markdown: string]; cancelEdit: [] }>();

function kindLabelOf(kind: string): string {
  if (kind === "QU") return "question";
  if (kind === "AN") return "answer";
  if (kind === "OP") return "opinion";
  return kind;
}
function kindColorOf(kind: string): string {
  if (kind === "OP") return "teal";
  if (kind === "AN") return "positive";
  return "primary";
}

const kindLabel = computed(() => kindLabelOf(props.kind));
const kindColor = computed(() => kindColorOf(props.kind));
const stateColorValue = computed(() => stateColor(props.state));
</script>

<style scoped>
.qa-highlighted {
  outline: 2px solid var(--gh-accent);
  animation: qa-highlight-fade 2.5s ease-out;
}
@keyframes qa-highlight-fade {
  from {
    background: rgba(9, 105, 218, 0.12);
  }
  to {
    background: transparent;
  }
}
</style>
