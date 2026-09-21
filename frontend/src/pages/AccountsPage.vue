<template>
  <q-page class="q-pa-md" style="max-width: 720px">
    <div class="text-h5 q-mb-md">계정 관리</div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <div v-else-if="forbidden" class="text-negative text-caption">
      최고 관리자만 이 화면을 볼 수 있습니다.
    </div>
    <template v-else>
      <q-list bordered separator>
        <q-item v-for="acc in accounts" :key="acc.id">
          <q-item-section>
            <q-item-label>
              {{ acc.username }}
              <q-badge v-if="acc.disabledAt" color="grey-6" class="q-ml-sm">비활성화됨</q-badge>
              <q-badge v-if="acc.username === 'admin'" color="primary" class="q-ml-sm">최고 관리자</q-badge>
            </q-item-label>
            <q-item-label caption>{{ acc.id }} · 가입 {{ new Date(acc.createdAt).toLocaleString() }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <!-- 최고 관리자(부트스트랩 admin) 자신은 백엔드가 어차피 거절하니
                 (accounts.ts) 헷갈리지 않게 비활성화/삭제 버튼 자체를 숨긴다 -
                 비밀번호 재설정만 계속 허용(잊어버렸을 때 대비). -->
            <div class="row q-gutter-sm">
              <q-btn dense flat label="비밀번호 재설정" @click="resetPassword(acc)" />
              <template v-if="acc.username !== 'admin'">
                <q-btn v-if="!acc.disabledAt" dense flat color="warning" label="비활성화" @click="disable(acc)" />
                <q-btn v-else dense flat color="positive" label="활성화" @click="enable(acc)" />
                <q-btn dense flat color="negative" label="삭제" @click="confirmDelete(acc)" />
              </template>
            </div>
          </q-item-section>
        </q-item>
        <q-item v-if="accounts.length === 0"><q-item-section class="text-caption">계정이 없습니다.</q-item-section></q-item>
      </q-list>
      <div v-if="actionError" class="text-negative text-caption q-mt-sm">{{ actionError }}</div>
    </template>

    <!-- 새 임시 비밀번호는 이 배너에만 1회 노출된다(재조회 불가 - webhook secret과 동일한 원칙). -->
    <q-banner v-if="resetResult" class="bg-warning text-white q-mt-md">
      {{ resetResult.username }}의 새 임시 비밀번호(다시 볼 수 없으니 지금 전달하세요):
      <div class="text-weight-bold">{{ resetResult.temporaryPassword }}</div>
    </q-banner>

    <q-dialog v-model="showDeleteConfirm">
      <q-card style="width: 420px">
        <q-card-section class="text-h6 text-negative">계정을 삭제하시겠습니까?</q-card-section>
        <q-card-section>
          "{{ deleteTarget?.username }}" 계정을 되돌릴 수 없이 삭제합니다. 계속하려면 사용자명을 입력하세요.
        </q-card-section>
        <q-card-section>
          <q-input v-model="deleteConfirmText" :label="`사용자명 (${deleteTarget?.username}) 입력`" />
        </q-card-section>
        <div v-if="deleteError" class="text-negative text-caption q-px-md">{{ deleteError }}</div>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn
            color="negative"
            label="영구 삭제"
            :disable="deleteConfirmText !== deleteTarget?.username"
            :loading="deleting"
            @click="doDelete"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";

interface AccountSummary {
  id: string;
  username: string;
  disabledAt: string | null;
  createdAt: string;
}

const auth = useAuthStore();

const loading = ref(true);
const forbidden = ref(false);
const accounts = ref<AccountSummary[]>([]);
const actionError = ref("");
const resetResult = ref<{ username: string; temporaryPassword: string } | null>(null);

async function load() {
  loading.value = true;
  forbidden.value = false;
  const result = await api.listAccounts(auth.apiKey!);
  loading.value = false;
  if (!result.ok) {
    forbidden.value = true;
    return;
  }
  accounts.value = (result.data as { items: AccountSummary[] }).items;
}

async function resetPassword(acc: AccountSummary) {
  actionError.value = "";
  resetResult.value = null;
  const result = await api.resetAccountPassword(auth.apiKey!, acc.id);
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "재설정에 실패했습니다.";
    return;
  }
  resetResult.value = result.data as { username: string; temporaryPassword: string };
}

async function disable(acc: AccountSummary) {
  actionError.value = "";
  const result = await api.disableAccount(auth.apiKey!, acc.id);
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "비활성화에 실패했습니다.";
    return;
  }
  await load();
}

async function enable(acc: AccountSummary) {
  actionError.value = "";
  const result = await api.enableAccount(auth.apiKey!, acc.id);
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "활성화에 실패했습니다.";
    return;
  }
  await load();
}

const showDeleteConfirm = ref(false);
const deleteTarget = ref<AccountSummary | null>(null);
const deleteConfirmText = ref("");
const deleting = ref(false);
const deleteError = ref("");

function confirmDelete(acc: AccountSummary) {
  deleteTarget.value = acc;
  deleteConfirmText.value = "";
  deleteError.value = "";
  showDeleteConfirm.value = true;
}

async function doDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  deleteError.value = "";
  const result = await api.deleteAccount(auth.apiKey!, deleteTarget.value.id);
  deleting.value = false;
  if (!result.ok) {
    deleteError.value = result.reason?.join(", ") ?? "삭제에 실패했습니다.";
    return;
  }
  showDeleteConfirm.value = false;
  await load();
}

onMounted(load);
</script>
