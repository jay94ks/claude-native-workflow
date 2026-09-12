<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import draggable from "vuedraggable";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";
import { useEntityPickerStore } from "../stores/entityPicker";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ id: string }>();
const kanbanDialog = useKanbanCardDialogStore();
const entityPicker = useEntityPickerStore();

// 분류/카드 생성, 카드 숨김/이동은 editor 이상(백엔드 requireProjectRole
// ("editor")/roleSatisfies(role,"editor")와 동일한 기준) - 분류 숨김
// 토글·순서 변경은 개인 취향/뷰어 허용 구간이라 그대로 둔다.
const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canEdit = computed(() => roleSatisfies(myRole.value, "editor"));

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

// vuedraggable은 v-model로 직접 mutate할 수 있는 배열이 필요하므로,
// columns/cards 원본에서 매번 새로 필터링해 만드는 지역 반응형
// 배열이다(load() 성공 시에만 재구성 - hiddenColumns/hiddenCardsFor는
// 드래그 대상이 아니라 원본을 그대로 읽는다).
const orderedColumns = ref<KanbanColumnView[]>([]);
const cardsByColumn = ref<Record<string, KanbanCardSummary[]>>({});

function rebuildLocalOrder() {
  orderedColumns.value = columns.value.filter((c) => !c.hidden);
  const map: Record<string, KanbanCardSummary[]> = {};
  for (const col of columns.value) {
    map[col.id] = cards.value.filter((c) => c.columnId === col.id && !c.hidden).sort((a, b) => a.order - b.order);
  }
  cardsByColumn.value = map;
}

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
    rebuildLocalOrder();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "칸반 보드를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

const hiddenColumns = computed(() => columns.value.filter((c) => c.hidden));

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

async function onColumnsChanged() {
  try {
    await apiCall(`/projects/${props.id}/kanban/columns/order`, {
      method: "PUT",
      body: JSON.stringify({ columnIds: orderedColumns.value.map((c) => c.id) }),
    });
  } catch (err) {
    columnError.value = err instanceof ApiError ? err.message : "순서 변경에 실패했습니다";
  } finally {
    await load(); // 성공/실패 모두 서버 상태로 재동기화(낙관적 이동 되돌리기 포함)
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
const newCardRefs = ref<string[]>([]);
const cardError = ref("");

function openCardForm(columnId: string) {
  newCardColumnId.value = columnId;
  newCardTitle.value = "";
  newCardBody.value = "";
  newCardRefs.value = [];
  cardError.value = "";
}

async function pickCardRefs() {
  const result = await entityPicker.pick({
    kind: "document",
    projectId: props.id,
    multi: true,
    allowManualEntry: false,
    initialSelected: newCardRefs.value,
  });
  if (result) newCardRefs.value = result;
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
        refs: newCardRefs.value,
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

interface DraggableChangeEvent {
  added?: { element: KanbanCardSummary; newIndex: number };
  moved?: { newIndex: number };
}

async function onCardsChanged(columnId: string, event: DraggableChangeEvent) {
  if (!event.added && !event.moved) return; // "removed"는 반대편 목록의 added가 이미 처리함(이중 호출 방지)
  const code = event.added?.element.trackingCode ?? cardsByColumn.value[columnId]?.[event.moved!.newIndex]?.trackingCode;
  const toIndex = event.added?.newIndex ?? event.moved!.newIndex;
  if (!code) return;
  try {
    await apiCall(`/kanban/cards/${code}/move`, {
      method: "PUT",
      body: JSON.stringify({ toColumnId: columnId, toIndex }),
    });
  } catch (err) {
    cardError.value = err instanceof ApiError ? err.message : "카드 이동에 실패했습니다";
  } finally {
    await load();
  }
}

function openCard(trackingCode: string) {
  kanbanDialog.show(trackingCode);
}

// ---------------------------------------------------------- 빈 영역 드래그 스크롤
// 컬럼/카드가 아닌 빈 배경을 드래그하면 좌우로 팬 스크롤한다(마우스로
// 컬럼이 적어 여백이 넓거나, 터치가 아닌 트랙패드/마우스 환경에서
// 가로 스크롤 조작이 불편한 경우를 위함) - vuedraggable이 처리하는
// 컬럼/카드 자체의 드래그와 겹치지 않도록 e.target이 배경 자신일 때만
// 반응한다(자식 요소에서 시작된 이벤트는 버블링돼 도달해도 무시).
const boardScrollEl = ref<HTMLElement | null>(null);
let panPointerId: number | null = null;
let panStartX = 0;
let panScrollStart = 0;

function onBoardPointerDown(e: PointerEvent) {
  // 터치는 브라우저의 기본 overflow-x:auto 스크롤이 이미 처리하므로,
  // 이 팬 스크롤은 마우스(트랙패드 포함)에서만 켠다 - 터치에서까지
  // 켜면 SortableJS의 delay-on-touch-only 드래그 판정과 겹칠 수 있다.
  if (e.pointerType !== "mouse" || e.target !== boardScrollEl.value || !boardScrollEl.value) return;
  panPointerId = e.pointerId;
  panStartX = e.clientX;
  panScrollStart = boardScrollEl.value.scrollLeft;
  boardScrollEl.value.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function onBoardPointerMove(e: PointerEvent) {
  if (panPointerId === null || e.pointerId !== panPointerId || !boardScrollEl.value) return;
  boardScrollEl.value.scrollLeft = panScrollStart - (e.clientX - panStartX);
}
function onBoardPointerUp(e: PointerEvent) {
  if (e.pointerId !== panPointerId) return;
  panPointerId = null;
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
  <div class="kanban-view">
  <div class="board-toolbar">
    <button v-if="canEdit" @click="showNewColumnForm = !showNewColumnForm">+ 새 분류</button>
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

  <div
    v-else
    ref="boardScrollEl"
    class="board"
    @pointerdown="onBoardPointerDown"
    @pointermove="onBoardPointerMove"
    @pointerup="onBoardPointerUp"
    @pointercancel="onBoardPointerUp"
  >
    <draggable
      v-model="orderedColumns"
      item-key="id"
      tag="div"
      class="board-columns"
      group="kanban-columns"
      handle=".column-header"
      :animation="150"
      :force-fallback="true"
      ghost-class="drag-ghost"
      @change="onColumnsChanged"
    >
      <template #item="{ element: col }">
        <div class="column">
          <div class="column-header">
            <span class="column-name">{{ col.name }}</span>
            <span class="column-count">{{ cardsByColumn[col.id]?.length ?? 0 }}</span>
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

          <draggable
            v-model="cardsByColumn[col.id]"
            item-key="trackingCode"
            tag="div"
            class="card-list"
            group="kanban-cards"
            :disabled="!canEdit"
            :animation="150"
            :force-fallback="true"
            ghost-class="drag-ghost"
            :delay="150"
            :delay-on-touch-only="true"
            :scroll="true"
            filter="button"
            @change="onCardsChanged(col.id, $event)"
          >
            <template #item="{ element: c }">
              <div class="card" @click="openCard(c.trackingCode)">
                <span v-if="c.origin === 'designer'" class="badge">필수</span>
                <span class="card-title">{{ c.title }}</span>
                <button v-if="canEdit" class="hide-btn" title="숨기기" @click.stop="setCardHidden(c.trackingCode, true)">숨김</button>
              </div>
            </template>
          </draggable>

          <button v-if="canEdit" class="add-card-btn" @click="openCardForm(col.id)">+ 카드</button>
          <form v-if="newCardColumnId === col.id" class="new-card-form" @submit.prevent="createCard">
            <input v-model="newCardTitle" type="text" placeholder="카드 제목" />
            <textarea v-model="newCardBody" rows="2" placeholder="설명(선택)"></textarea>
            <button type="button" class="pick-refs-btn" @click="pickCardRefs">근거 문서 ({{ newCardRefs.length }})</button>
            <div class="new-card-actions">
              <button type="submit">추가</button>
              <button type="button" class="secondary" @click="newCardColumnId = null">취소</button>
            </div>
          </form>
        </div>
      </template>
    </draggable>
  </div>
  </div>
</template>

<style scoped>
.kanban-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.board-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.board-toolbar button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
}
.board-toolbar button.secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}
.new-column-form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.new-column-form input {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.hidden-panel {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px 14px;
  margin-bottom: 12px;
  flex-shrink: 0;
  max-height: 40%;
  overflow-y: auto;
}
.hidden-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}
.hidden-row button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
}
.board {
  overflow-x: auto;
  padding-bottom: 8px;
  flex: 1;
  min-height: 0;
  /* 빈 배경을 드래그해서 좌우로 스크롤하는 팬 제스처를 지원 -
     user-select:none은 컬럼/카드까지 상속돼(드래그 중 텍스트가
     같이 선택되는 문제도 함께 막는다), input/textarea는 아래에서
     별도로 복원한다. */
  user-select: none;
  cursor: grab;
}
.board-columns {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.column {
  flex: 0 0 260px;
  background: var(--color-surface-hover);
  border-radius: 8px;
  padding: 10px;
  min-height: 120px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
}
.column-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: grab;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.column-name {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
}
.column-count {
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-surface);
  padding: 1px 7px;
  border-radius: 999px;
}
.menu-btn {
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: 14px;
  padding: 0 4px;
}
.column-menu {
  background: var(--color-surface);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  font-size: 12px;
  flex-shrink: 0;
  overflow-y: auto;
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
  flex: 1;
  overflow-y: auto;
}
.card {
  background: var(--color-surface);
  color: var(--color-text);
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
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
  flex-shrink: 0;
}
.hide-btn {
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: 11px;
  flex-shrink: 0;
  opacity: 0;
}
.card:hover .hide-btn {
  opacity: 1;
}
.hide-btn:hover {
  color: var(--color-danger);
}
.add-card-btn {
  width: 100%;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  padding: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 6px;
  flex-shrink: 0;
}
.add-card-btn:hover {
  background: var(--color-surface);
}
.new-card-form {
  background: var(--color-surface);
  border-radius: 6px;
  padding: 8px;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.new-card-form input,
.new-card-form textarea {
  padding: 5px 7px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-text);
  user-select: text;
}
.pick-refs-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 5px 7px;
  font-size: 12px;
  text-align: left;
}
.new-card-actions {
  display: flex;
  gap: 6px;
}
.new-card-actions button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 12px;
}
.new-card-actions button.secondary {
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}
.drag-ghost {
  opacity: 0.4;
  background: var(--color-surface-hover);
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
