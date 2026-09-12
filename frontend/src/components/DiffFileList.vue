<script setup lang="ts">
import { ref, watch } from "vue";
import type { FileDiff } from "../utils/diffParse";

const props = defineProps<{ files: FileDiff[] }>();

// 파일이 2개 이상이면 기본 접힘(먼저 몇 개 파일이 바뀌었는지 한눈에
// 보이는 게 우선), 1개뿐이면 바로 내용이 보이는 게 자연스러워 펼침.
const collapsed = ref<boolean[]>([]);
watch(
  () => props.files,
  (files) => {
    collapsed.value = files.map(() => files.length > 1);
  },
  { immediate: true },
);

function toggle(i: number) {
  collapsed.value = collapsed.value.map((c, idx) => (idx === i ? !c : c));
}

function fileLabel(f: FileDiff): string {
  if (f.oldPath === "/dev/null") return `${f.newPath} (신규)`;
  if (f.newPath === "/dev/null") return `${f.oldPath} (삭제됨)`;
  if (f.oldPath !== f.newPath) return `${f.oldPath} → ${f.newPath}`;
  return f.newPath;
}
</script>

<template>
  <ul class="file-list">
    <li v-for="(f, i) in files" :key="i" class="file-card">
      <button type="button" class="file-header" @click="toggle(i)">
        <span class="chevron" :class="{ open: !collapsed[i] }">▶</span>
        <span class="path">{{ fileLabel(f) }}</span>
        <span v-if="!f.binary" class="stats">
          <span class="add">+{{ f.additions }}</span>
          <span class="del">-{{ f.deletions }}</span>
        </span>
        <span v-else class="stats muted">바이너리 파일</span>
      </button>
      <div v-if="!collapsed[i]" class="file-body">
        <p v-if="f.binary" class="muted">바이너리 파일이라 내용을 표시할 수 없습니다.</p>
        <template v-else-if="f.hunks.length === 0">
          <p class="muted">변경 내용이 없습니다.</p>
        </template>
        <template v-else>
          <div v-for="(hunk, hi) in f.hunks" :key="hi" class="hunk">
            <div v-if="hunk.header" class="hunk-header">{{ hunk.header }}</div>
            <pre class="diff"><span v-for="(l, li) in hunk.lines" :key="li" :class="l.kind">{{ l.text }}</span></pre>
          </div>
        </template>
      </div>
    </li>
    <li v-if="files.length === 0" class="muted empty">변경된 파일이 없습니다.</li>
  </ul>
</template>

<style scoped>
.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.file-card {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}
.file-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-bg);
  color: var(--color-text);
  border: none;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.chevron {
  font-size: 10px;
  color: var(--color-text-muted);
  transition: transform 0.1s;
  flex-shrink: 0;
}
.chevron.open {
  transform: rotate(90deg);
}
.path {
  flex: 1;
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats {
  display: flex;
  gap: 6px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  flex-shrink: 0;
}
.stats .add {
  color: var(--color-success);
}
.stats .del {
  color: var(--color-danger);
}
.stats.muted {
  color: var(--color-text-muted);
}
.file-body {
  padding: 8px 12px;
}
.hunk + .hunk {
  margin-top: 10px;
}
.hunk-header {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 2px;
}
.diff {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
.diff span {
  display: block;
}
.diff .add {
  background: var(--color-diff-add-bg);
  color: var(--color-success);
}
.diff .del {
  background: var(--color-diff-del-bg);
  color: var(--color-danger);
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.empty {
  padding: 10px;
}
</style>
