<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useSearchScopeStore } from "../stores/searchScope";

const store = useSearchScopeStore();
const router = useRouter();

const scope = ref<"project" | "group" | "team">("project");
const includeSource = ref(false);

watch(
  () => store.open,
  (open) => {
    if (!open) return;
    scope.value = "project";
    includeSource.value = false;
  },
);

function run() {
  if (!store.projectId) return;
  router.push({
    name: "project-search",
    params: { id: store.projectId },
    query: { q: store.keyword, scope: scope.value, includeSource: String(includeSource.value) },
  });
  store.close();
}
</script>

<template>
  <div v-if="store.open" class="overlay" @click.self="store.close()">
    <div class="dialog">
      <div class="header">
        <h2>"{{ store.keyword }}" 검색</h2>
        <button class="close-btn" @click="store.close()">닫기 ✕</button>
      </div>
      <div class="scope-options">
        <label><input v-model="scope" type="radio" value="project" /> 프로젝트 내에서 검색</label>
        <label><input v-model="scope" type="radio" value="group" /> 프로젝트 그룹 내에 속한 프로젝트에서 검색</label>
        <label><input v-model="scope" type="radio" value="team" /> 팀 내에 속한 프로젝트 그룹 혹은 프로젝트에서 검색</label>
      </div>
      <label class="source-toggle"><input v-model="includeSource" type="checkbox" /> 소스코드 포함</label>
      <div class="actions">
        <button type="button" class="cancel" @click="store.close()">취소</button>
        <button type="button" class="run" @click="run()">검색 실행</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.dialog {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  width: min(440px, 90vw);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.header h2 {
  font-size: 15px;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  flex-shrink: 0;
}
.scope-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.scope-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.source-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 18px;
  padding-top: 10px;
  border-top: 1px solid #eee;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.actions .cancel {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 8px 16px;
  border-radius: 6px;
}
.actions .run {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
</style>
