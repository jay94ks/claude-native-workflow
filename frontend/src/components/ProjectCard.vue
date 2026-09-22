<template>
  <q-card clickable>
    <q-card-section>
      <div class="row items-center justify-between">
        <div class="text-h6">{{ name }}</div>
        <q-badge :color="visibility === 'PUBLIC' ? 'positive' : 'grey-7'">{{ visibility }}</q-badge>
      </div>
      <div v-if="description" class="text-caption q-mt-xs">{{ description }}</div>
      <CategoryPill v-if="myRole" color="primary" class="q-mt-sm">{{ myRole }}</CategoryPill>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import CategoryPill from "components/CategoryPill.vue";

// 컴포넌트 관례(CLAUDE.md "프론트엔드 컴포넌트 관례" 참고):
// props는 defineProps<{...}>(), 기본값은 withDefaults.
withDefaults(
  defineProps<{
    name: string;
    visibility?: "PUBLIC" | "PRIVATE";
    description?: string | null;
    myRole?: string | null;
  }>(),
  { visibility: "PRIVATE", description: null, myRole: null }
);
</script>
