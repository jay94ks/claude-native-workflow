<template>
  <q-layout>
    <q-page-container>
      <q-page class="flex flex-center">
        <q-card style="width: 360px">
          <q-card-section>
            <div class="text-h6">claude-native-workflow</div>
            <div class="text-caption">{{ mode === "login" ? "로그인" : "회원가입" }}</div>
          </q-card-section>

          <q-card-section>
            <q-form class="q-gutter-md" @submit.prevent="submit">
              <q-input v-model="username" label="username" autofocus />
              <q-input v-model="password" label="password" type="password" />
              <div v-if="error" class="text-negative text-caption">{{ error }}</div>
              <q-btn
                type="submit"
                color="primary"
                :loading="loading"
                class="full-width"
                :label="mode === 'login' ? '로그인' : '회원가입 + 로그인'"
              />
            </q-form>
          </q-card-section>

          <q-card-section class="text-center">
            <q-btn
              flat
              dense
              no-caps
              color="primary"
              :label="mode === 'login' ? '계정이 없나요? 회원가입' : '이미 계정이 있나요? 로그인'"
              @click="toggleMode"
            />
          </q-card-section>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import { ApiError } from "src/api/client";

const auth = useAuthStore();
const router = useRouter();

const mode = ref<"login" | "signup">("login");
const username = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");

function toggleMode() {
  mode.value = mode.value === "login" ? "signup" : "login";
  error.value = "";
}

async function submit() {
  loading.value = true;
  error.value = "";
  try {
    if (mode.value === "login") {
      await auth.login(username.value, password.value);
    } else {
      await auth.signup(username.value, password.value);
    }
    await router.push("/projects");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "로그인에 실패했습니다.";
  } finally {
    loading.value = false;
  }
}
</script>
