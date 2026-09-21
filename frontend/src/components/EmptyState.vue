<template>
  <q-item v-if="as === 'item'">
    <q-item-section class="text-caption" style="color: var(--gh-fg-muted)">
      <q-icon v-if="icon" :name="icon" size="16px" class="q-mr-xs" />{{ message }}
    </q-item-section>
  </q-item>
  <div v-else class="text-caption" style="color: var(--gh-fg-muted)">
    <q-icon v-if="icon" :name="icon" size="16px" class="q-mr-xs" />{{ message }}
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    message: string;
    icon?: string;
    as?: "div" | "item";
  }>(),
  { as: "div" }
);
</script>
