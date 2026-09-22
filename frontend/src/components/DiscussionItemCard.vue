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
    <div class="text-body2 q-mt-xs markdown-body" v-html="renderMarkdownSafe(content)"></div>
    <div v-if="error" class="text-negative text-caption q-mt-xs">{{ error }}</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdownSafe } from "src/utils/renderMarkdown";
import { stateColor } from "src/utils/stateColor";
import CategoryPill from "components/CategoryPill.vue";

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
  }>(),
  { avatarSize: "var(--gh-avatar-md)", paddingClass: "q-pa-sm q-mb-sm" }
);

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
