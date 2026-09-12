<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type MessageEvent as RealtimeMessageEvent, type ChangeEvent } from "../realtime";
import { useAuthStore } from "../stores/auth";
import UserRef from "../components/UserRef.vue";
import TrackingCodeText from "../components/TrackingCodeText.vue";
import Pagination from "../components/Pagination.vue";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ id: string }>();
const auth = useAuthStore();

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canSend = computed(() => roleSatisfies(myRole.value, "editor"));

interface MessageItem {
  id: string;
  authorId: string | null;
  body: string;
  deliveredAt: string | null;
  createdAt: string;
}
interface MessagePage {
  items: MessageItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 20;
const tab = ref<"pending" | "delivered">("pending");
const messages = ref<MessageItem[]>([]);
const loading = ref(true);
const error = ref("");
const draft = ref("");
const sending = ref(false);
const page = ref(1);
const totalPages = ref(1);
const editingId = ref<string | null>(null);
const editDraft = ref("");

let disconnect: (() => void) | null = null;

async function load() {
  loading.value = true;
  error.value = "";
  try {
    // markDelivered는 안 보낸다 - 웹에서 보는 건 "AI가 읽음"으로 안 침.
    const qs = new URLSearchParams({ status: tab.value, page: String(page.value), pageSize: String(PAGE_SIZE) });
    const result = await apiCall<MessagePage>(`/projects/${props.id}/messages/page?${qs}`);
    messages.value = result.items;
    totalPages.value = result.totalPages;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "메시지를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function send() {
  if (!draft.value.trim()) return;
  sending.value = true;
  error.value = "";
  try {
    await apiCall(`/projects/${props.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: draft.value.trim() }),
    });
    draft.value = "";
    if (tab.value === "pending") await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "전송에 실패했습니다";
  } finally {
    sending.value = false;
  }
}

function canManage(m: MessageItem): boolean {
  return m.authorId !== null && (m.authorId === auth.me?.id || !!auth.me?.isSuperAdmin);
}

function startEdit(m: MessageItem) {
  editingId.value = m.id;
  editDraft.value = m.body;
  error.value = "";
}

async function saveEdit() {
  if (!editingId.value || !editDraft.value.trim()) return;
  error.value = "";
  try {
    await apiCall(`/messages/${editingId.value}`, { method: "PUT", body: JSON.stringify({ body: editDraft.value.trim() }) });
    editingId.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "수정에 실패했습니다";
  }
}

async function remove(m: MessageItem) {
  error.value = "";
  try {
    await apiCall(`/messages/${m.id}`, { method: "DELETE" });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
  }
}

function onRealtimeMessage(_event: RealtimeMessageEvent) {
  if (tab.value === "pending") load();
}

function onRealtimeChange(event: ChangeEvent) {
  if (event.entity === "message") load();
}

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.id, { onMessage: onRealtimeMessage, onChange: onRealtimeChange });
});
onUnmounted(() => disconnect?.());
watch(tab, () => {
  page.value = 1;
  load();
});
watch(page, load);
</script>

<template>
  <h1>메시지</h1>
  <div class="tabs">
    <button :class="{ active: tab === 'pending' }" @click="tab = 'pending'">대기</button>
    <button :class="{ active: tab === 'delivered' }" @click="tab = 'delivered'">기록</button>
  </div>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="loading" class="muted">불러오는 중...</p>
  <ul v-else class="messages">
    <li v-for="m in messages" :key="m.id">
      <template v-if="editingId === m.id">
        <input v-model="editDraft" type="text" class="edit-input" @keyup.enter="saveEdit" />
        <button class="manage-btn" @click="saveEdit">저장</button>
        <button class="manage-btn" @click="editingId = null">취소</button>
      </template>
      <template v-else>
        <UserRef v-if="m.authorId" :user-id="m.authorId" />
        <span v-else class="system">system</span>
        <span class="body"><TrackingCodeText :text="m.body" /></span>
        <span class="at">{{ new Date(m.createdAt).toLocaleString() }}</span>
        <template v-if="canManage(m)">
          <button class="manage-btn" @click="startEdit(m)">수정</button>
          <button class="manage-btn danger" @click="remove(m)">삭제</button>
        </template>
      </template>
    </li>
    <li v-if="messages.length === 0" class="muted">{{ tab === "pending" ? "대기 중인 메시지가 없습니다." : "기록된 메시지가 없습니다." }}</li>
  </ul>
  <Pagination :page="page" :total-pages="totalPages" @update:page="page = $event" />
  <form v-if="canSend" class="send-row" @submit.prevent="send">
    <input v-model="draft" type="text" placeholder="메시지 입력..." />
    <button type="submit" :disabled="sending">전송</button>
  </form>
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 12px;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}
.tabs button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.tabs button.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.messages {
  list-style: none;
  padding: 0;
  margin: 0 0 14px;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.messages li {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 13px;
}
.messages li:last-child {
  border-bottom: none;
}
.system {
  font-weight: 600;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.body {
  flex: 1;
}
.edit-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.manage-btn {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  flex-shrink: 0;
}
.manage-btn.danger {
  color: var(--color-danger);
}
.at {
  color: var(--color-text-faint);
  font-size: 11px;
  flex-shrink: 0;
}
.send-row {
  display: flex;
  gap: 8px;
}
.send-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.send-row button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.send-row button:disabled {
  opacity: 0.6;
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
