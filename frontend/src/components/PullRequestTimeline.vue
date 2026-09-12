<script setup lang="ts">
// PR이 닫힐 때까지의 전체 진행 내역 - Gitea의 issue 타임라인(type으로
// 구분된 이벤트 피드)을 그대로 세로 카드 목록으로 렌더링한다. 이
// 코드베이스에 타임라인/활동피드 컴포넌트가 전혀 없어 새로 만든다.

interface TimelineEntry {
  id: number;
  type: string;
  body: string;
  authorUsername: string | null;
  createdAt: string;
}

defineProps<{ entries: TimelineEntry[] }>();

const TYPE_LABEL: Record<string, string> = {
  comment: "댓글",
  close: "닫힘",
  reopen: "재오픈",
  merge_pull: "머지",
  commit_ref: "커밋 참조",
  label: "라벨 변경",
  assignees: "담당자 변경",
  review: "리뷰",
  review_request: "리뷰 요청",
  change_title: "제목 변경",
};

function label(type: string): string {
  return TYPE_LABEL[type] ?? type;
}
</script>

<template>
  <ul class="timeline">
    <li v-for="e in entries" :key="e.id" class="entry" :class="e.type">
      <span class="dot"></span>
      <div class="content">
        <div class="row">
          <span class="type">{{ label(e.type) }}</span>
          <span v-if="e.authorUsername" class="author">{{ e.authorUsername }}</span>
          <span class="at">{{ new Date(e.createdAt).toLocaleString() }}</span>
        </div>
        <p v-if="e.body" class="body">{{ e.body }}</p>
      </div>
    </li>
    <li v-if="entries.length === 0" class="muted">진행 내역이 없습니다.</li>
  </ul>
</template>

<style scoped>
.timeline {
  list-style: none;
  padding: 0;
  margin: 0;
  position: relative;
}
.entry {
  display: flex;
  gap: 10px;
  padding: 0 0 16px 4px;
  position: relative;
}
.entry:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 14px;
  bottom: -2px;
  width: 1px;
  background: var(--color-border-light);
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--color-border);
  margin-top: 4px;
  flex-shrink: 0;
}
.entry.merge_pull .dot {
  background: var(--color-primary);
}
.entry.close .dot {
  background: var(--color-danger);
}
.entry.reopen .dot,
.entry.comment .dot {
  background: var(--color-success);
}
.content {
  flex: 1;
  min-width: 0;
}
.row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  flex-wrap: wrap;
}
.type {
  font-weight: 600;
}
.author {
  color: var(--color-text-secondary);
}
.at {
  color: var(--color-text-faint);
  margin-left: auto;
}
.body {
  font-size: 13px;
  margin: 4px 0 0;
  white-space: pre-wrap;
  color: var(--color-text-secondary);
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
</style>
