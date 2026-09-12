<script setup lang="ts">
// FolderPickerDialog.vue 전용 - 읽기 전용(생성/이름변경/삭제/드래그
// 없음) 재귀 노드. 자기 자신을 템플릿에서 참조해 임의 깊이를 그린다
// (<script setup> SFC는 파일명 기반 태그로 자기 자신을 자동 등록 -
// defineOptions로 이름을 명시해 확실히 한다).
import type { FolderTreeNode } from "../utils/folderTree";

interface FolderItem {
  id: string;
  parentFolderId: string | null;
  name: string;
}
type Node = FolderItem & FolderTreeNode<FolderItem>;

defineOptions({ name: "FolderPickerNode" });
defineProps<{ node: Node; selected: string | null | undefined }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <li>
    <div class="node" :class="{ active: selected === node.id }" @click="emit('select', node.id)">
      <span>📁 {{ node.name }}</span>
    </div>
    <ul v-if="node.children.length > 0" class="children">
      <FolderPickerNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :selected="selected"
        @select="(id) => emit('select', id)"
      />
    </ul>
  </li>
</template>

<style scoped>
.node {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.node:hover {
  background: var(--color-surface-hover);
}
.node.active {
  background: var(--color-tcode-hover-bg);
  color: var(--color-primary);
  font-weight: 600;
}
.children {
  list-style: none;
  padding: 0 0 0 18px;
  margin: 0;
}
</style>
