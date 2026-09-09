<script setup lang="ts">
import { ref } from "vue";
import { auth3 } from "../api3";

const emit = defineEmits<{ loggedIn: [tokens: { access_token: string; refresh_token: string }] }>();

const mode = ref<"login" | "register">("login");
const username = ref("");
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    if (mode.value === "register") {
      await auth3.register(username.value, email.value, password.value);
    }
    const tokens = await auth3.login(username.value, password.value);
    emit("loggedIn", tokens);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="row justify-center items-center" style="min-height: 100vh">
    <q-card style="width: 360px" class="q-pa-md">
      <q-card-section>
        <div class="text-h6">docs 대시보드 (Tier 3)</div>
        <div class="text-caption text-grey-7">{{ mode === "login" ? "로그인" : "회원가입" }}</div>
      </q-card-section>
      <q-card-section class="q-gutter-sm">
        <q-input v-model="username" dense outlined label="아이디 또는 이메일" @keyup.enter="submit" />
        <q-input v-if="mode === 'register'" v-model="email" dense outlined label="이메일" />
        <q-input v-model="password" dense outlined type="password" label="비밀번호" @keyup.enter="submit" />
        <div v-if="error" class="text-negative text-caption">{{ error }}</div>
      </q-card-section>
      <q-card-actions align="between">
        <q-btn flat dense :label="mode === 'login' ? '회원가입으로' : '로그인으로'" @click="mode = mode === 'login' ? 'register' : 'login'" />
        <q-btn color="primary" :label="mode === 'login' ? '로그인' : '가입 후 로그인'" :loading="busy" @click="submit" />
      </q-card-actions>
    </q-card>
  </div>
</template>
