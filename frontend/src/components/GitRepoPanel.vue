<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY } from "../utils/projectContext";

const props = defineProps<{ projectId: string }>();

// git 저장소 기능 전체는 프로젝트 owner 전용(설계자 확정) - 컴포넌트
// 자체를 owner가 아니면 아예 렌더링하지 않는다.
const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const isOwner = computed(() => myRole.value === "owner");

interface GitRepo {
  provider: string;
  repoUrl: string;
  webhookAutoRegistered: boolean;
  webhookFirstReceivedAt: string | null;
}
interface WebhookInstructions {
  url: string;
  secret: string;
}
interface Credential {
  id: string;
  hostPattern: string | null;
  credentialType: string;
}
interface SyncStatus {
  added: string[];
  changed: string[];
  removedFromWork: string[];
}
interface SyncProposalFile {
  path: string;
  content: string;
}

const gitRepo = ref<GitRepo | null>(null);
const credentials = ref<Credential[]>([]);
const loading = ref(true);
const error = ref("");
// 카드를 접고 펼 수는 있지만(로컬 UI 상태), "보여줄지 말지" 자체는
// 항상 서버 진실(webhookInstructions가 null이 아님)을 따른다 -
// 설계자 지시: 웹훅이 실제로 한 번 호출되기 전까진 새로고침해도,
// 다른 탭에서 다시 들어와도 계속 노출돼야 한다("확인함"으로 영구
// 닫기는 없앰).
const webhookCardExpanded = ref(true);

async function loadWebhookInstructionsIfNeeded() {
  const repo = gitRepo.value;
  if (!repo || repo.provider !== "external_linked" || repo.webhookAutoRegistered || repo.webhookFirstReceivedAt) {
    webhookInstructions.value = null;
    return;
  }
  webhookInstructions.value = await apiCall<WebhookInstructions | null>(
    `/projects/${props.projectId}/git/webhook-instructions`,
  ).catch(() => null);
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    credentials.value = await apiCall<Credential[]>("/credentials").catch(() => []);
    gitRepo.value = await apiCall<GitRepo>(`/projects/${props.projectId}/git/repo`).catch(() => null);
    await loadWebhookInstructionsIfNeeded();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------- 옵션 선택 + 인증 필요 시 인라인 처리

type Mode = "create" | "import" | "link";
const mode = ref<Mode>("create");

const importUrl = ref("");
const importCredentialId = ref("");
const importing = ref(false);
const importError = ref("");

const linkProvider = ref<"github" | "gitlab">("github");
const linkUrl = ref("");
const linkCredentialId = ref("");
const linkMigrationHint = ref(false);
const linking = ref(false);
const linkError = ref("");
const linkedWithMigrationHint = ref(false);
// git/link-external이 외부 저장소에 웹훅 자동 등록을 못 했을 때
// (이 백엔드가 GitHub/GitLab이 도달 가능한 공개 주소가 아닌 경우 -
// 로컬/사설 배포에서 흔함) 응답에 실어 보내는 수동 설정 안내 - 예전엔
// 이 필드를 타입에 아예 선언 안 해서 응답에 실제로 왔어도 화면에
// 조용히 버려졌다(설계자 지시로 발견해 추가).
const webhookInstructions = ref<WebhookInstructions | null>(null);

// 자격증명 없이 시도했다가 422 git_auth_required가 오면 그 자리에
// 자격증명 입력 폼을 띄운다 - 저장 후 같은 동작을 자동 재시도.
const authPromptFor = ref<"import" | "link" | null>(null);
const authHostPattern = ref("");
const authCredentialType = ref<"token" | "username_password">("token");
const authValue = ref("");
const authSaving = ref(false);
const authError = ref("");

function isAuthRequired(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 422 && err.message === "git_auth_required";
}

// ---------------------------------------------------------------- 외부 연동 해제(자체 호스팅으로 전환)
// Gitea와의 연결(작업 저장소) 자체는 프로젝트를 지우지 않는 한 끊을 수
// 없다(설계자 확정) - 여기서 끊는 건 "외부를 권위 저장소로 취급하던
// 관계"뿐이라, 서버가 provider:"self_hosted"로 전환된 최신 상태를
// 그대로 돌려주면 기존 v-if="gitRepo.provider === 'external_linked'"
// 조건들이 자연히 동기화/발행 패널을 감춘다(별도 분기 불필요).

const unlinking = ref(false);
const unlinkError = ref("");

async function unlinkExternal() {
  if (
    !window.confirm(
      "외부 저장소와의 연동을 해제합니다. 미러 저장소는 삭제되고, 지금까지 작업해온 Gitea 저장소는 그대로 이 프로젝트의 자체 호스팅 저장소가 됩니다. 계속할까요?",
    )
  ) {
    return;
  }
  unlinking.value = true;
  unlinkError.value = "";
  try {
    gitRepo.value = await apiCall<GitRepo>(`/projects/${props.projectId}/git/repo`, { method: "DELETE" });
    webhookInstructions.value = null;
    syncStatus.value = null;
    syncProposal.value = null;
    publishQueueEntry.value = null;
    stopSyncPoll();
    stopPublishQueuePoll();
  } catch (err) {
    unlinkError.value = err instanceof ApiError ? err.message : "연동 해제에 실패했습니다";
  } finally {
    unlinking.value = false;
  }
}

async function createRepo() {
  importing.value = true;
  importError.value = "";
  try {
    const result = await apiCall<GitRepo>(`/projects/${props.projectId}/git/link`, { method: "POST", body: JSON.stringify({}) });
    gitRepo.value = result;
  } catch (err) {
    importError.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  } finally {
    importing.value = false;
  }
}

async function startImport() {
  if (!importUrl.value.trim()) return;
  importing.value = true;
  importError.value = "";
  try {
    const result = await apiCall<GitRepo>(`/projects/${props.projectId}/git/link`, {
      method: "POST",
      body: JSON.stringify({ importFrom: { repoUrl: importUrl.value.trim(), gitCredentialId: importCredentialId.value || undefined } }),
    });
    gitRepo.value = result;
    authPromptFor.value = null;
  } catch (err) {
    if (isAuthRequired(err)) {
      authPromptFor.value = "import";
      authHostPattern.value = hostFromUrl(importUrl.value);
      authError.value = "";
      return;
    }
    importError.value = err instanceof ApiError ? err.message : "이주에 실패했습니다";
  } finally {
    importing.value = false;
  }
}

async function startLink() {
  if (!linkUrl.value.trim()) return;
  linking.value = true;
  linkError.value = "";
  try {
    const result = await apiCall<GitRepo & { manualWebhookInstructions?: WebhookInstructions }>(
      `/projects/${props.projectId}/git/link-external`,
      {
        method: "POST",
        body: JSON.stringify({ provider: linkProvider.value, repoUrl: linkUrl.value.trim(), gitCredentialId: linkCredentialId.value || undefined }),
      },
    );
    gitRepo.value = result;
    linkedWithMigrationHint.value = linkMigrationHint.value;
    webhookInstructions.value = result.manualWebhookInstructions ?? null;
    webhookCardExpanded.value = true;
    authPromptFor.value = null;
  } catch (err) {
    if (isAuthRequired(err)) {
      authPromptFor.value = "link";
      authHostPattern.value = hostFromUrl(linkUrl.value);
      authError.value = "";
      return;
    }
    linkError.value = err instanceof ApiError ? err.message : "연동에 실패했습니다";
  } finally {
    linking.value = false;
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

async function saveCredentialAndRetry() {
  if (!authValue.value.trim()) return;
  authSaving.value = true;
  authError.value = "";
  try {
    const cred = await apiCall<Credential>("/credentials", {
      method: "POST",
      body: JSON.stringify({ credentialType: authCredentialType.value, value: authValue.value, hostPattern: authHostPattern.value || undefined }),
    });
    credentials.value = [...credentials.value, cred];
    authValue.value = "";
    if (authPromptFor.value === "import") {
      importCredentialId.value = cred.id;
      await startImport();
    } else if (authPromptFor.value === "link") {
      linkCredentialId.value = cred.id;
      await startLink();
    }
  } catch (err) {
    authError.value = err instanceof ApiError ? err.message : "자격증명 저장에 실패했습니다";
  } finally {
    authSaving.value = false;
  }
}

// ---------------------------------------------------------------- 동기화 제안(외부 연동 전용)
// Gitea의 미러 동기화 트리거는 비동기 큐잉이라(즉시 안 끝남) 요청과
// 조회를 분리한다 - "동기화 상태 확인" 버튼은 먼저 트리거(POST)만 하고,
// 그 뒤로는 완료될 때까지 버튼이 비활성 상태로 "확인 중..."을 보여주며
// 짧은 간격으로 조회(GET)를 폴링한다. 이미 다른 요청이 진행 중이면
// (다른 탭/세션에서 트리거했을 수도 있음) 새로 트리거하지 않고 그
// 결과를 그대로 기다린다 - 화면 진입 시에도 한 번 조회해 이미 진행
// 중인 요청이 있으면 처음부터 버튼을 비활성으로 보여준다.

type SyncPollStatus = "idle" | "pending" | "ready";

const syncStatus = ref<SyncStatus | null>(null);
const syncPollStatus = ref<SyncPollStatus>("idle");
const syncStatusError = ref("");

const syncProposal = ref<SyncProposalFile[] | null>(null);
const syncProposalLoading = ref(false);
const syncProposalError = ref("");
const expandedFilePath = ref<string | null>(null);

let syncPollTimer: ReturnType<typeof setTimeout> | null = null;

function stopSyncPoll() {
  if (syncPollTimer) {
    clearTimeout(syncPollTimer);
    syncPollTimer = null;
  }
}

async function pollSyncStatusOnce(): Promise<void> {
  try {
    const state = await apiCall<{ status: "none" | "pending" | "ready" } & Partial<SyncStatus>>(
      `/projects/${props.projectId}/git/sync-status`,
    );
    if (state.status === "ready") {
      syncStatus.value = { added: state.added ?? [], changed: state.changed ?? [], removedFromWork: state.removedFromWork ?? [] };
      syncPollStatus.value = "ready";
      stopSyncPoll();
      return;
    }
    if (state.status === "pending") {
      syncPollStatus.value = "pending";
      syncPollTimer = setTimeout(pollSyncStatusOnce, 1500);
      return;
    }
    syncPollStatus.value = "idle";
  } catch (err) {
    syncStatusError.value = err instanceof ApiError ? err.message : "동기화 상태 확인에 실패했습니다";
    syncPollStatus.value = "idle";
  }
}

async function checkSyncStatus() {
  syncStatusError.value = "";
  syncProposal.value = null;
  try {
    await apiCall(`/projects/${props.projectId}/git/sync-status`, { method: "POST" });
    syncPollStatus.value = "pending";
    stopSyncPoll();
    syncPollTimer = setTimeout(pollSyncStatusOnce, 1500);
  } catch (err) {
    syncStatusError.value = err instanceof ApiError ? err.message : "동기화 상태 확인에 실패했습니다";
  }
}

async function loadSyncProposal() {
  syncProposalLoading.value = true;
  syncProposalError.value = "";
  try {
    const result = await apiCall<{ files: SyncProposalFile[] }>(`/projects/${props.projectId}/git/sync-proposal`);
    syncProposal.value = result.files;
  } catch (err) {
    syncProposalError.value = err instanceof ApiError ? err.message : "동기화 제안 생성에 실패했습니다";
  } finally {
    syncProposalLoading.value = false;
  }
}

function toggleFile(path: string) {
  expandedFilePath.value = expandedFilePath.value === path ? null : path;
}

// ---------------------------------------------------------------- 동기화(발행) - 실제로 외부(권위) 저장소에 push
// 위 "동기화 제안"(diff 미리보기)과 달리 실제 push를 시도한다 - 즉시
// 반영되면 끝, fast-forward가 안 되거나 자격증명에 push 권한이 없으면
// AI 대기열로 넘어간다. 대기 중에는 버튼을 비활성화하고, 큐 항목이
// 사라질 때까지(AI가 완료 보고) 주기적으로 폴링한다(sync-status
// 폴링과 같은 스타일 - 별도 타이머로 독립 운용).

interface PublishQueueEntry {
  id: string;
  reason: string;
}

const publishCredentialId = ref("");
const publishing = ref(false);
const publishError = ref("");
const publishSuccessAt = ref<number | null>(null);
const publishQueueEntry = ref<PublishQueueEntry | null>(null);

let publishQueuePollTimer: ReturnType<typeof setTimeout> | null = null;

function stopPublishQueuePoll() {
  if (publishQueuePollTimer) {
    clearTimeout(publishQueuePollTimer);
    publishQueuePollTimer = null;
  }
}

async function pollPublishQueueOnce(): Promise<void> {
  try {
    const entry = await apiCall<PublishQueueEntry | null>(`/projects/${props.projectId}/git/publish-queue`);
    publishQueueEntry.value = entry;
    if (entry) {
      publishQueuePollTimer = setTimeout(pollPublishQueueOnce, 5000);
    }
  } catch {
    // 폴링 실패는 조용히 재시도(다음 수동 새로고침에서도 다시 시도됨) -
    // 버튼을 영구히 비활성 상태로 가두지 않기 위해 멈추지 않는다.
    publishQueuePollTimer = setTimeout(pollPublishQueueOnce, 5000);
  }
}

async function publish() {
  if (!publishCredentialId.value) return;
  publishing.value = true;
  publishError.value = "";
  publishSuccessAt.value = null;
  try {
    const result = await apiCall<{ status: "synced" } | { status: "queued"; queueEntryId: string }>(
      `/projects/${props.projectId}/git/publish`,
      { method: "POST", body: JSON.stringify({ gitCredentialId: publishCredentialId.value }) },
    );
    if (result.status === "synced") {
      publishSuccessAt.value = Date.now();
    } else {
      stopPublishQueuePoll();
      await pollPublishQueueOnce();
    }
  } catch (err) {
    publishError.value = err instanceof ApiError ? err.message : "동기화에 실패했습니다";
  } finally {
    publishing.value = false;
  }
}

onMounted(async () => {
  if (!isOwner.value) return;
  await load();
  if (gitRepo.value?.provider === "external_linked") {
    await pollSyncStatusOnce();
    await pollPublishQueueOnce();
  }
});
onUnmounted(() => {
  stopSyncPoll();
  stopPublishQueuePoll();
});
</script>

<template>
  <div v-if="isOwner" class="panel">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>

    <template v-else-if="gitRepo">
      <p>{{ gitRepo.provider }} - {{ gitRepo.repoUrl }}</p>
      <p v-if="linkedWithMigrationHint" class="migration-hint">
        <code>docs migrate scan</code>으로 기존 문서를 가져올 수 있습니다.
      </p>

      <div v-if="webhookInstructions" class="webhook-instructions">
        <div class="webhook-instructions-header" @click="webhookCardExpanded = !webhookCardExpanded">
          <span>⚠ 웹훅 수동 설정이 필요합니다</span>
          <span class="toggle">{{ webhookCardExpanded ? "▲" : "▼" }}</span>
        </div>
        <template v-if="webhookCardExpanded">
          <p class="hint">
            외부 저장소에 웹훅을 자동으로 등록하지 못했습니다 - 이 백엔드가 GitHub/GitLab이 직접 접근할 수 있는 공개
            주소가 아닌 경우 흔합니다(로컬/사설 서버에 설치한 경우 등). 아래 값으로 저장소 설정(Settings → Webhooks)에서
            직접 등록하면, 이 시스템을 거치지 않고 그 저장소에 직접 push해도 push 훅 자동화가 그대로 반응합니다 - 등록
            없이도 "동기화 상태 확인"/"동기화" 버튼으로 직접 확인·반영하는 데는 지장 없습니다. 실제로 웹훅 호출이 한
            번이라도 도착하면 이 카드는 자동으로 사라집니다.
          </p>
          <dl>
            <dt>Payload URL</dt>
            <dd><code>{{ webhookInstructions.url }}</code></dd>
            <dt>Secret</dt>
            <dd><code>{{ webhookInstructions.secret }}</code></dd>
            <dt>Content type</dt>
            <dd><code>application/json</code></dd>
            <dt>이벤트</dt>
            <dd><code>push</code>만</dd>
          </dl>
        </template>
      </div>

      <div v-if="gitRepo.provider === 'external_linked'" class="sync-panel">
        <h3>동기화</h3>
        <p class="hint">
          이 프로젝트는 외부 저장소가 권위(authoritative)를 갖는다 - 이 시스템의 편집은 작업 저장소에 쌓이고, 외부
          저장소로 반영하는 건 설계자가 검토 후 직접 한다.
        </p>
        <button :disabled="syncPollStatus === 'pending'" @click="checkSyncStatus">
          {{ syncPollStatus === "pending" ? "동기화 확인 예정됨..." : "동기화 상태 확인" }}
        </button>
        <p v-if="syncStatusError" class="error">{{ syncStatusError }}</p>
        <div v-if="syncStatus" class="sync-status">
          <p><strong>추가됨:</strong> {{ syncStatus.added.length === 0 ? "없음" : syncStatus.added.join(", ") }}</p>
          <p><strong>변경됨:</strong> {{ syncStatus.changed.length === 0 ? "없음" : syncStatus.changed.join(", ") }}</p>
          <p>
            <strong>미러에만 있음(작업 저장소에서 없어짐):</strong>
            {{ syncStatus.removedFromWork.length === 0 ? "없음" : syncStatus.removedFromWork.join(", ") }}
          </p>
          <button v-if="syncStatus.added.length + syncStatus.changed.length > 0" :disabled="syncProposalLoading" @click="loadSyncProposal">
            동기화 제안 만들기
          </button>
        </div>
        <button :disabled="unlinking" class="danger" @click="unlinkExternal">
          {{ unlinking ? "해제 중..." : "외부 연동 해제(자체 호스팅으로 전환)" }}
        </button>
        <p v-if="unlinkError" class="error">{{ unlinkError }}</p>
        <p v-if="syncProposalError" class="error">{{ syncProposalError }}</p>
        <div v-if="syncProposal" class="sync-proposal">
          <ul class="files">
            <li v-for="f in syncProposal" :key="f.path">
              <div class="file-row" @click="toggleFile(f.path)">
                <code>{{ f.path }}</code>
                <span class="toggle">{{ expandedFilePath === f.path ? "▲" : "▼" }}</span>
              </div>
              <pre v-if="expandedFilePath === f.path" class="file-content">{{ f.content }}</pre>
            </li>
          </ul>
          <p class="hint">
            CLI <code>docs git sync-proposal {{ projectId }} --out &lt;dir&gt;</code>로 로컬에 받아 직접 커밋·PR
            하세요.
          </p>
        </div>
      </div>

      <div class="publish-panel">
        <h3>동기화(발행)</h3>
        <p class="hint">
          작업 저장소의 커밋을 실제로 외부(권위) 저장소에 push한다(Gitea Push Mirror 사용). fast-forward가 안 되거나
          자격증명에 push 권한이 없으면 AI 대기열로 넘어가고, 처리 완료 보고 전까지 이 버튼은 비활성화된다.
        </p>
        <div v-if="publishQueueEntry" class="publish-queued">
          AI 처리 대기 중({{ publishQueueEntry.reason === "diverged" ? "충돌" : "발행 실패" }}) -
          <code>docs git publish-queue-done {{ projectId }} {{ publishQueueEntry.id }}</code>로 완료 보고가 오면
          자동으로 다시 활성화됩니다.
        </div>
        <template v-else>
          <select v-model="publishCredentialId">
            <option value="">자격 증명 선택</option>
            <option v-for="c in credentials" :key="c.id" :value="c.id">{{ c.hostPattern ?? c.credentialType }}</option>
          </select>
          <button :disabled="publishing || !publishCredentialId" @click="publish">
            {{ publishing ? "동기화 중..." : "동기화" }}
          </button>
          <p v-if="publishError" class="error">{{ publishError }}</p>
          <p v-if="publishSuccessAt" class="publish-success">외부 저장소에 반영됐습니다.</p>
        </template>
      </div>
    </template>

    <template v-else>
      <nav class="mode-tabs">
        <button :class="{ active: mode === 'create' }" @click="mode = 'create'">새 저장소 생성</button>
        <button :class="{ active: mode === 'import' }" @click="mode = 'import'">외부 저장소 이주</button>
        <button :class="{ active: mode === 'link' }" @click="mode = 'link'">외부 저장소 연동</button>
      </nav>

      <div v-if="mode === 'create'" class="mode-body">
        <p class="hint">Gitea에 빈 저장소를 만들어 연결한다.</p>
        <button :disabled="importing" @click="createRepo">저장소 생성</button>
        <p v-if="importError" class="error">{{ importError }}</p>
      </div>

      <div v-else-if="mode === 'import'" class="mode-body">
        <p class="hint">기존 저장소의 히스토리를 통째로 가져와 Gitea 저장소로 시작한다(1회성 - 이후 원본과 관계 없음).</p>
        <input v-model="importUrl" type="text" placeholder="저장소 URL" />
        <select v-model="importCredentialId">
          <option value="">자격증명 없음</option>
          <option v-for="c in credentials" :key="c.id" :value="c.id">{{ c.hostPattern ?? c.credentialType }}</option>
        </select>
        <button :disabled="importing" @click="startImport">이주 시작</button>
        <p v-if="importError" class="error">{{ importError }}</p>

        <div v-if="authPromptFor === 'import'" class="auth-prompt">
          <p class="hint">이 저장소는 인증이 필요합니다.</p>
          <input v-model="authHostPattern" type="text" placeholder="host" />
          <select v-model="authCredentialType">
            <option value="token">token</option>
            <option value="username_password">username_password</option>
          </select>
          <input v-model="authValue" type="text" placeholder="토큰/자격증명 값" />
          <button :disabled="authSaving" @click="saveCredentialAndRetry">저장하고 재시도</button>
          <p v-if="authError" class="error">{{ authError }}</p>
        </div>
      </div>

      <div v-else class="mode-body">
        <p class="hint">외부 저장소가 계속 권위를 갖는다 - 관리 편의를 위해 Gitea에 미러+작업 저장소를 만든다.</p>
        <select v-model="linkProvider">
          <option value="github">github</option>
          <option value="gitlab">gitlab</option>
        </select>
        <input v-model="linkUrl" type="text" placeholder="저장소 URL" />
        <select v-model="linkCredentialId">
          <option value="">자격증명 없음</option>
          <option v-for="c in credentials" :key="c.id" :value="c.id">{{ c.hostPattern ?? c.credentialType }}</option>
        </select>
        <label class="checkbox"><input v-model="linkMigrationHint" type="checkbox" /> 여기 기존 문서가 있어 마이그레이션이 필요합니다</label>
        <button :disabled="linking" @click="startLink">연동</button>
        <p v-if="linkError" class="error">{{ linkError }}</p>

        <div v-if="authPromptFor === 'link'" class="auth-prompt">
          <p class="hint">이 저장소는 인증이 필요합니다.</p>
          <input v-model="authHostPattern" type="text" placeholder="host" />
          <select v-model="authCredentialType">
            <option value="token">token</option>
            <option value="username_password">username_password</option>
          </select>
          <input v-model="authValue" type="text" placeholder="토큰/자격증명 값" />
          <button :disabled="authSaving" @click="saveCredentialAndRetry">저장하고 재시도</button>
          <p v-if="authError" class="error">{{ authError }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  font-size: 13px;
}
.mode-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.mode-tabs button {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.mode-tabs button.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.mode-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
}
.mode-body input,
.mode-body select {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.mode-body button {
  align-self: flex-start;
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.mode-body button:disabled {
  opacity: 0.6;
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.auth-prompt {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 6px;
}
.auth-prompt input,
.auth-prompt select {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
}
.auth-prompt button {
  align-self: flex-start;
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.migration-hint {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--color-success-bg);
  border-radius: 6px;
  font-size: 12px;
}
.webhook-instructions {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 6px;
  font-size: 12px;
}
.webhook-instructions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  font-weight: 600;
  color: var(--color-warning-text);
}
.webhook-instructions-header .toggle {
  font-size: 10px;
  color: var(--color-text-faint);
}
.webhook-instructions dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 8px 0;
}
.webhook-instructions dt {
  color: var(--color-text-faint);
}
.webhook-instructions dd {
  margin: 0;
  word-break: break-all;
}
.sync-panel {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-light);
}
.sync-panel h3 {
  font-size: 14px;
  margin: 0 0 6px;
}
.sync-panel button {
  background: var(--color-surface);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  margin-top: 6px;
}
.sync-status {
  margin-top: 10px;
  font-size: 13px;
}
.danger {
  background: var(--color-surface);
  border: 1px solid var(--color-danger);
  color: var(--color-danger);
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  margin-top: 12px;
}
.danger:disabled {
  opacity: 0.6;
}
.sync-status p {
  margin: 4px 0;
}
.files {
  list-style: none;
  padding: 0;
  margin: 10px 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.files li {
  border-bottom: 1px solid var(--color-border-light);
}
.files li:last-child {
  border-bottom: none;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.file-row:hover {
  background: var(--color-surface-hover);
}
.file-row code {
  flex: 1;
  font-size: 12px;
}
.file-row .toggle {
  font-size: 10px;
  color: var(--color-text-faint);
}
.file-content {
  margin: 0;
  padding: 10px 14px;
  background: var(--color-bg);
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.publish-panel {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-light);
}
.publish-panel h3 {
  font-size: 14px;
  margin: 0 0 6px;
}
.publish-panel select {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 12px;
  margin-right: 8px;
  background: var(--color-surface);
  color: var(--color-text);
}
.publish-panel button {
  background: var(--color-surface);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
}
.publish-panel button:disabled {
  opacity: 0.6;
}
.publish-queued {
  padding: 10px;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 6px;
  font-size: 12px;
}
.publish-success {
  color: var(--color-success);
  font-size: 13px;
  margin-top: 6px;
}
.hint {
  font-size: 12px;
  color: var(--color-text-faint);
  margin: 0 0 8px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
