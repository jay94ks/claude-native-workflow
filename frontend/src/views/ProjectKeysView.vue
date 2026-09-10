<script setup lang="ts">
import ProjectKeysManager from "../components/ProjectKeysManager.vue";
import { useAuthStore } from "../stores/auth";

defineProps<{ id: string }>();
const auth = useAuthStore();
</script>

<template>
  <h1>키 관리</h1>
  <p class="hint">
    팀 소속 모든 프로젝트에 접근하는 "팀 관리 키"는 팀 화면(팀장 전용)에서, 모든 프로젝트에 접근하는 "개인 키"는
    <router-link v-if="auth.me" :to="`/users/${auth.me.id}`">내 정보</router-link><span v-else>내 정보</span> 화면에서 관리한다.
  </p>
  <ProjectKeysManager :project-id="id" />
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 8px;
}
.hint {
  font-size: 12px;
  color: #888;
  margin: 0 0 16px;
}
</style>
