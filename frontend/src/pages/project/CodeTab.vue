<template>
  <div class="row no-wrap" style="height: calc(100vh - 160px)">
    <div class="col-5 q-pa-sm" style="overflow-y: auto">
      <div class="row items-center q-gutter-sm q-mb-sm">
        <q-select v-model="branch" :options="branchNames" dense style="min-width: 160px" label="branch" @update:model-value="onBranchChange" />
        <q-btn v-if="path" flat dense icon="arrow_upward" @click="goUp" />
        <div class="text-caption">/{{ path }}</div>
      </div>

      <div v-if="branchNames.length === 0" class="text-caption" style="color: var(--gh-fg-muted)">
        저장소가 비어있습니다(아직 커밋이 없습니다) - Template 탭에서 배포하면 첫 커밋이 생깁니다.
      </div>
      <q-list v-else bordered separator>
        <q-item v-for="entry in entries" :key="entry.name" clickable @click="openEntry(entry)">
          <q-item-section avatar>
            <q-icon :name="entry.type === 'tree' ? 'folder' : 'description'" :color="entry.type === 'tree' ? 'amber-8' : 'grey-7'" />
          </q-item-section>
          <q-item-section>{{ entry.name }}</q-item-section>
        </q-item>
        <q-item v-if="entries.length === 0"><q-item-section class="text-caption">비어있는 디렉터리입니다.</q-item-section></q-item>
      </q-list>

      <div class="text-subtitle2 q-mt-md q-mb-sm">최근 커밋</div>
      <q-list bordered separator>
        <q-item v-for="c in commits" :key="c.id">
          <q-item-section>
            <q-item-label>{{ c.message }}</q-item-label>
            <q-item-label caption>{{ c.id.slice(0, 8) }} · {{ c.author }} · {{ new Date(c.time).toLocaleString() }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-item v-if="commits.length === 0"><q-item-section class="text-caption">커밋이 없습니다.</q-item-section></q-item>
      </q-list>
    </div>

    <q-separator vertical />

    <div class="col-7 q-pa-md" style="overflow-y: auto">
      <template v-if="selectedFile">
        <div class="text-subtitle1 q-mb-sm">{{ selectedFile.path }}</div>
        <div v-if="selectedFile.isBinary" class="text-caption">바이너리 파일이라 내용을 표시하지 않습니다({{ selectedFile.size }} bytes).</div>
        <div v-else-if="selectedFile.size === 0 && !selectedFile.content" class="text-caption">빈 파일입니다.</div>
        <pre v-else class="doc-source">{{ selectedFile.content }}</pre>
      </template>
      <!-- 설계자 요청(2026-09-20): 선택된 파일이 없고 루트에 README.md가 있으면 기본으로 보여준다. -->
      <template v-else-if="readmeState === 'found'">
        <div class="text-subtitle1 q-mb-sm">README.md</div>
        <MarkdownSourceView :content="readmeContent" @save="saveReadme" />
      </template>
      <template v-else-if="readmeState === 'missing'">
        <div class="text-caption q-mb-sm">이 브랜치 루트에 README.md가 없습니다.</div>
        <q-btn v-if="!creatingReadme" color="primary" icon="add" label="README.md 작성하기" @click="creatingReadme = true" />
        <MarkdownSourceView v-else content="" start-in-edit @save="saveReadme" @cancel="creatingReadme = false" />
      </template>
      <div v-else class="text-caption">왼쪽에서 파일을 선택하세요.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";

interface BranchInfo {
  name: string;
  tipCommitId: string | null;
}
interface TreeEntry {
  name: string;
  type: "blob" | "tree" | "other";
  oid: string;
}
interface CommitInfo {
  id: string;
  message: string;
  author: string;
  time: string;
}
interface FileContent {
  path: string;
  content: string;
  isBinary: boolean;
  size: number;
}

const props = defineProps<{ projectId: string }>();
const auth = useAuthStore();

const branchNames = ref<string[]>([]);
const branch = ref<string | null>(null);
const path = ref("");
const entries = ref<TreeEntry[]>([]);
const commits = ref<CommitInfo[]>([]);
const selectedFile = ref<FileContent | null>(null);

const readmeState = ref<"loading" | "found" | "missing" | "n/a">("loading");
const readmeContent = ref("");
const creatingReadme = ref(false);

async function loadBranches() {
  const result = await auth.run({ action: "repo.branches", projectId: props.projectId });
  if (result.ok) {
    const items = (result.data as { items: BranchInfo[] }).items;
    branchNames.value = items.map((b) => b.name);
    if (!branch.value && branchNames.value.length > 0) branch.value = branchNames.value[0] ?? null;
  }
}

async function loadTree() {
  if (!branch.value) {
    entries.value = [];
    return;
  }
  const result = await auth.run({ action: "repo.tree", projectId: props.projectId, branch: branch.value, path: path.value });
  if (result.ok) entries.value = (result.data as { items: TreeEntry[] }).items;
  await loadReadmeIfAtRoot();
}

// 설계자 요청(2026-09-20): 선택된 파일이 없을 때 "루트"에 README.md가
// 있으면 기본으로 보여준다 - 하위 디렉터리를 보는 중일 땐 이 README
// 처리 자체가 적용되지 않는다("이 브랜치에 README가 없다"는 문구가
// 하위 디렉터리 안에서도 뜨는 건 오해를 부른다), 그냥 "파일을
// 선택하세요"로 되돌아간다("n/a" 상태).
async function loadReadmeIfAtRoot() {
  creatingReadme.value = false;
  if (selectedFile.value || !branch.value) {
    readmeState.value = "n/a";
    return;
  }
  if (path.value) {
    readmeState.value = "n/a";
    return;
  }
  const hasReadme = entries.value.some((e) => e.type === "blob" && e.name === "README.md");
  if (!hasReadme) {
    readmeState.value = "missing";
    return;
  }
  const result = await auth.run({ action: "repo.file", projectId: props.projectId, branch: branch.value, path: "README.md" });
  if (result.ok) {
    readmeContent.value = (result.data as FileContent).content;
    readmeState.value = "found";
  } else {
    readmeState.value = "missing";
  }
}

async function saveReadme(markdown: string) {
  if (!branch.value) return;
  const result = await auth.run({
    action: "repo.writeFile",
    projectId: props.projectId,
    branch: branch.value,
    path: "README.md",
    content: markdown,
    message: readmeState.value === "found" ? "update README.md" : "add README.md",
  });
  if (result.ok) {
    creatingReadme.value = false;
    await loadTree();
    await loadCommits();
  }
}

async function loadCommits() {
  if (!branch.value) {
    commits.value = [];
    return;
  }
  const result = await auth.run({ action: "repo.commits", projectId: props.projectId, branch: branch.value, limit: 10 });
  if (result.ok) commits.value = (result.data as { items: CommitInfo[] }).items;
}

function onBranchChange() {
  path.value = "";
  selectedFile.value = null;
  loadTree();
  loadCommits();
}

async function openEntry(entry: TreeEntry) {
  if (!branch.value) return;
  const entryPath = path.value ? `${path.value}/${entry.name}` : entry.name;
  if (entry.type === "tree") {
    path.value = entryPath;
    selectedFile.value = null;
    await loadTree();
    return;
  }
  const result = await auth.run({ action: "repo.file", projectId: props.projectId, branch: branch.value, path: entryPath });
  if (result.ok) selectedFile.value = { path: entryPath, ...(result.data as Omit<FileContent, "path">) };
}

function goUp() {
  const parts = path.value.split("/");
  parts.pop();
  path.value = parts.join("/");
  selectedFile.value = null;
  loadTree();
}

onMounted(async () => {
  await loadBranches();
  await loadTree();
  await loadCommits();
});
</script>

<style scoped>
.doc-source {
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0, 0, 0, 0.04);
  padding: 12px;
  border-radius: 4px;
  font-family: monospace;
}
</style>
