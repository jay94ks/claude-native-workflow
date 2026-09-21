<template>
  <div style="max-width: 640px">
    <div class="text-subtitle1 q-mb-sm">프로젝트 설정</div>
    <q-form class="q-gutter-md" @submit.prevent="save">
      <q-input v-model="name" label="이름" :readonly="!project.isAdmin" />
      <q-input v-model="description" label="설명" :readonly="!project.isAdmin" />
      <q-input v-model="defaultBranch" label="기본 브랜치" :readonly="!project.isAdmin" />
      <q-input v-model.number="messageTtlDefault" type="number" label="메시지 TTL 기본값 (-1: 시스템 기본값)" :readonly="!project.isAdmin" />
      <q-toggle v-model="isPublic" label="공개(PUBLIC) - 비멤버도 읽기 가능" :disable="!project.isAdmin" />
      <q-input v-model="pushMirrorUrl" label="push-mirror 대상 URL (선택)" :readonly="!project.isAdmin" />
      <q-btn v-if="project.isAdmin" type="submit" color="primary" label="저장" :loading="saving" />
    </q-form>
    <div v-if="message" class="text-positive text-caption q-mt-sm">{{ message }}</div>
    <div v-if="error" class="text-negative text-caption q-mt-sm">{{ error }}</div>

    <!-- docs/plan-gitea-provisioning.md - push-mirror URL을 직접 입력하는
         대신, 이 서버에 Gitea 연동이 설정돼 있으면(GITEA_URL/GITEA_API_TOKEN)
         한 번 눌러서 그 프로젝트 전용 org+저장소를 자동으로 만들고
         pushMirrorUrl을 그 결과로 채울 수 있다 - 자격증명은 URL에
         절대 심지 않는다(repo.push가 push 시점에만 주입). -->
    <template v-if="project.isAdmin">
      <q-btn outline color="primary" label="Gitea에 자동 연결" size="sm" class="q-mt-sm" :loading="connectingGitea" @click="connectGitea" />
      <div v-if="connectGiteaError" class="text-negative text-caption q-mt-sm">{{ connectGiteaError }}</div>
      <div v-if="connectGiteaMessage" class="text-positive text-caption q-mt-sm">{{ connectGiteaMessage }}</div>
    </template>

    <template v-if="project.isAdmin">
      <q-separator class="q-my-lg" />
      <div class="text-subtitle1 q-mb-sm">Webhooks</div>
      <div class="text-caption q-mb-sm">이 프로젝트에 문서 변경이 생길 때마다 등록된 URL로 HMAC-SHA256 서명된 POST를 보냅니다.</div>
      <q-list bordered separator class="q-mb-sm">
        <q-item v-for="w in webhookList">
          <q-item-section>
            <q-item-label>{{ w.url }}</q-item-label>
            <q-item-label caption>{{ w.id }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn flat dense round icon="delete" color="negative" @click="deleteWebhook(w.id)" />
          </q-item-section>
        </q-item>
        <q-item v-if="webhookList.length === 0"><q-item-section class="text-caption">등록된 웹훅이 없습니다.</q-item-section></q-item>
      </q-list>
      <q-form class="row q-gutter-sm items-center" @submit.prevent="addWebhook">
        <q-input v-model="newWebhookUrl" label="https://..." dense style="width: 320px" />
        <q-btn type="submit" color="primary" label="추가" :loading="addingWebhook" />
      </q-form>
      <div v-if="webhookError" class="text-negative text-caption q-mt-sm">{{ webhookError }}</div>
      <q-banner v-if="newWebhookSecret" class="bg-warning text-white q-mt-sm">
        secret은 지금 한 번만 보여줍니다 - 다시 조회할 수 없으니 지금 복사해두세요:
        <div class="text-weight-bold">{{ newWebhookSecret }}</div>
      </q-banner>

      <q-separator class="q-my-lg" />
      <div class="text-subtitle1 q-mb-sm">API 키(이 프로젝트로 발급된 것)</div>
      <div class="text-caption q-mb-sm">
        collaborator들이 이 프로젝트 전용으로 발급한 키 - 그 프로젝트 밖에서는 쓸 수 없습니다. 새 키 발급은 각자 계정 메뉴의 "API 키 관리"에서 합니다.
      </div>
      <q-list bordered separator class="q-mb-md">
        <q-item v-for="k in projectApiKeys" :key="k.id">
          <q-item-section>
            <q-item-label>
              {{ k.ownerUsername }}<span v-if="k.label"> · {{ k.label }}</span>
              <q-badge :color="k.status === 'active' ? 'positive' : 'grey-6'" class="q-ml-sm">{{ k.status }}</q-badge>
            </q-item-label>
            <q-item-label caption>{{ k.keyPrefix }}… · 발급 {{ new Date(k.createdAt).toLocaleString() }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn v-if="k.status === 'active'" dense flat color="negative" label="배제" @click="revokeProjectApiKey(k.id)" />
          </q-item-section>
        </q-item>
        <q-item v-if="projectApiKeys.length === 0"><q-item-section class="text-caption">발급된 프로젝트 키가 없습니다.</q-item-section></q-item>
      </q-list>

      <q-separator class="q-my-lg" />
      <div class="text-subtitle1 text-negative q-mb-sm">Danger Zone</div>

      <q-card flat bordered class="q-pa-md q-mb-md">
        <div class="text-subtitle2">양도</div>
        <div class="text-caption q-mb-sm">이미 이 프로젝트의 collaborator인 계정에게만 Admin을 넘길 수 있습니다.</div>
        <div class="row q-gutter-sm items-center">
          <q-input v-model="transferTo" label="username" dense style="width: 200px" />
          <q-btn color="warning" label="양도" :loading="transferring" @click="transfer" />
        </div>
        <div v-if="transferError" class="text-negative text-caption q-mt-sm">{{ transferError }}</div>
      </q-card>

      <q-card flat bordered class="q-pa-md q-mb-md">
        <div class="text-subtitle2">소유자(생성자) 변경</div>
        <div class="text-caption q-mb-sm">
          이미 이 프로젝트의 collaborator인 계정에게 URL의 소유자(/{{ owner }}/...)를 넘깁니다 - Admin 역할("양도")과는 별개이며, 두
          계정의 계정 삭제(docs/plan-account-management.md) 전에 프로젝트를 남겨두려면 이걸 먼저 해야 합니다. URL이 실제로 바뀝니다.
        </div>
        <div class="row q-gutter-sm items-center">
          <q-input v-model="transferOwnershipTo" label="username" dense style="width: 200px" />
          <q-btn color="warning" label="소유자 변경" :loading="transferringOwnership" @click="transferOwnership" />
        </div>
        <div v-if="transferOwnershipError" class="text-negative text-caption q-mt-sm">{{ transferOwnershipError }}</div>
      </q-card>

      <q-card flat bordered class="q-pa-md">
        <div class="text-subtitle2">파기</div>
        <div class="text-caption q-mb-sm">프로젝트와 그 아래 모든 문서/멤버십/메시지를 영구 삭제합니다. 되돌릴 수 없습니다.</div>
        <q-btn color="negative" label="프로젝트 파기" @click="confirmDestroy = true" />
        <div v-if="destroyError" class="text-negative text-caption q-mt-sm">{{ destroyError }}</div>
      </q-card>
    </template>

    <q-dialog v-model="confirmDestroy">
      <q-card style="width: 400px">
        <q-card-section class="text-h6 text-negative">정말 파기하시겠습니까?</q-card-section>
        <q-card-section>"{{ project.current?.name }}"를 되돌릴 수 없이 삭제합니다. 계속하려면 프로젝트 이름을 입력하세요.</q-card-section>
        <q-card-section>
          <q-input v-model="destroyConfirmText" :label="`프로젝트 이름 (${project.current?.name}) 입력`" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn
            color="negative"
            label="영구 삭제"
            :disable="destroyConfirmText !== project.current?.name"
            :loading="destroying"
            @click="destroy"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import { useProjectStore } from "stores/project";
import * as api from "src/api/client";

const props = defineProps<{ owner: string; projectId: string }>();
const auth = useAuthStore();
const project = useProjectStore();
const router = useRouter();

const name = ref("");
const description = ref("");
const defaultBranch = ref("");
const messageTtlDefault = ref(-1);
const isPublic = ref(false);
const pushMirrorUrl = ref("");
const saving = ref(false);
const message = ref("");
const error = ref("");

function syncFromStore() {
  const p = project.current;
  if (!p) return;
  name.value = p.name;
  description.value = p.description ?? "";
  defaultBranch.value = p.defaultBranch;
  messageTtlDefault.value = p.messageTtlDefault;
  isPublic.value = p.visibility === "PUBLIC";
  pushMirrorUrl.value = p.pushMirrorUrl ?? "";
}

onMounted(syncFromStore);
watch(() => project.current, syncFromStore);

async function save() {
  saving.value = true;
  message.value = "";
  error.value = "";
  const result = await api.updateProject(auth.apiKey!, props.owner, props.projectId, {
    name: name.value,
    description: description.value,
    defaultBranch: defaultBranch.value,
    messageTtlDefault: messageTtlDefault.value,
    visibility: isPublic.value ? "PUBLIC" : "PRIVATE",
    pushMirrorUrl: pushMirrorUrl.value || null,
  });
  saving.value = false;
  if (!result.ok) {
    error.value = result.reason?.join(", ") ?? "저장에 실패했습니다.";
    return;
  }
  message.value = "저장했습니다.";
  await project.load(props.owner, props.projectId);
}

const connectingGitea = ref(false);
const connectGiteaError = ref("");
const connectGiteaMessage = ref("");

async function connectGitea() {
  connectingGitea.value = true;
  connectGiteaError.value = "";
  connectGiteaMessage.value = "";
  const result = await api.connectGitea(auth.apiKey!, props.owner, props.projectId);
  connectingGitea.value = false;
  if (!result.ok) {
    connectGiteaError.value = result.reason?.join(", ") ?? "연결에 실패했습니다.";
    return;
  }
  pushMirrorUrl.value = (result.data as { pushMirrorUrl: string }).pushMirrorUrl;
  connectGiteaMessage.value = "Gitea 저장소를 연결했습니다 - push-mirror 대상이 자동으로 채워졌습니다(아래 저장 버튼은 이미 반영돼 있어 다시 누를 필요 없음).";
  await project.load(props.owner, props.projectId);
}

const transferTo = ref("");
const transferring = ref(false);
const transferError = ref("");

async function transfer() {
  transferring.value = true;
  transferError.value = "";
  const result = await api.transferProject(auth.apiKey!, props.owner, props.projectId, { toUsername: transferTo.value });
  transferring.value = false;
  if (!result.ok) {
    transferError.value = result.reason?.join(", ") ?? "양도에 실패했습니다.";
    return;
  }
  await project.load(props.owner, props.projectId);
}

const transferOwnershipTo = ref("");
const transferringOwnership = ref(false);
const transferOwnershipError = ref("");

async function transferOwnership() {
  transferringOwnership.value = true;
  transferOwnershipError.value = "";
  const result = await api.transferProjectOwnership(auth.apiKey!, props.owner, props.projectId, { toUsername: transferOwnershipTo.value });
  transferringOwnership.value = false;
  if (!result.ok) {
    transferOwnershipError.value = result.reason?.join(", ") ?? "소유자 변경에 실패했습니다.";
    return;
  }
  // 소유자가 실제로 바뀌면 URL 자체(/{owner}/...)가 달라지므로, 이 화면에
  // 남아 옛 owner로 다시 조회하지 않고 새 URL로 이동한다.
  await router.push(`/${transferOwnershipTo.value}/${props.projectId}/settings`);
}

interface WebhookSummary {
  id: string;
  url: string;
}
const webhookList = ref<WebhookSummary[]>([]);
const newWebhookUrl = ref("");
const addingWebhook = ref(false);
const webhookError = ref("");
const newWebhookSecret = ref("");

async function loadWebhooks() {
  const result = await api.listWebhooks(auth.apiKey!, props.owner, props.projectId);
  if (result.ok) webhookList.value = (result.data as { items: WebhookSummary[] }).items;
}

async function addWebhook() {
  addingWebhook.value = true;
  webhookError.value = "";
  newWebhookSecret.value = "";
  const result = await api.addWebhook(auth.apiKey!, props.owner, props.projectId, newWebhookUrl.value);
  addingWebhook.value = false;
  if (!result.ok) {
    webhookError.value = result.reason?.join(", ") ?? "추가에 실패했습니다.";
    return;
  }
  const data = result.data as { secret: string };
  newWebhookSecret.value = data.secret;
  newWebhookUrl.value = "";
  await loadWebhooks();
}

async function deleteWebhook(id: string) {
  const result = await api.deleteWebhook(auth.apiKey!, props.owner, props.projectId, id);
  if (result.ok) await loadWebhooks();
}

interface ProjectApiKeySummary {
  id: string;
  ownerUsername: string;
  label: string | null;
  keyPrefix: string;
  status: string;
  createdAt: string;
}
const projectApiKeys = ref<ProjectApiKeySummary[]>([]);

async function loadProjectApiKeys() {
  const result = await api.listProjectApiKeys(auth.apiKey!, props.owner, props.projectId);
  if (result.ok) projectApiKeys.value = (result.data as { items: ProjectApiKeySummary[] }).items;
}

async function revokeProjectApiKey(keyId: string) {
  const result = await api.revokeApiKey(auth.apiKey!, keyId);
  if (result.ok) await loadProjectApiKeys();
}

onMounted(() => {
  if (project.isAdmin) {
    loadWebhooks();
    loadProjectApiKeys();
  }
});

const confirmDestroy = ref(false);
const destroyConfirmText = ref("");
const destroying = ref(false);
const destroyError = ref("");

async function destroy() {
  destroying.value = true;
  destroyError.value = "";
  const result = await api.destroyProject(auth.apiKey!, props.owner, props.projectId);
  destroying.value = false;
  if (!result.ok) {
    destroyError.value = result.reason?.join(", ") ?? "파기에 실패했습니다.";
    return;
  }
  confirmDestroy.value = false;
  await router.push("/projects");
}
</script>
