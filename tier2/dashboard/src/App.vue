<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { client, type TreeNode, type DocListItem, type PendingItem, type ChangeNotice, type DocDetail } from "./api";
import DocTree from "./components/DocTree.vue";
import DocViewer from "./components/DocViewer.vue";
import ReplyDialog from "./components/ReplyDialog.vue";

const tree = ref<TreeNode | null>(null);
const selectedPath = ref<string | null>(null);
const currentDoc = ref<DocDetail | null>(null);
const tab = ref<"tree" | "design" | "logs">("tree");
const designList = ref<DocListItem[]>([]);
const logsList = ref<DocListItem[]>([]);
const changes = ref<ChangeNotice[]>([]);
// DocViewer only reloads when its `path` prop changes - a reply/save on the
// doc that's already open doesn't change the path, so bumping this into its
// :key forces a remount to pick up the fresh content (found by actually
// clicking through the reply flow: the sidebar updated but the open panel
// kept showing the old "답변 대기" state until this was added).
const viewerRefreshKey = ref(0);

const replyOpen = ref(false);
const replyItem = ref<PendingItem | null>(null);

const gitBusy = ref(false);

async function refreshTree() {
  tree.value = await client.tree();
}

async function refreshChanges() {
  changes.value = await client.changes();
}

async function refreshLists() {
  const [d, l] = await Promise.all([client.design(), client.logs()]);
  designList.value = d;
  logsList.value = l;
}

function select(path: string) {
  selectedPath.value = path;
}

async function onReply(item: PendingItem) {
  if (!selectedPath.value) return;
  currentDoc.value = await client.doc(selectedPath.value);
  replyItem.value = item;
  replyOpen.value = true;
}

async function afterReplySubmitted() {
  viewerRefreshKey.value++;
  await Promise.all([refreshTree(), refreshLists(), refreshChanges()]);
}

async function ackChange(id: number) {
  await client.ackChange(id);
  await refreshChanges();
}

async function runGitSync() {
  gitBusy.value = true;
  try {
    await client.gitSync();
    await Promise.all([refreshTree(), refreshLists(), refreshChanges()]);
  } finally {
    gitBusy.value = false;
  }
}

const currentLinks = computed(() => currentDoc.value?.meta.links ?? []);

onMounted(async () => {
  await Promise.all([refreshTree(), refreshLists(), refreshChanges()]);
});
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title>docs 대시보드 (Tier 2)</q-toolbar-title>
        <q-btn flat dense icon="sync" label="git sync" :loading="gitBusy" @click="runGitSync" />
      </q-toolbar>
      <div v-if="changes.length" class="bg-warning text-black q-pa-xs row items-center q-gutter-sm">
        <q-icon name="info" />
        <span class="text-caption">확인 안 된 변경 {{ changes.length }}건</span>
        <q-chip
          v-for="c in changes"
          :key="c.id"
          removable
          dense
          @remove="ackChange(c.id)"
        >
          {{ c.doc_path }} ({{ c.source }}) - {{ c.summary }}
        </q-chip>
      </div>
    </q-header>

    <q-drawer show-if-above :width="320" side="left" bordered>
      <q-tabs v-model="tab" dense class="text-grey-7" active-color="primary" indicator-color="primary">
        <q-tab name="tree" label="문서" />
        <q-tab name="design" label="설계" />
        <q-tab name="logs" label="기록" />
      </q-tabs>
      <q-separator />
      <q-tab-panels v-model="tab" animated class="bg-transparent">
        <q-tab-panel name="tree" class="q-pa-none">
          <DocTree v-if="tree" :node="tree" :selected-path="selectedPath ?? undefined" @select="select" />
        </q-tab-panel>
        <q-tab-panel name="design" class="q-pa-none">
          <q-list separator>
            <q-item v-for="d in designList" :key="d.path" clickable :active="d.path === selectedPath" @click="select(d.path)">
              <q-item-section avatar style="min-width: 28px"><q-badge color="grey-6" outline>{{ d.type }}</q-badge></q-item-section>
              <q-item-section>
                <q-item-label lines="1">{{ d.title }}</q-item-label>
                <q-item-label caption>
                  {{ d.id }} · {{ d.status }}
                  <q-icon v-if="d.reply_pending" name="help_outline" color="warning" size="14px" />
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-tab-panel>
        <q-tab-panel name="logs" class="q-pa-none">
          <q-list separator>
            <q-item v-for="d in logsList" :key="d.path" clickable :active="d.path === selectedPath" @click="select(d.path)">
              <q-item-section>
                <q-item-label lines="1">{{ d.id }} → {{ d.target }}</q-item-label>
                <q-item-label caption>{{ d.updated }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-tab-panel>
      </q-tab-panels>
    </q-drawer>

    <q-page-container>
      <q-page class="q-pa-md">
        <DocViewer
          v-if="selectedPath"
          :key="`${selectedPath}:${viewerRefreshKey}`"
          :path="selectedPath"
          @reply="onReply"
          @changed="afterReplySubmitted"
        />
        <div v-else class="text-grey-6 text-center q-pa-xl">왼쪽 트리에서 문서를 선택하세요.</div>
      </q-page>
    </q-page-container>

    <ReplyDialog
      v-model="replyOpen"
      :item="replyItem"
      :current-doc-links="currentLinks"
      @submitted="afterReplySubmitted"
    />
  </q-layout>
</template>
