<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { ApiError } from "../api/client";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    const redirect = (route.query.redirect as string) || "/projects";
    router.push(redirect);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "로그인에 실패했습니다";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="center">
    <form class="card" @submit.prevent="handleSubmit">
      <h1>claude-native-workflow</h1>
      <label>
        아이디 또는 이메일
        <input v-model="username" type="text" required autofocus />
      </label>
      <label>
        비밀번호
        <input v-model="password" type="password" required />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">{{ loading ? "로그인 중..." : "로그인" }}</button>
      <router-link to="/register" class="link">계정이 없으신가요? 회원가입</router-link>
    </form>
  </div>
</template>

<style scoped>
.center {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  background: #fff;
  padding: 32px;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
h1 {
  font-size: 17px;
  margin: 0 0 6px;
  text-align: center;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #555;
}
input {
  padding: 9px 10px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
}
button {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 10px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
}
button:disabled {
  opacity: 0.6;
}
.error {
  color: #d1344b;
  font-size: 13px;
  margin: 0;
}
.link {
  text-align: center;
  font-size: 13px;
}
</style>
