<script setup lang="ts">
import { ref } from "vue";
import { useSearchScopeStore } from "../stores/searchScope";

const props = defineProps<{ projectId: string }>();
const searchScope = useSearchScopeStore();
const keyword = ref("");

function submit() {
  searchScope.openWith(keyword.value, props.projectId);
}
</script>

<template>
  <form class="search-box" @submit.prevent="submit">
    <input v-model="keyword" type="text" placeholder="검색어..." />
    <button type="submit">검색</button>
  </form>
</template>

<style scoped>
.search-box {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}
.search-box input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #454668;
  background: #24253f;
  color: #fff;
  font-size: 12px;
}
.search-box input::placeholder {
  color: #8688a8;
}
.search-box button {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  background: #3454d1;
  color: #fff;
  flex-shrink: 0;
}
</style>
