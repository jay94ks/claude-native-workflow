<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type MessageEvent as RealtimeMessageEvent } from "../realtime";
import UserRef from "../components/UserRef.vue";
import TrackingCodeText from "../components/TrackingCodeText.vue";
import Pagination from "../components/Pagination.vue";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";

const props = defineProps<{ id: string }>();

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

function onRealtimeMessage(_event: RealtimeMessageEvent) {
  if (tab.value === "pending") load();
}

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.id, { onMessage: onRealtimeMessage });
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
      <UserRef v-if="m.authorId" :user-id="m.authorId" />
      <span v-else class="system">system</span>
      <span class="body"><TrackingCodeText :text="m.body" /></span>
      <span class="at">{{ new Date(m.createdAt).toLocaleString() }}</span>
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
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
}
.tabs button.active {
  background: #3454d1;
  color: #fff;
  border-color: #3454d1;
}
.messages {
  list-style: none;
  padding: 0;
  margin: 0 0 14px;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.messages li {
  padding: 10px 14px;
  border-bottom: 1px solid #eee;
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
  color: #888;
  flex-shrink: 0;
}
.body {
  flex: 1;
}
.at {
  color: #999;
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
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
.send-row button {
  background: #3454d1;
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
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
