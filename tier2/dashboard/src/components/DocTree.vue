<script setup lang="ts">
import { computed } from "vue";
import type { TreeNode } from "../api";

const props = defineProps<{ node: TreeNode; depth?: number; selectedPath?: string; changedPaths?: Set<string> }>();
const emit = defineEmits<{ select: [path: string] }>();

function isDocFile(node: TreeNode): boolean {
  return node.type === "file" && !!node.path && node.path.endsWith(".md") && node.name !== "index.md" && node.name !== "PROTOCOL.md";
}

// RV-00001 결합안 1번: 문서가 하나도 없는 타입 폴더가 그대로 노출되던 걸
// 발견(이 저장소 자신의 docs/도 11개 타입 폴더 중 7개가 비어 있었음) -
// 재귀적으로 실제 문서 파일 수를 세서 0이면 폴더 자체를 렌더링하지 않는다.
function countDocs(node: TreeNode): number {
  if (isDocFile(node)) return 1;
  if (node.type !== "dir") return 0;
  return (node.children ?? []).reduce((sum, child) => sum + countDocs(child), 0);
}

const docCount = computed(() => countDocs(props.node));
const needsAttention = computed(
  () => !!props.node.reply_pending || (!!props.node.path && !!props.changedPaths?.has(props.node.path)),
);
</script>

<template>
  <div class="doc-tree">
    <template v-if="node.type === 'dir' && docCount > 0">
      <q-expansion-item
        :label="`${node.name} (${docCount})`"
        icon="folder"
        dense
        default-opened
        header-class="text-caption text-weight-medium"
      >
        <div :style="{ paddingLeft: '12px' }">
          <DocTree
            v-for="child in node.children"
            :key="child.path ?? child.name"
            :node="child"
            :depth="(depth ?? 0) + 1"
            :selected-path="selectedPath"
            :changed-paths="changedPaths"
            @select="(p) => emit('select', p)"
          />
        </div>
      </q-expansion-item>
    </template>
    <template v-else-if="isDocFile(node)">
      <q-item
        clickable
        dense
        :active="node.path === selectedPath"
        active-class="bg-blue-1 text-primary"
        @click="emit('select', node.path!)"
      >
        <q-item-section avatar style="min-width: 28px">
          <q-badge v-if="node.doc_type" color="grey-6" outline>{{ node.doc_type }}</q-badge>
        </q-item-section>
        <q-item-section>
          <q-item-label lines="1">{{ node.title || node.name }}</q-item-label>
          <q-item-label caption>{{ node.id }} · {{ node.status }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="needsAttention" side>
          <q-icon name="error" color="orange" size="16px">
            <q-tooltip>답변 대기 중이거나 최근 변경됨</q-tooltip>
          </q-icon>
        </q-item-section>
      </q-item>
    </template>
  </div>
</template>
