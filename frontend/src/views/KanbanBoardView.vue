<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";

const props = defineProps<{ id: string }>();
const kanbanDialog = useKanbanCardDialogStore();

interface KanbanColumnView {
  id: string;
  projectId: string;
  name: string;
  order: number;
  hidden: boolean;
}
interface KanbanCardSummary {
  trackingCode: string;
  columnId: string;
  title: string;
  origin: string;
  hidden: boolean;
  order: number;
}

const columns = ref<KanbanColumnView[]>([]);
const cards = ref<KanbanCardSummary[]>([]);
const loading = ref(true);
const error = ref("");

let disconnect: (() => void) | null = null;

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [cols, allCards] = await Promise.all([
      apiCall<KanbanColumnView[]>(`/projects/${props.id}/kanban/columns`),
      apiCall<KanbanCardSummary[]>(`/projects/${props.id}/kanban/cards?includeHidden=true`),
    ]);
    columns.value = cols;
    cards.value = allCards;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "칸반 보드를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

const visibleColumns = computed(() => columns.value.filter((c) => !c.hidden));
const hiddenColumns = computed(() => columns.value.filter((c) => c.hidden));

function cardsFor(columnId: string): KanbanCardSummary[] {
  return cards.value.filter((c) => c.columnId === columnId && !c.hidden).sort((a, b) => a.order - b.order);
}
function hiddenCardsFor(columnId: string): KanbanCardSummary[] {
  return cards.value.filter((c) => c.columnId === columnId && c.hidden);
}

// ---------------------------------------------------------------- 분류(컬럼)

const showNewColumnForm = ref(false);
const newColumnName = ref("");
const columnError = ref("");

async function createColumn() {
  if (!newColumnName.value.trim()) return;
  columnError.value = "";
  try {
    await apiCall(`/projects/${props.id}/kanban/columns`, {
      method: "POST",
      body: JSON.stringify({ name: newColumnName.value.trim() }),
    });
    newColumnName.value = "";
    showNewColumnForm.value = false;
    await load();
  } catch (err) {
    columnError.value = err instanceof ApiError ? err.message : "분류 생성에 실패했습니다";
  }
}

const showHiddenPanel = ref(false);

async function setColumnHidden(id: string, hidden: boolean) {
  columnError.value = "";
  try {
    await apiCall(`/kanban/columns/${id}/hidden`, { method: "PUT", body: JSON.stringify({ hidden }) });
    await load();
  } catch (err) {
    columnError.value = err instanceof ApiError ? err.message : "숨김 처리에 실패했습니다";
  }
}

const draggedColumnId = ref<string | null>(null);

function onColumnDragStart(id: string) {
  draggedColumnId.value = id;
}

async function onColumnDrop(targetId: string) {
  const draggedId = draggedColumnId.value;
  draggedColumnId.value = null;
  if (!draggedId || draggedId === targetId) return;
  const ids = visibleColumns.value.map((c) => c.id);
  const fromIdx = ids.indexOf(draggedId);
  const toIdx = ids.indexOf(targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, draggedId);
  try {
    await apiCall(`/projects/${props.id}/kanban/columns/order`, { method: "PUT", body: JSON.stringify({ columnIds: ids }) });
    await load();
  } catch (err) {
    columnError.value = err instanceof ApiError ? err.message : "순서 변경에 실패했습니다";
  }
}

// ---------------------------------------------------------------- 카드

const openMenuColumnId = ref<string | null>(null);
function toggleMenu(columnId: string) {
  openMenuColumnId.value = openMenuColumnId.value === columnId ? null : columnId;
}

const newCardColumnId = ref<string | null>(null);
const newCardTitle = ref("");
const newCardBody = ref("");
const newCardRefs = ref("");
const cardError = ref("");

function openCardForm(columnId: string) {
  newCardColumnId.value = columnId;
  newCardTitle.value = "";
  newCardBody.value = "";
  newCardRefs.value = "";
  cardError.value = "";
}

async function createCard() {
  if (!newCardColumnId.value || !newCardTitle.value.trim()) return;
  cardError.value = "";
  try {
    await apiCall(`/projects/${props.id}/kanban/cards`, {
      method: "POST",
      body: JSON.stringify({
        columnId: newCardColumnId.value,
        title: newCardTitle.value.trim(),
        body: newCardBody.value.trim() || undefined,
        refs: newCardRefs.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        origin: "designer",
      }),
    });
    newCardColumnId.value = null;
    await load();
  } catch (err) {
    cardError.value = err instanceof ApiError ? err.message : "카드 생성에 실패했습니다";
  }
}

async function setCardHidden(trackingCode: string, hidden: boolean) {
  cardError.value = "";
  try {
    await apiCall(`/kanban/cards/${trackingCode}/hidden`, { method: "PUT", body: JSON.stringify({ hidden }) });
    await load();
  } catch (err) {
    cardError.value = err instanceof ApiError ? err.message : "숨김 처리에 실패했습니다";
  }
}

const draggedCardCode = ref<string | null>(null);
function onCardDragStart(trackingCode: string) {
  draggedCardCode.value = trackingCode;
}

async function onCardDrop(columnId: string, index?: number) {
  const code = draggedCardCode.value;
  draggedCardCode.value = null;
  if (!code) return;
  try {
    await apiCall(`/kanban/cards/${code}/move`, {
      method: "PUT",
      body: JSON.stringify({ toColumnId: columnId, toIndex: index }),
    });
    await load();
  } catch (err) {
    cardError.value = err instanceof ApiError ? err.message : "카드 이동에 실패했습니다";
  }
}

function openCard(trackingCode: string) {
  kanbanDialog.show(trackingCode);
}

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.id, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "kanbanColumn" || event.entity === "kanbanCard") load();
    },
  });
});
onUnmounted(() => disconnect?.());
</script>

<template>
  <div class="board-toolbar">
    <button @click="showNewColumnForm = !showNewColumnForm">+ 새 분류</button>
    <button class="secondary" @click="showHiddenPanel = !showHiddenPanel">숨김 관리 ({{ hiddenColumns.length }})</button>
  </div>
  <form v-if="showNewColumnForm" class="new-column-form" @submit.prevent="createColumn">
    <input v-model="newColumnName" type="text" placeholder="분류 이름" />
    <button type="submit">생성</button>
  </form>
  <div v-if="showHiddenPanel" class="hidden-panel">
    <p v-if="hiddenColumns.length === 0" class="muted">숨긴 분류가 없습니다.</p>
    <div v-for="c in hiddenColumns" :key="c.id" class="hidden-row">
      <span>{{ c.name }}</span>
      <button @click="setColumnHidden(c.id, false)">표시</button>
    </div>
  </div>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="columnError" class="error">{{ columnError }}</p>
  <p v-if="cardError" class="error">{{ cardError }}</p>
  <p v-if="loading">불러오는 중...</p>

  <div v-else class="board">
    <div
      v-for="col in visibleColumns"
      :key="col.id"
      class="column"
      @dragover.prevent
      @drop="onCardDrop(col.id)"
    >
      <div
        class="column-header"
        draggable="true"
        @dragstart="onColumnDragStart(col.id)"
        @dragover.prevent
        @drop.stop="onColumnDrop(col.id)"
      >
        <span class="column-name">{{ col.name }}</span>
        <span class="column-count">{{ cardsFor(col.id).length }}</span>
        <button class="menu-btn" @click="toggleMenu(col.id)">...</button>
      </div>

      <div v-if="openMenuColumnId === col.id" class="column-menu">
        <p class="menu-title">숨긴 카드</p>
        <p v-if="hiddenCardsFor(col.id).length === 0" class="muted">숨긴 카드가 없습니다.</p>
        <div v-for="c in hiddenCardsFor(col.id)" :key="c.trackingCode" class="hidden-row">
          <span>{{ c.title }}</span>
          <button @click="setCardHidden(c.trackingCode, false)">표시</button>
        </div>
      </div>

      <div class="card-list">
        <div
          v-for="(c, i) in cardsFor(col.id)"
          :key="c.trackingCode"
          class="card"
          draggable="true"
          @dragstart="onCardDragStart(c.trackingCode)"
          @dragover.prevent
          @drop.stop="onCardDrop(col.id, i)"
          @click="openCard(c.trackingCode)"
        >
          <span v-if="c.origin === 'designer'" class="badge">필수</span>
          <span class="card-title">{{ c.title }}</span>
          <button class="hide-btn" title="숨기기" @click.stop="setCardHidden(c.trackingCode, true)">숨김</button>
        </div>
      </div>

      <button class="add-card-btn" @click="openCardForm(col.id)">+ 카드</button>
      <form v-if="newCardColumnId === col.id" class="new-card-form" @submit.prevent="createCard">
        <input v-model="newCardTitle" type="text" placeholder="카드 제목" />
        <textarea v-model="newCardBody" rows="2" placeholder="설명(선택)"></textarea>
        <input v-model="newCardRefs" type="text" placeholder="근거 문서 trackingCode(쉼표 구분, 선택)" />
        <div class="new-card-actions">
          <button type="submit">추가</button>
          <button type="button" class="secondary" @click="newCardColumnId = null">취소</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.board-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.board-toolbar button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
}
.board-toolbar button.secondary {
  background: #fff;
  color: #333;
  border: 1px solid #d8dae0;
}
.new-column-form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.new-column-form input {
  padding: 6px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.hidden-panel {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px 14px;
  margin-bottom: 12px;
}
.hidden-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}
.hidden-row button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
}
.board {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding-bottom: 8px;
  align-items: flex-start;
}
.column {
  flex: 0 0 260px;
  background: #f0f1f5;
  border-radius: 8px;
  padding: 10px;
  min-height: 120px;
}
.column-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: grab;
  margin-bottom: 8px;
}
.column-name {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
}
.column-count {
  font-size: 11px;
  color: #888;
  background: #fff;
  padding: 1px 7px;
  border-radius: 999px;
}
.menu-btn {
  background: none;
  border: none;
  color: #999;
  font-size: 14px;
  padding: 0 4px;
}
.column-menu {
  background: #fff;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  font-size: 12px;
}
.menu-title {
  font-weight: 600;
  margin: 0 0 4px;
}
.card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 8px;
}
.card {
  background: #fff;
  border-radius: 6px;
  padding: 8px 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.card:hover {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}
.card-title {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  font-size: 10px;
  color: #a3410c;
  background: #fdecdc;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
  flex-shrink: 0;
}
.hide-btn {
  background: none;
  border: none;
  color: #bbb;
  font-size: 11px;
  flex-shrink: 0;
  opacity: 0;
}
.card:hover .hide-btn {
  opacity: 1;
}
.hide-btn:hover {
  color: #d1344b;
}
.add-card-btn {
  width: 100%;
  background: none;
  border: 1px dashed #c5c8d1;
  border-radius: 6px;
  padding: 6px;
  font-size: 12px;
  color: #666;
  margin-top: 6px;
}
.add-card-btn:hover {
  background: #fff;
}
.new-card-form {
  background: #fff;
  border-radius: 6px;
  padding: 8px;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.new-card-form input,
.new-card-form textarea {
  padding: 5px 7px;
  border: 1px solid #d8dae0;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
}
.new-card-actions {
  display: flex;
  gap: 6px;
}
.new-card-actions button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 12px;
}
.new-card-actions button.secondary {
  background: #fff;
  color: #888;
  border: 1px solid #d8dae0;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
