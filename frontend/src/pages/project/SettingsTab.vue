<template>
  <div class="q-pa-md" style="max-width: 640px">
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

const props = defineProps<{ projectId: string }>();
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
  const result = await auth.run({
    action: "project.update",
    projectId: props.projectId,
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
  await project.load(props.projectId);
}

const transferTo = ref("");
const transferring = ref(false);
const transferError = ref("");

async function transfer() {
  transferring.value = true;
  transferError.value = "";
  const result = await auth.run({ action: "project.transfer", projectId: props.projectId, toUsername: transferTo.value });
  transferring.value = false;
  if (!result.ok) {
    transferError.value = result.reason?.join(", ") ?? "양도에 실패했습니다.";
    return;
  }
  await project.load(props.projectId);
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
  const result = await auth.run({ action: "webhook.list", projectId: props.projectId });
  if (result.ok) webhookList.value = (result.data as { items: WebhookSummary[] }).items;
}

async function addWebhook() {
  addingWebhook.value = true;
  webhookError.value = "";
  newWebhookSecret.value = "";
  const result = await auth.run({ action: "webhook.add", projectId: props.projectId, url: newWebhookUrl.value });
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
  const result = await auth.run({ action: "webhook.delete", projectId: props.projectId, id });
  if (result.ok) await loadWebhooks();
}

onMounted(() => {
  if (project.isAdmin) loadWebhooks();
});

const confirmDestroy = ref(false);
const destroyConfirmText = ref("");
const destroying = ref(false);
const destroyError = ref("");

async function destroy() {
  destroying.value = true;
  destroyError.value = "";
  const result = await auth.run({ action: "project.destroy", projectId: props.projectId });
  destroying.value = false;
  if (!result.ok) {
    destroyError.value = result.reason?.join(", ") ?? "파기에 실패했습니다.";
    return;
  }
  confirmDestroy.value = false;
  await router.push("/projects");
}
</script>
