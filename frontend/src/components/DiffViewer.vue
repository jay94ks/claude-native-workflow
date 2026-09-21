<template>
  <div>
    <!-- 설계자 요청(2026-09-21) - 툴바, 버튼은 우측 정렬. -->
    <div class="row items-center justify-between q-mb-sm">
      <div class="text-subtitle2">{{ path }}</div>
      <div class="q-gutter-sm">
        <q-btn size="sm" flat dense icon="account_tree" label="코드 트리에서 보기" :to="treeLink" />
        <q-btn size="sm" flat dense icon="download" label="Raw Content 다운로드" :disable="!canDownload" @click="downloadRaw" />
      </div>
    </div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <template v-else-if="diff">
      <div v-if="diff.isBinary && diff.isImage" class="row q-col-gutter-md">
        <div class="col-6">
          <div class="text-caption q-mb-xs" style="color: var(--gh-fg-muted)">변경 전</div>
          <img v-if="diff.oldImage" :src="diff.oldImage" style="max-width: 100%; border: 1px solid var(--gh-border)" />
          <div v-else class="text-caption">(없음)</div>
        </div>
        <div class="col-6">
          <div class="text-caption q-mb-xs" style="color: var(--gh-fg-muted)">변경 후</div>
          <img v-if="diff.newImage" :src="diff.newImage" style="max-width: 100%; border: 1px solid var(--gh-border)" />
          <div v-else class="text-caption">(없음)</div>
        </div>
      </div>
      <div v-else-if="diff.isBinary" class="text-caption">Raw Contents라서 미리 볼 수 없습니다.</div>
      <!-- 파일이 512KB를 넘으면 서버가 내용을 아예 안 보내므로(gitRepo.ts의
           BLOB_SIZE_LIMIT), 그 상태로 diffLines를 돌리면 "파일 전체가
           삭제/추가됨"처럼 잘못 보인다 - isBinary와 같은 자리에서 먼저 걸러
           안내 문구만 보여준다(Raw Content 다운로드는 그대로 가능). -->
      <div v-else-if="diff.oldTooLarge || diff.newTooLarge" class="text-caption">파일이 너무 커서(512KB 초과) 미리 볼 수 없습니다 - Raw Content 다운로드를 이용하세요.</div>
      <div v-else class="diff-split">
        <template v-for="(block, bi) in blocks" :key="bi">
          <div v-if="block.kind === 'visible'" class="diff-rows">
            <div v-for="(row, ri) in block.rows" :key="ri" class="diff-row">
              <div class="diff-cell diff-cell--old" :class="{ 'diff-cell--removed': row.oldChanged, 'diff-cell--empty': row.oldText === null }">
                <span class="diff-lineno">{{ row.oldLineNo ?? "" }}</span>
                <span class="diff-text">{{ row.oldText ?? "" }}</span>
              </div>
              <div class="diff-cell diff-cell--new" :class="{ 'diff-cell--added': row.newChanged, 'diff-cell--empty': row.newText === null }">
                <span class="diff-lineno">{{ row.newLineNo ?? "" }}</span>
                <span class="diff-text">{{ row.newText ?? "" }}</span>
              </div>
            </div>
          </div>
          <!-- 설계자 요청(2026-09-21) - 중간중간 "변경되지 않은 코드 보기" 버튼으로 접힌 컨텍스트를 펼친다. -->
          <div v-else class="diff-collapsed-row">
            <q-btn size="sm" flat dense icon="unfold_more" :label="`변경되지 않은 코드 보기 (${block.rows.length}줄)`" @click="expand(bi)" />
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";
import { computeSplitDiffBlocks, type DiffBlock } from "src/utils/lineDiff";

interface FileDiff {
  path: string;
  isBinary: boolean;
  isImage: boolean;
  oldExists: boolean;
  newExists: boolean;
  oldContent: string;
  newContent: string;
  oldTooLarge: boolean;
  newTooLarge: boolean;
  oldImage: string | null;
  newImage: string | null;
}

// 설계자 요청(2026-09-21 후속) - `branch`가 주어지면 `head`는 사실
// commit id다(CommitDiffPage 용법 - 그 브랜치 위 특정 커밋). 안 주어지면
// PR 용법 그대로 `head`가 브랜치명이다 - "코드 트리에서 보기" 링크가
// 둘을 구분해서 지금 브랜치의 최신 시점(/code/{head}) 또는 그 브랜치
// 위 특정 커밋 시점(/code/{branch}/{head}, 읽기 전용)으로 각각 연결된다.
const props = defineProps<{ owner: string; projectId: string; base: string; head: string; path: string; branch?: string }>();
const auth = useAuthStore();

const loading = ref(true);
const diff = ref<FileDiff | null>(null);
const expandedBlocks = ref<Set<number>>(new Set());

const treeLink = computed(() => {
  const target = props.branch ? `code/${props.branch}/${props.head}` : `code/${props.head}`;
  return `/${props.owner}/${props.projectId}/${target}?path=${encodeURIComponent(props.path)}`;
});
// 파일이 너무 커서(oldTooLarge/newTooLarge) 서버가 content를 아예 안 준
// 경우 다운로드 버튼을 눌러도 빈 파일만 받게 되므로(실제 원본을 다시
// 가져오는 별도 raw 엔드포인트는 아직 없음 - 이 저장소엔 512KB 넘는
// 파일 자체가 없어 검증할 방법도 없다) 그 상황만큼은 버튼을 비활성화한다.
const canDownload = computed(
  () =>
    !!diff.value &&
    (diff.value.newExists || diff.value.oldExists) &&
    !(diff.value.isBinary && !diff.value.isImage) &&
    !diff.value.oldTooLarge &&
    !diff.value.newTooLarge
);

const rawBlocks = ref<DiffBlock[]>([]);
const blocks = computed(() => {
  return rawBlocks.value.map((b, i) => (expandedBlocks.value.has(i) ? { kind: "visible" as const, rows: b.rows } : b));
});

function expand(index: number) {
  expandedBlocks.value = new Set([...expandedBlocks.value, index]);
}

function downloadRaw() {
  if (!diff.value) return;
  const content = diff.value.newExists ? diff.value.newContent : diff.value.oldContent;
  const filename = props.path.split("/").pop() ?? props.path;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function load() {
  loading.value = true;
  expandedBlocks.value = new Set();
  const result = await api.getFileDiff(auth.apiKey!, props.owner, props.projectId, props.base, props.head, props.path);
  if (result.ok) {
    diff.value = result.data as FileDiff;
    if (diff.value && !diff.value.isBinary && !diff.value.oldTooLarge && !diff.value.newTooLarge) {
      rawBlocks.value = computeSplitDiffBlocks(diff.value.oldContent, diff.value.newContent, 6);
    } else {
      rawBlocks.value = [];
    }
  } else {
    diff.value = null;
    rawBlocks.value = [];
  }
  loading.value = false;
}

watch(() => [props.owner, props.projectId, props.base, props.head, props.path], load, { immediate: true });
</script>

<style scoped>
.diff-split {
  border: 1px solid var(--gh-border);
  border-radius: 6px;
  overflow: hidden;
  font-family: monospace;
  font-size: 12px;
}
.diff-row {
  display: flex;
}
.diff-cell {
  width: 50%;
  display: flex;
  white-space: pre;
  overflow-x: auto;
  padding: 0 8px;
}
.diff-cell--old {
  border-right: 1px solid var(--gh-border);
}
.diff-cell--removed {
  background: rgba(255, 129, 130, 0.2);
}
.diff-cell--added {
  background: rgba(87, 171, 90, 0.2);
}
.diff-cell--empty {
  background: var(--gh-canvas-subtle);
}
.diff-lineno {
  display: inline-block;
  min-width: 36px;
  text-align: right;
  margin-right: 8px;
  color: var(--gh-fg-muted);
  user-select: none;
  flex-shrink: 0;
}
.diff-text {
  white-space: pre;
}
.diff-collapsed-row {
  background: var(--gh-canvas-subtle);
  border-top: 1px solid var(--gh-border);
  border-bottom: 1px solid var(--gh-border);
  padding: 2px 8px;
  display: flex;
  justify-content: center;
}
</style>
