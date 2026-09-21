<template>
  <div class="row no-wrap" style="min-height: calc(100vh - 160px)">
    <ProjectSidebar>
      <div class="row items-center q-gutter-sm q-mb-sm">
        <q-btn flat dense round icon="arrow_back" :to="`/${owner}/${projectId}/commits?branch=${branch}`" />
        <div class="text-subtitle1">커밋</div>
      </div>
      <div v-if="commit" class="q-mb-md">
        <div class="text-body2">{{ commit.message }}</div>
        <div class="text-caption" style="color: var(--gh-fg-muted)">{{ commit.id.slice(0, 8) }} · {{ commit.author }} · {{ new Date(commit.time).toLocaleString() }}</div>
      </div>

      <div class="text-subtitle2 q-mb-sm">변경된 파일 ({{ files.length }})</div>
      <q-tree :nodes="fileTree" node-key="nodeKey" :selected="selectedPath" @update:selected="onTreeSelect" default-expand-all>
        <template #default-header="scope">
          <div class="row items-center" style="gap: 4px">
            <q-icon :name="scope.node.isFile ? 'description' : 'folder'" :color="scope.node.isFile ? 'grey-7' : 'amber-8'" size="16px" />
            <span>{{ scope.node.label }}</span>
            <q-badge v-if="scope.node.status" outline dense>{{ scope.node.status }}</q-badge>
          </div>
        </template>
      </q-tree>
      <EmptyState v-if="files.length === 0" message="변경된 파일이 없습니다." />
    </ProjectSidebar>

    <q-separator vertical />

    <div class="col q-pa-md" style="overflow-y: auto">
      <div v-if="loading" class="text-caption">불러오는 중...</div>
      <template v-else-if="commit">
        <DiffViewer
          v-if="selectedPath"
          :owner="owner"
          :project-id="projectId"
          :base="baseCommitId ?? ''"
          :head="commitId"
          :branch="branch"
          :path="selectedPath"
        />
        <div v-else class="text-caption" style="color: var(--gh-fg-muted)">왼쪽 파일 트리에서 파일을 선택하세요.</div>
      </template>
      <div v-else class="text-negative text-caption">커밋을 찾을 수 없습니다.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useAuthStore } from "stores/auth";
import ProjectSidebar from "components/ProjectSidebar.vue";
import DiffViewer from "components/DiffViewer.vue";
import EmptyState from "components/EmptyState.vue";
import * as api from "src/api/client";
import { buildFileTree } from "src/utils/fileTree";

interface DiffFile {
  path: string;
  oldPath: string | null;
  status: string;
}
interface CommitInfo {
  id: string;
  message: string;
  author: string;
  time: string;
}

// 설계자 요청(2026-09-21, 항목 10) - 코드 탭 파일별 "Recent Commits"
// 탭이나 브랜치 커밋 목록에서 커밋 하나를 누르면 Pull Requests의 diff
// 뷰어 페이지와 동일한 내용을 보여주는 별도 페이지.
const props = defineProps<{ owner: string; projectId: string; branch: string; commitId: string }>();
const auth = useAuthStore();

const loading = ref(true);
const commit = ref<CommitInfo | null>(null);
const files = ref<DiffFile[]>([]);
const baseCommitId = ref<string | null>(null);
const selectedPath = ref<string | null>(null);

const fileTree = computed(() => buildFileTree(files.value));

function onTreeSelect(key: string | number | null) {
  if (typeof key !== "string") return;
  const isFile = files.value.some((f) => f.path === key);
  if (isFile) selectedPath.value = key;
}

async function load() {
  loading.value = true;
  selectedPath.value = null;
  const [diffResult, infoResult] = await Promise.all([
    api.getCommitDiff(auth.apiKey!, props.owner, props.projectId, props.commitId),
    api.getCommitInfo(auth.apiKey!, props.owner, props.projectId, props.commitId),
  ]);
  if (diffResult.ok && infoResult.ok) {
    const data = diffResult.data as { files: DiffFile[]; patch: string; baseCommitId: string | null };
    files.value = data.files;
    baseCommitId.value = data.baseCommitId;
    commit.value = infoResult.data as CommitInfo;
  } else {
    commit.value = null;
  }
  loading.value = false;
}

onMounted(load);
watch(() => [props.owner, props.projectId, props.commitId], load);
</script>
