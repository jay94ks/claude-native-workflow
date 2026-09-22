<template>
  <div style="max-width: var(--gh-page-width-narrow); margin: 0 auto">
    <PageHeader variant="settings" title="프로젝트 설정" />
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

    <!-- 설계자 요청(2026-09-22 후속) - v2의 "GitHub 로그인"(자기 GitHub
         계정을 연결해 저장소를 고르는 기능)을 push-mirror 설정에 추가.
         Gitea와 달리 서버 공유 토큰이 아니라 이 architect 개인의 OAuth
         토큰이라 "로그인 여부"부터 따로 확인해야 한다 - 이미 연결
         돼있으면 바로 저장소 선택, 아니면 팝업으로 로그인부터.
         설계자 재지적(2026-09-22, 같은 날 후속) - GITHUB_OAUTH_CLIENT_ID
         미설정이면 버튼 자체를 숨겼었는데, "Gitea처럼 안 눌러도 에러로
         보여주는 게 낫지 않을까"라는 지적을 받아 Gitea와 동일한 패턴
         (항상 보이고, 눌렀을 때 미설정이면 에러 메시지)으로 바꿨다 -
         버튼이 안 보여서 기능 자체가 없는 줄 알았던 실제 혼란(바로 이
         라운드에서 겪음)을 근거로 판단. -->
    <template v-if="project.isAdmin">
      <q-btn v-if="!githubConnected" outline color="primary" label="GitHub로 로그인" size="sm" class="q-mt-sm" :loading="githubOAuthLoading" @click="startGithubLogin" />
      <q-btn v-else outline color="primary" :label="`GitHub 저장소 선택 (${githubLogin} 계정으로 연결됨)`" size="sm" class="q-mt-sm" @click="openGithubRepoPicker" />
      <div v-if="githubError" class="text-negative text-caption q-mt-sm">{{ githubError }}</div>
      <div v-if="githubMessage" class="text-positive text-caption q-mt-sm">{{ githubMessage }}</div>
    </template>

    <q-dialog v-model="githubRepoDialogOpen">
      <q-card style="width: var(--gh-dialog-width-lg)">
        <q-card-section class="text-h6">GitHub 저장소 선택</q-card-section>
        <q-card-section>
          <div v-if="githubReposLoading" class="text-caption">불러오는 중...</div>
          <q-list v-else bordered separator>
            <q-item v-for="r in githubRepos" :key="r.fullName" clickable @click="selectGithubRepo(r)">
              <q-item-section>
                <q-item-label>{{ r.fullName }} <q-badge v-if="r.private" color="grey-6">private</q-badge></q-item-label>
                <q-item-label caption>기본 브랜치: {{ r.defaultBranch }}</q-item-label>
              </q-item-section>
            </q-item>
            <EmptyState v-if="githubRepos.length === 0" as="item" message="저장소가 없습니다." />
          </q-list>
          <div v-if="githubReposError" class="text-negative text-caption q-mt-sm">{{ githubReposError }}</div>
          <div class="row justify-end q-mt-sm">
            <q-btn v-if="githubReposHasMore" flat label="더 보기" :loading="githubReposLoading" @click="loadGithubRepos(githubReposPage + 1)" />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

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
            <q-btn dense flat color="negative" label="삭제" @click="deleteWebhook(w.id)" />
          </q-item-section>
        </q-item>
        <EmptyState v-if="webhookList.length === 0" as="item" message="등록된 웹훅이 없습니다." />
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
        <EmptyState v-if="projectApiKeys.length === 0" as="item" message="발급된 프로젝트 키가 없습니다." />
      </q-list>

      <q-separator class="q-my-lg" />
      <div class="text-subtitle1 text-negative q-mb-sm">Danger Zone</div>

      <q-card flat bordered class="q-pa-md q-mb-md">
        <div class="text-subtitle2">양도</div>
        <div class="text-caption q-mb-sm">이미 이 프로젝트의 collaborator인 계정에게만 Admin을 넘길 수 있습니다.</div>
        <q-form class="row q-gutter-sm items-center" @submit.prevent="transfer">
          <q-input v-model="transferTo" label="username" dense style="width: 200px" />
          <q-btn type="submit" color="warning" label="양도" :loading="transferring" />
        </q-form>
        <div v-if="transferError" class="text-negative text-caption q-mt-sm">{{ transferError }}</div>
      </q-card>

      <q-card flat bordered class="q-pa-md q-mb-md">
        <div class="text-subtitle2">소유자(생성자) 변경</div>
        <div class="text-caption q-mb-sm">
          이미 이 프로젝트의 collaborator인 계정에게 URL의 소유자(/{{ owner }}/...)를 넘깁니다 - Admin 역할("양도")과는 별개이며, 두
          계정의 계정 삭제(docs/plan-account-management.md) 전에 프로젝트를 남겨두려면 이걸 먼저 해야 합니다. URL이 실제로 바뀝니다.
        </div>
        <q-form class="row q-gutter-sm items-center" @submit.prevent="transferOwnership">
          <q-input v-model="transferOwnershipTo" label="username" dense style="width: 200px" />
          <q-btn type="submit" color="warning" label="소유자 변경" :loading="transferringOwnership" />
        </q-form>
        <div v-if="transferOwnershipError" class="text-negative text-caption q-mt-sm">{{ transferOwnershipError }}</div>
      </q-card>

      <q-card flat bordered class="q-pa-md">
        <div class="text-subtitle2">파기</div>
        <div class="text-caption q-mb-sm">프로젝트와 그 아래 모든 문서/멤버십/메시지를 영구 삭제합니다. 되돌릴 수 없습니다.</div>
        <q-btn color="negative" label="프로젝트 파기" @click="confirmDestroy = true" />
        <div v-if="destroyError" class="text-negative text-caption q-mt-sm">{{ destroyError }}</div>
      </q-card>
    </template>

    <ConfirmDestroyDialog
      v-model="confirmDestroy"
      title="정말 파기하시겠습니까?"
      :body-text="`&quot;${project.current?.name}&quot;를 되돌릴 수 없이 삭제합니다. 계속하려면 프로젝트 이름을 입력하세요.`"
      :confirm-value="project.current?.name ?? ''"
      :confirm-label="`프로젝트 이름 (${project.current?.name}) 입력`"
      :loading="destroying"
      :error="destroyError"
      @confirm="destroy"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import { useProjectStore } from "stores/project";
import * as api from "src/api/client";
import ConfirmDestroyDialog from "components/ConfirmDestroyDialog.vue";
import PageHeader from "components/PageHeader.vue";
import EmptyState from "components/EmptyState.vue";

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

// 설계자 요청(2026-09-22 후속, v2의 "GitHub 로그인") - Gitea와 달리
// 서버 공유 토큰이 아니라 이 architect 개인의 OAuth 연결이라 먼저
// "이미 연결돼 있는지"부터 확인한다(github.status). 미설정(GITHUB_
// OAUTH_CLIENT_ID/SECRET 없음)이어도 Gitea처럼 버튼은 항상 보이고
// connected===false로만 와서 "로그인" 버튼이 뜨며, 눌렀을 때 서버가
// 명확한 에러로 알린다(처음엔 미설정 시 버튼 자체를 숨겼었는데,
// 그 상태에서 기능이 아예 없는 줄 알았던 실제 혼란을 겪고 되돌림).
const githubConnected = ref(false);
const githubLogin = ref<string | null>(null);
const githubOAuthLoading = ref(false);
const githubError = ref("");
const githubMessage = ref("");

async function loadGithubStatus() {
  const result = await api.getGithubStatus(auth.apiKey!);
  if (!result.ok) return;
  const data = result.data as { configured: boolean; connected: boolean; githubLogin: string | null };
  githubConnected.value = data.connected;
  githubLogin.value = data.githubLogin;
}

// 팝업으로 OAuth를 진행하고(v2와 동일한 패턴), 콜백 페이지가 보내는
// postMessage로 완료를 알아챈다 - 팝업 자체가 GitHub 도메인으로
// 이동하므로 그 창을 직접 폴링할 수 없고 이 방법뿐이다.
async function startGithubLogin() {
  githubOAuthLoading.value = true;
  githubError.value = "";
  githubMessage.value = "";
  const result = await api.startGithubOAuth(auth.apiKey!);
  githubOAuthLoading.value = false;
  if (!result.ok) {
    githubError.value = result.reason?.join(", ") ?? "GitHub 로그인 시작에 실패했습니다.";
    return;
  }
  const { authorizeUrl } = result.data as { authorizeUrl: string };
  window.open(authorizeUrl, "github-oauth", "width=640,height=720");
}

function onGithubOAuthMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.type !== "github-oauth-done") return;
  if (!event.data.ok) {
    githubError.value = event.data.error ?? "GitHub 연결에 실패했습니다.";
    return;
  }
  githubMessage.value = "GitHub 계정을 연결했습니다.";
  loadGithubStatus().then(() => openGithubRepoPicker());
}

interface GithubRepoSummary {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string;
}
const githubRepoDialogOpen = ref(false);
const githubRepos = ref<GithubRepoSummary[]>([]);
const githubReposPage = ref(1);
const githubReposHasMore = ref(false);
const githubReposLoading = ref(false);
const githubReposError = ref("");

function openGithubRepoPicker() {
  githubRepoDialogOpen.value = true;
  githubRepos.value = [];
  loadGithubRepos(1);
}

async function loadGithubRepos(page: number) {
  githubReposLoading.value = true;
  githubReposError.value = "";
  const result = await api.listGithubRepos(auth.apiKey!, page);
  githubReposLoading.value = false;
  if (!result.ok) {
    githubReposError.value = result.reason?.join(", ") ?? "목록을 불러오지 못했습니다.";
    return;
  }
  const data = result.data as { items: GithubRepoSummary[]; hasMore: boolean };
  githubReposPage.value = page;
  githubRepos.value = page === 1 ? data.items : [...githubRepos.value, ...data.items];
  githubReposHasMore.value = data.hasMore;
}

async function selectGithubRepo(repo: GithubRepoSummary) {
  const result = await api.connectGithub(auth.apiKey!, props.owner, props.projectId, repo.cloneUrl);
  if (!result.ok) {
    githubReposError.value = result.reason?.join(", ") ?? "연결에 실패했습니다.";
    return;
  }
  pushMirrorUrl.value = (result.data as { pushMirrorUrl: string }).pushMirrorUrl;
  githubRepoDialogOpen.value = false;
  githubMessage.value = `GitHub 저장소(${repo.fullName})를 연결했습니다 - push-mirror 대상이 자동으로 채워졌습니다(아래 저장 버튼은 이미 반영돼 있어 다시 누를 필요 없음).`;
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
    loadGithubStatus();
  }
  window.addEventListener("message", onGithubOAuthMessage);
});
onUnmounted(() => {
  window.removeEventListener("message", onGithubOAuthMessage);
});

const confirmDestroy = ref(false);
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
