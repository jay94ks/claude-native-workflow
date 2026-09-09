<script setup lang="ts">
import type { TreeNode } from "../api";

defineProps<{ node: TreeNode; depth?: number; selectedPath?: string }>();
const emit = defineEmits<{ select: [path: string] }>();

function isDocFile(node: TreeNode): boolean {
  return node.type === "file" && !!node.path && node.path.endsWith(".md") && node.name !== "index.md" && node.name !== "PROTOCOL.md";
}
</script>

<template>
  <div class="doc-tree">
    <template v-if="node.type === 'dir'">
      <q-expansion-item
        :label="node.name"
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
      </q-item>
    </template>
  </div>
</template>
