<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";

const props = defineProps<{ projectId: string }>();

interface GitRepo {
  provider: string;
  repoUrl: string;
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

async function load() {
  loading.value = true;
  error.value = "";
  try {
    credentials.value = await apiCall<Credential[]>("/credentials").catch(() => []);
    gitRepo.value = await apiCall<GitRepo>(`/projects/${props.projectId}/git/repo`).catch(() => null);
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
    const result = await apiCall<GitRepo>(`/projects/${props.projectId}/git/link-external`, {
      method: "POST",
      body: JSON.stringify({ provider: linkProvider.value, repoUrl: linkUrl.value.trim(), gitCredentialId: linkCredentialId.value || undefined }),
    });
    gitRepo.value = result;
    linkedWithMigrationHint.value = linkMigrationHint.value;
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

onMounted(async () => {
  await load();
  if (gitRepo.value?.provider === "external_linked") await pollSyncStatusOnce();
});
onUnmounted(stopSyncPoll);
</script>

<template>
  <div class="panel">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>

    <template v-else-if="gitRepo">
      <p>{{ gitRepo.provider }} - {{ gitRepo.repoUrl }}</p>
      <p v-if="linkedWithMigrationHint" class="migration-hint">
        <code>docs migrate scan</code>으로 기존 문서를 가져올 수 있습니다.
      </p>

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
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.mode-tabs button.active {
  background: #3454d1;
  border-color: #3454d1;
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
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
}
.mode-body button {
  align-self: flex-start;
  background: #3454d1;
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
  background: #fff7e6;
  border: 1px solid #f0c674;
  border-radius: 6px;
}
.auth-prompt input,
.auth-prompt select {
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 12px;
}
.auth-prompt button {
  align-self: flex-start;
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.migration-hint {
  margin-top: 10px;
  padding: 8px 10px;
  background: #e3f6ec;
  border-radius: 6px;
  font-size: 12px;
}
.sync-panel {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}
.sync-panel h3 {
  font-size: 14px;
  margin: 0 0 6px;
}
.sync-panel button {
  background: #fff;
  border: 1px solid #3454d1;
  color: #3454d1;
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
.sync-status p {
  margin: 4px 0;
}
.files {
  list-style: none;
  padding: 0;
  margin: 10px 0;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.files li {
  border-bottom: 1px solid #eee;
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
  background: #f8f9fb;
}
.file-row code {
  flex: 1;
  font-size: 12px;
}
.file-row .toggle {
  font-size: 10px;
  color: #999;
}
.file-content {
  margin: 0;
  padding: 10px 14px;
  background: #fafbfc;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.hint {
  font-size: 12px;
  color: #999;
  margin: 0 0 8px;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
