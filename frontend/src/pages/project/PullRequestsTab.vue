<template>
  <div class="row no-wrap" style="height: calc(100vh - 160px)">
    <div class="col-5 q-pa-sm" style="overflow-y: auto">
      <div class="row items-center justify-between q-mb-sm">
        <div class="text-subtitle1">Pull requests ({{ items.length }})</div>
        <q-btn size="sm" color="primary" icon="add" label="새 PR" :to="`/projects/${projectId}/pull-requests/new`" />
      </div>
      <q-list bordered separator>
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
        <q-item v-if="items.length === 0"><q-item-section class="text-caption">Pull request가 없습니다.</q-item-section></q-item>
      </q-list>
    </div>

    <q-separator vertical />

    <div class="col-7 q-pa-md" style="overflow-y: auto">
      <template v-if="selected">
        <div class="row items-center justify-between">
          <div class="text-h6">{{ selected.title }}</div>
          <q-badge :color="stateColor(selected.state)">{{ selected.state }}</q-badge>
        </div>
        <div class="text-caption q-mb-sm">{{ selected.sourceBranch }} → {{ selected.targetBranch }} · author: {{ selected.author }}</div>
        <div v-if="selected.description" class="text-body2 q-mb-md">{{ selected.description }}</div>

        <div v-if="selected.state === 'open'" class="q-gutter-sm q-mb-md">
          <q-btn size="sm" color="positive" label="Merge" :loading="merging" @click="merge" />
          <q-btn size="sm" color="negative" outline label="Close" :loading="closing" @click="close" />
        </div>
        <div v-if="actionError" class="text-negative text-caption q-mb-sm">{{ actionError }}</div>
        <div v-if="selected.mergeCommitId" class="text-caption q-mb-sm">merge commit: {{ selected.mergeCommitId }}</div>

        <div class="text-subtitle2 q-mb-xs">변경된 파일 ({{ selected.diff.files.length }})</div>
        <q-list bordered separator dense class="q-mb-md">
          <q-item v-for="f in selected.diff.files" :key="f.path">
            <q-item-section>{{ f.path }}</q-item-section>
            <q-item-section side><q-badge outline>{{ f.status }}</q-badge></q-item-section>
          </q-item>
          <q-item v-if="selected.diff.files.length === 0"><q-item-section class="text-caption">변경된 파일이 없습니다.</q-item-section></q-item>
        </q-list>

        <div class="text-subtitle2 q-mb-xs">Diff</div>
        <pre class="doc-source">{{ selected.diff.patch || "(빈 diff)" }}</pre>
      </template>
      <div v-else class="text-caption">왼쪽에서 PR을 선택하세요.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useAuthStore } from "stores/auth";

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
const props = defineProps<{ projectId: string }>();
const auth = useAuthStore();

const items = ref<PrSummary[]>([]);
const selected = ref<PrFull | null>(null);
const actionError = ref("");
const merging = ref(false);
const closing = ref(false);

function stateColor(state: string): string {
  if (state === "merged") return "positive";
  if (state === "closed") return "grey-6";
  return "primary";
}

async function load() {
  const result = await auth.run({ action: "pr.list", projectId: props.projectId });
  if (result.ok) items.value = (result.data as { items: PrSummary[] }).items;
}

async function select(id: string) {
  actionError.value = "";
  const result = await auth.run({ action: "pr.get", projectId: props.projectId, id });
  if (result.ok) selected.value = result.data as PrFull;
}

async function merge() {
  if (!selected.value) return;
  merging.value = true;
  actionError.value = "";
  const result = await auth.run({ action: "pr.merge", projectId: props.projectId, id: selected.value.id });
  merging.value = false;
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "머지에 실패했습니다.";
    return;
  }
  await load();
  await select(selected.value.id);
}

async function close() {
  if (!selected.value) return;
  closing.value = true;
  actionError.value = "";
  const result = await auth.run({ action: "pr.close", projectId: props.projectId, id: selected.value.id });
  closing.value = false;
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "닫기에 실패했습니다.";
    return;
  }
  await load();
  await select(selected.value.id);
}

onMounted(load);
watch(() => props.projectId, load);
</script>

<style scoped>
.doc-source {
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0, 0, 0, 0.04);
  padding: 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  max-height: 400px;
  overflow-y: auto;
}
</style>
