<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type MessageEvent as RealtimeMessageEvent } from "../realtime";

const props = defineProps<{ projectId: string }>();

interface MessageItem {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

const messages = ref<MessageItem[]>([]);
const loading = ref(true);
const error = ref("");
const draft = ref("");
const sending = ref(false);

let disconnect: (() => void) | null = null;

function appendIfNew(msg: MessageItem) {
  if (messages.value.some((m) => m.id === msg.id)) return;
  messages.value = [...messages.value, msg];
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    messages.value = await apiCall<MessageItem[]>(`/projects/${props.projectId}/messages`);
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
    const msg = await apiCall<MessageItem>(`/projects/${props.projectId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: draft.value.trim() }),
    });
    appendIfNew(msg);
    draft.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "전송에 실패했습니다";
  } finally {
    sending.value = false;
  }
}

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.projectId, {
    onMessage: (event: RealtimeMessageEvent) => appendIfNew(event),
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <section class="panel">
    <h2>메시지</h2>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <ul v-else class="messages">
      <li v-for="m in messages" :key="m.id">
        <span class="author">{{ m.authorId ?? "system" }}</span>
        <span class="body">{{ m.body }}</span>
        <span class="at">{{ new Date(m.createdAt).toLocaleString() }}</span>
      </li>
      <li v-if="messages.length === 0" class="muted">아직 메시지가 없습니다.</li>
    </ul>
    <form class="send-row" @submit.prevent="send">
      <input v-model="draft" type="text" placeholder="메시지 입력..." />
      <button type="submit" :disabled="sending">전송</button>
    </form>
  </section>
</template>

<style scoped>
.panel {
  margin-bottom: 28px;
}
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
.messages {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  max-height: 260px;
  overflow-y: auto;
}
.messages li {
  padding: 8px 14px;
  border-bottom: 1px solid #eee;
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 13px;
}
.messages li:last-child {
  border-bottom: none;
}
.author {
  font-weight: 600;
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
