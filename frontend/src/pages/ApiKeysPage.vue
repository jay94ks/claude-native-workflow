<template>
  <q-page class="q-pa-md" style="max-width: var(--gh-page-width-narrow)">
    <PageHeader variant="page" title="API 키 관리" />
    <div class="text-caption q-mb-md" style="color: var(--gh-fg-muted)">
      personal 키는 로그인과 동등하게 어디서든 쓸 수 있고, project 키는 그 프로젝트 안에서만 유효합니다 - 유출돼도 다른 프로젝트로는 새어나가지 않습니다.
    </div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <q-list v-else bordered separator class="q-mb-md">
      <q-item v-for="key in keys" :key="key.id">
        <q-item-section>
          <q-item-label>
            {{ key.label || (key.scope === "personal" ? "personal" : `project: ${key.projectOwnerUsername}/${key.projectSlug}`) }}
            <q-badge :color="key.status === 'active' ? 'positive' : key.status === 'revoked' ? 'grey-6' : 'warning'" class="q-ml-sm">{{ key.status }}</q-badge>
          </q-item-label>
          <q-item-label caption>
            {{ key.keyPrefix }}… · {{ key.scope }} · 발급 {{ new Date(key.createdAt).toLocaleString() }}
            <template v-if="key.lastUsedAt"> · 마지막 사용 {{ new Date(key.lastUsedAt).toLocaleString() }}</template>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn v-if="key.status === 'active'" dense flat color="negative" label="배제" @click="revoke(key.id)" />
        </q-item-section>
      </q-item>
      <EmptyState v-if="keys.length === 0" as="item" message="발급된 키가 없습니다." />
    </q-list>

    <q-card flat bordered class="q-pa-md">
      <div class="text-subtitle2 q-mb-sm">새 키 발급</div>
      <q-form class="q-gutter-sm row items-center" @submit.prevent="create">
        <q-select v-model="newScope" :options="['personal', 'project']" label="scope" dense style="width: 140px" />
        <q-select
          v-if="newScope === 'project'"
          v-model="newProject"
          :options="projectOptions"
          option-label="label"
          label="프로젝트"
          dense
          style="width: 260px"
        />
        <q-input v-model="newLabel" label="label (선택)" dense style="width: 200px" />
        <q-btn type="submit" color="primary" label="발급" :loading="creating" />
      </q-form>
      <div v-if="createError" class="text-negative text-caption q-mt-sm">{{ createError }}</div>
    </q-card>

    <!-- 새 secret은 이 배너에만 1회 노출된다(재조회 불가). -->
    <q-banner v-if="newSecret" class="bg-warning text-white q-mt-md">
      새 API 키(다시 볼 수 없으니 지금 복사해두세요):
      <div class="text-weight-bold" style="word-break: break-all">{{ newSecret }}</div>
    </q-banner>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";
import EmptyState from "components/EmptyState.vue";
import PageHeader from "components/PageHeader.vue";

interface ApiKeySummary {
  id: string;
  scope: string;
  projectId: string | null;
  projectOwnerUsername: string | null;
  projectSlug: string | null;
  label: string | null;
  keyPrefix: string;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ProjectOption {
  label: string;
  owner: string;
  projectId: string;
}

const auth = useAuthStore();

const loading = ref(true);
const keys = ref<ApiKeySummary[]>([]);
const projectOptions = ref<ProjectOption[]>([]);

async function load() {
  loading.value = true;
  const result = await api.listMyApiKeys(auth.apiKey!);
  loading.value = false;
  if (result.ok) keys.value = (result.data as { items: ApiKeySummary[] }).items;
}

async function loadProjectOptions() {
  const result = await api.listProjects(auth.apiKey!);
  if (!result.ok) return;
  const items = (result.data as { items: { id: string; ownerUsername: string; name: string }[] }).items;
  projectOptions.value = items.map((p) => ({ label: `${p.ownerUsername}/${p.id} (${p.name})`, owner: p.ownerUsername, projectId: p.id }));
}

const newScope = ref<"personal" | "project">("personal");
const newProject = ref<ProjectOption | null>(null);
const newLabel = ref("");
const creating = ref(false);
const createError = ref("");
const newSecret = ref("");

async function create() {
  creating.value = true;
  createError.value = "";
  newSecret.value = "";
  if (newScope.value === "project" && !newProject.value) {
    creating.value = false;
    createError.value = "프로젝트를 선택하세요.";
    return;
  }
  const result = await api.createApiKey(auth.apiKey!, {
    scope: newScope.value,
    owner: newScope.value === "project" ? newProject.value!.owner : undefined,
    projectId: newScope.value === "project" ? newProject.value!.projectId : undefined,
    label: newLabel.value || undefined,
  });
  creating.value = false;
  if (!result.ok) {
    createError.value = result.reason?.join(", ") ?? "발급에 실패했습니다.";
    return;
  }
  const data = result.data as { secret: string };
  newSecret.value = data.secret;
  newLabel.value = "";
  await load();
}

async function revoke(keyId: string) {
  const result = await api.revokeApiKey(auth.apiKey!, keyId);
  if (result.ok) await load();
}

onMounted(() => {
  load();
  loadProjectOptions();
});
</script>
