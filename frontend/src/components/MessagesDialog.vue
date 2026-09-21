<template>
  <q-dialog v-model="model">
    <q-card style="width: 480px; max-width: 90vw">
      <q-card-section class="text-h6">Messages</q-card-section>

      <q-list separator style="max-height: 320px; overflow-y: auto">
        <q-item v-for="m in messages" :key="m.id">
          <q-item-section>
            <q-item-label caption>{{ m.from }} → {{ m.to }} · {{ new Date(m.createdAt).toLocaleString() }}</q-item-label>
            <q-item-label>{{ m.body }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="column items-end" style="gap: 4px">
              <q-badge :color="m.state === 'read' ? 'primary' : m.state === 'done' ? 'positive' : 'grey-6'">{{ m.state }}</q-badge>
              <q-btn v-if="m.state === 'read'" size="sm" dense flat label="완료 처리" @click="markDone(m)" />
            </div>
          </q-item-section>
        </q-item>
        <q-item v-if="!loading && messages.length === 0"><q-item-section class="text-caption">메시지가 없습니다.</q-item-section></q-item>
      </q-list>

      <q-separator />

      <q-card-section class="q-gutter-sm">
        <div class="text-subtitle2">클로드에게 메시지 보내기</div>
        <div class="row q-gutter-sm">
          <q-toggle v-model="urgent" label="긴급(emerg) - 즉시 브로드캐스트" />
        </div>
        <q-input v-model="body" label="내용" type="textarea" autogrow />
        <div v-if="sendError" class="text-negative text-caption">{{ sendError }}</div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="닫기" v-close-popup />
        <q-btn color="primary" label="보내기" :loading="sending" @click="send" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";

interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  state: string;
  createdAt: string;
}

const props = defineProps<{ owner: string; projectId: string }>();
const model = defineModel<boolean>({ default: false });

const auth = useAuthStore();
const messages = ref<Message[]>([]);
const loading = ref(false);
const body = ref("");
const urgent = ref(false);
const sending = ref(false);
const sendError = ref("");

async function load() {
  loading.value = true;
  const result = await api.listMessages(auth.apiKey!, props.owner, props.projectId);
  if (result.ok) messages.value = (result.data as { items: Message[] }).items;
  loading.value = false;
}

async function markDone(m: Message) {
  const result = await api.transitionMessage(auth.apiKey!, props.owner, props.projectId, m.id, "done");
  if (result.ok) await load();
}

async function send() {
  sending.value = true;
  sendError.value = "";
  const result = await api.sendMessage(auth.apiKey!, props.owner, props.projectId, {
    from: urgent.value ? "emerg" : "from-web",
    to: "agent",
    body: body.value,
  });
  sending.value = false;
  if (!result.ok) {
    sendError.value = result.reason?.join(", ") ?? "전송에 실패했습니다.";
    return;
  }
  body.value = "";
  urgent.value = false;
  await load();
}

watch(model, (open) => {
  if (open) load();
});
</script>
