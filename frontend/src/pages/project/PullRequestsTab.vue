<template>
  <div class="row no-wrap" style="min-height: calc(100vh - 160px)">
    <ProjectSidebar>
      <PageHeader variant="section" title="Pull requests" :count="items.length">
        <template #actions>
          <q-btn size="sm" color="primary" icon="add" label="새 PR" :to="`/${owner}/${projectId}/pull-requests/new`" />
        </template>
      </PageHeader>
      <div v-if="loading" class="text-caption">불러오는 중...</div>
      <!-- 설계자 요청(2026-09-21) - PR이 선택되면 목록은 500px로 고정(스크롤
           가능)하고 그 밑에 바뀐 파일을 트리로 보여준다. -->
      <q-list v-else bordered separator :style="selected ? 'max-height: 500px; overflow-y: auto' : ''">
        <q-item
          v-for="pr in items"
          :key="pr.id"
          clickable
          :active="selected?.id === pr.id"
          active-class="bg-blue-1"
          @click="select(pr.id)"
        >
          <q-item-section>
            <q-item-label>{{ pr.title }}</q-item-label>
            <q-item-label caption>{{ pr.sourceBranch }} → {{ pr.targetBranch }} · {{ pr.author }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge :color="stateColor(pr.state)">{{ pr.state }}</q-badge>
          </q-item-section>
        </q-item>
        <EmptyState v-if="items.length === 0" as="item" message="Pull request가 없습니다." />
      </q-list>

      <template v-if="selected">
        <div class="text-subtitle2 q-mt-md q-mb-sm">변경된 파일 ({{ selected.diff.files.length }})</div>
        <q-tree
          :nodes="fileTree"
          node-key="nodeKey"
          :selected="selectedPath"
          @update:selected="onTreeSelect"
          default-expand-all
        >
          <template #default-header="scope">
            <div class="row items-center" style="gap: 4px">
              <q-icon :name="scope.node.isFile ? 'description' : 'folder'" :color="scope.node.isFile ? 'grey-7' : 'amber-8'" size="16px" />
              <span>{{ scope.node.label }}</span>
              <q-badge v-if="scope.node.status" outline dense>{{ scope.node.status }}</q-badge>
            </div>
          </template>
        </q-tree>
        <div v-if="selected.diff.files.length === 0" class="text-caption" style="color: var(--gh-fg-muted)">변경된 파일이 없습니다.</div>
      </template>
    </ProjectSidebar>

    <q-separator vertical />

    <div class="col q-pa-md" style="overflow-y: auto">
      <template v-if="selected">
        <div class="row items-center justify-between">
          <div class="text-h6">{{ selected.title }}</div>
          <q-badge :color="stateColor(selected.state)">{{ selected.state }}</q-badge>
        </div>
        <div class="text-caption q-mb-sm">{{ selected.sourceBranch }} → {{ selected.targetBranch }} · author: {{ selected.author }}</div>
        <!-- 설계자 요청(2026-09-21 후속) - PR 설명은 open 상태일 때만 수정
             가능하다(머지/닫힘 이후엔 실제 머지 당시 내용과 달라 보이면
             오해를 부르므로 읽기 전용으로 고정) - MarkdownSourceView의
             기본 view/edit 토글+저장 버튼을 그대로 쓴다. -->
        <div v-if="selected.description || selected.state === 'open'" class="q-mb-md">
          <MarkdownSourceView :key="selected.id" :content="selected.description" :read-only="selected.state !== 'open'" @save="saveDescription" />
        </div>
        <div v-if="descriptionError" class="text-negative text-caption q-mb-sm">{{ descriptionError }}</div>

        <div v-if="selected.state === 'open'" class="q-gutter-sm q-mb-md">
          <q-btn size="sm" color="positive" label="Merge" :loading="merging" @click="merge" />
          <q-btn size="sm" color="negative" outline label="Close" :loading="closing" @click="close" />
        </div>
        <div v-if="actionError" class="text-negative text-caption q-mb-sm">{{ actionError }}</div>
        <div v-if="selected.mergeCommitId" class="text-caption q-mb-sm">merge commit: {{ selected.mergeCommitId }}</div>

        <!-- 설계자 요청(2026-09-21) - 파일을 하나 고르면 여기(예전에 Diff 패치
             텍스트가 있던 자리)에 좌/우 분할 diff 뷰어를 보여준다. -->
        <div class="text-subtitle2 q-mb-xs">Diff</div>
        <DiffViewer v-if="selectedPath" :owner="owner" :project-id="projectId" :base="selected.targetBranch" :head="selected.sourceBranch" :path="selectedPath" />
        <div v-else class="text-caption" style="color: var(--gh-fg-muted)">왼쪽 파일 트리에서 파일을 선택하세요.</div>
      </template>
      <div v-else class="text-caption">왼쪽에서 PR을 선택하세요.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import ProjectSidebar from "components/ProjectSidebar.vue";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import DiffViewer from "components/DiffViewer.vue";
import PageHeader from "components/PageHeader.vue";
import EmptyState from "components/EmptyState.vue";
import * as api from "src/api/client";
import { buildFileTree } from "src/utils/fileTree";

interface PrSummary {
  id: string;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  author: string;
  mergeCommitId: string | null;
}
interface DiffFile {
  path: string;
  oldPath: string | null;
  status: string;
}
interface PrFull extends PrSummary {
  diff: { files: DiffFile[]; patch: string };
}
const props = defineProps<{ owner: string; projectId: string; id?: string }>();
const auth = useAuthStore();
const router = useRouter();

const items = ref<PrSummary[]>([]);
const loading = ref(true);
const selected = ref<PrFull | null>(null);
const selectedPath = ref<string | null>(null);
const actionError = ref("");
const descriptionError = ref("");
const merging = ref(false);
const closing = ref(false);

function stateColor(state: string): string {
  if (state === "merged") return "positive";
  if (state === "closed") return "grey-6";
  return "primary";
}

const fileTree = computed(() => (selected.value ? buildFileTree(selected.value.diff.files) : []));

function onTreeSelect(key: string | number | null) {
  if (typeof key !== "string") return;
  // 폴더 노드는 파일이 아니므로 무시 - selected.diff.files에 그 경로가
  // 실제로 있는 것만(=파일) diff 뷰어 대상으로 받아들인다.
  const isFile = selected.value?.diff.files.some((f) => f.path === key);
  if (isFile) selectedPath.value = key;
}

async function load() {
  loading.value = true;
  const result = await api.listPullRequests(auth.apiKey!, props.owner, props.projectId);
  loading.value = false;
  if (result.ok) items.value = (result.data as { items: PrSummary[] }).items;
}

async function loadSelected(id: string) {
  actionError.value = "";
  descriptionError.value = "";
  selectedPath.value = null;
  const result = await api.getPullRequest(auth.apiKey!, props.owner, props.projectId, id);
  if (result.ok) selected.value = result.data as PrFull;
}

// 설계자 요청(2026-09-21 후속) - 지금 보고 있는 PR을 path segment
// (/pull-requests/{id})에 반영해 Browser History/새로고침에서 유지한다.
async function select(id: string) {
  await loadSelected(id);
  router.push(`/${props.owner}/${props.projectId}/pull-requests/${id}`);
}

async function saveDescription(markdown: string) {
  if (!selected.value) return;
  descriptionError.value = "";
  const result = await api.updatePullRequest(auth.apiKey!, props.owner, props.projectId, selected.value.id, { description: markdown });
  if (!result.ok) {
    descriptionError.value = result.reason?.join(", ") ?? "설명 수정에 실패했습니다.";
    return;
  }
  selected.value = { ...selected.value, description: markdown };
}

async function merge() {
  if (!selected.value) return;
  merging.value = true;
  actionError.value = "";
  const result = await api.mergePullRequest(auth.apiKey!, props.owner, props.projectId, selected.value.id);
  merging.value = false;
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "머지에 실패했습니다.";
    return;
  }
  await load();
  await loadSelected(selected.value.id);
}

async function close() {
  if (!selected.value) return;
  closing.value = true;
  actionError.value = "";
  const result = await api.closePullRequest(auth.apiKey!, props.owner, props.projectId, selected.value.id);
  closing.value = false;
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "닫기에 실패했습니다.";
    return;
  }
  await load();
  await loadSelected(selected.value.id);
}

onMounted(async () => {
  await load();
  if (props.id) await loadSelected(props.id);
});
watch(() => [props.owner, props.projectId], load);
watch(
  () => props.id,
  (id) => {
    if (!id) {
      selected.value = null;
      return;
    }
    if (selected.value?.id === id) return;
    loadSelected(id);
  }
);
</script>
