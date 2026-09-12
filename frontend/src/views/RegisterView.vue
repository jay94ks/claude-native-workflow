<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { ApiError } from "../api/client";

const router = useRouter();
const auth = useAuthStore();

const username = ref("");
const email = ref("");
const password = ref("");
const error = ref("");
const done = ref(false);
const loading = ref(false);

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await auth.register(username.value, password.value, email.value || undefined);
    done.value = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "가입에 실패했습니다";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="center">
    <div v-if="done" class="card">
      <h1>가입 완료</h1>
      <p>이제 로그인할 수 있습니다.</p>
      <button @click="router.push('/login')">로그인하러 가기</button>
    </div>
    <form v-else class="card" @submit.prevent="handleSubmit">
      <h1>계정 만들기</h1>
      <label>
        아이디
        <input v-model="username" type="text" required autofocus />
      </label>
      <label>
        이메일(선택)
        <input v-model="email" type="email" />
      </label>
      <label>
        비밀번호
        <input v-model="password" type="password" required />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">{{ loading ? "처리 중..." : "가입하기" }}</button>
      <router-link to="/login" class="link">이미 계정이 있으신가요? 로그인</router-link>
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
  background: var(--color-surface);
  padding: 32px;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: center;
}
h1 {
  font-size: 17px;
  margin: 0 0 6px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  text-align: left;
}
input {
  padding: 9px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
button {
  background: var(--color-primary);
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
  color: var(--color-danger);
  font-size: 13px;
  margin: 0;
}
.link {
  text-align: center;
  font-size: 13px;
}
</style>
