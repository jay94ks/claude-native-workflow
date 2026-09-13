<script setup lang="ts">
import { ref } from "vue";
import PersonalKeysManager from "./PersonalKeysManager.vue";
import MyProjectKeysManager from "./MyProjectKeysManager.vue";

type TabKey = "personal" | "project";

const activeTab = ref<TabKey>("personal");
</script>

<template>
  <section class="card">
    <h2>API 키</h2>
    <nav class="tabs">
      <button type="button" :class="{ active: activeTab === 'personal' }" @click="activeTab = 'personal'">개인 키</button>
      <button type="button" :class="{ active: activeTab === 'project' }" @click="activeTab = 'project'">프로젝트 키</button>
    </nav>
    <PersonalKeysManager v-if="activeTab === 'personal'" />
    <MyProjectKeysManager v-else />
  </section>
</template>

<style scoped>
.card {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 16px;
  margin-bottom: 20px;
}
h2 {
  font-size: 14px;
  margin: 0 0 12px;
  color: var(--color-text-secondary);
}
.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.tabs button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-text);
}
.tabs button:hover {
  background: var(--color-surface-hover);
}
.tabs button.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
</style>
