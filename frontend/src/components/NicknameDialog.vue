<template>
  <q-dialog v-model="show" @show="load">
    <q-card style="width: 360px">
      <q-card-section class="text-h6">닉네임 변경</q-card-section>
      <q-card-section class="q-gutter-sm">
        <div class="text-caption" style="color: var(--gh-fg-muted)">지금 표시 라벨: {{ displayLabel }}</div>
        <q-input v-model="nickname" label="닉네임 (비우면 기본 라벨로 되돌아감)" dense />
      </q-card-section>
      <div v-if="error" class="text-negative text-caption q-px-md">{{ error }}</div>
      <div v-if="message" class="text-positive text-caption q-px-md">{{ message }}</div>
      <q-card-actions align="right">
        <q-btn flat label="닫기" v-close-popup />
        <q-btn color="primary" label="변경" :loading="saving" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";

const show = defineModel<boolean>({ required: true });
const emit = defineEmits<{ updated: [] }>();
const auth = useAuthStore();

const nickname = ref("");
const displayLabel = ref("");
const saving = ref(false);
const error = ref("");
const message = ref("");

async function load() {
  error.value = "";
  message.value = "";
  const result = await api.getMe(auth.apiKey!);
  if (result.ok) {
    const data = result.data as { nickname: string | null; displayLabel: string };
    nickname.value = data.nickname ?? "";
    displayLabel.value = data.displayLabel;
  }
}

async function submit() {
  saving.value = true;
  error.value = "";
  message.value = "";
  const result = await api.updateNickname(auth.apiKey!, { nickname: nickname.value.trim() || null });
  saving.value = false;
  if (!result.ok) {
    error.value = result.reason?.join(", ") ?? "변경에 실패했습니다.";
    return;
  }
  const data = result.data as { displayLabel: string };
  displayLabel.value = data.displayLabel;
  message.value = "닉네임을 변경했습니다.";
  emit("updated");
}
</script>
