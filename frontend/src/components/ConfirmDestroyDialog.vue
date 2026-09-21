<template>
  <q-dialog v-model="show" @show="confirmText = ''">
    <q-card style="width: var(--gh-dialog-width-md)">
      <q-card-section class="text-h6 text-negative">{{ title }}</q-card-section>
      <q-card-section>{{ bodyText }}</q-card-section>
      <q-card-section>
        <q-input v-model="confirmText" :label="confirmLabel" />
      </q-card-section>
      <div v-if="error" class="text-negative text-caption q-px-md">{{ error }}</div>
      <q-card-actions align="right">
        <q-btn flat label="취소" v-close-popup />
        <q-btn color="negative" :label="actionLabel" :disable="confirmText !== confirmValue" :loading="loading" @click="emit('confirm')" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";

const show = defineModel<boolean>({ required: true });
withDefaults(
  defineProps<{
    title: string;
    bodyText: string;
    confirmValue: string;
    confirmLabel: string;
    actionLabel?: string;
    loading?: boolean;
    error?: string;
  }>(),
  { actionLabel: "영구 삭제" }
);
const emit = defineEmits<{ confirm: [] }>();

const confirmText = ref("");
</script>
