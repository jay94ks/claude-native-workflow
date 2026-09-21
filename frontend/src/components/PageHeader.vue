<template>
  <div v-if="variant === 'page'" class="row items-center justify-between q-mb-md">
    <div class="text-h5">{{ title }}</div>
    <div class="q-gutter-sm"><slot name="actions" /></div>
  </div>

  <div v-else-if="variant === 'section'" class="row items-center justify-between q-mb-sm">
    <div class="text-subtitle1">{{ title }}{{ count !== undefined ? ` (${count})` : "" }}</div>
    <div class="q-gutter-sm"><slot name="actions" /></div>
  </div>

  <div v-else-if="variant === 'detail'" class="row items-center q-gutter-sm q-mb-md">
    <q-btn flat dense round icon="arrow_back" :to="backTo" @click="onBack" />
    <div class="text-h6">{{ title }}</div>
  </div>

  <template v-else-if="variant === 'settings'">
    <div class="text-subtitle1 q-mb-sm">{{ title }}</div>
    <div v-if="caption" class="text-caption q-mb-md">{{ caption }}</div>
  </template>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";

withDefaults(
  defineProps<{
    variant: "page" | "section" | "detail" | "settings";
    title: string;
    count?: number;
    caption?: string;
    backTo?: RouteLocationRaw;
    onBack?: () => void;
  }>(),
  {}
);
</script>
