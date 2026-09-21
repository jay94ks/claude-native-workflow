<template>
  <q-dialog v-model="show">
    <q-card style="width: var(--gh-dialog-width-sm)">
      <q-card-section class="text-h6">비밀번호 변경</q-card-section>
      <q-card-section class="q-gutter-sm">
        <q-input v-model="currentPassword" type="password" label="현재 비밀번호" dense />
        <q-input v-model="newPassword" type="password" label="새 비밀번호 (8자 이상)" dense />
      </q-card-section>
      <div v-if="error" class="text-negative text-caption q-px-md">{{ error }}</div>
      <div v-if="message" class="text-positive text-caption q-px-md">{{ message }}</div>
      <q-card-actions align="right">
        <q-btn flat label="취소" v-close-popup />
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
const auth = useAuthStore();

const currentPassword = ref("");
const newPassword = ref("");
const saving = ref(false);
const error = ref("");
const message = ref("");

async function submit() {
  saving.value = true;
  error.value = "";
  message.value = "";
  const result = await api.changeOwnPassword(auth.apiKey!, {
    currentPassword: currentPassword.value,
    newPassword: newPassword.value,
  });
  saving.value = false;
  if (!result.ok) {
    error.value = result.reason?.join(", ") ?? "변경에 실패했습니다.";
    return;
  }
  currentPassword.value = "";
  newPassword.value = "";
  message.value = "비밀번호를 변경했습니다.";
}
</script>
