<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { client, type TreeNode, type DocListItem, type PendingItem, type ChangeNotice, type DocDetail, type SearchResult, type Violation } from "./api";
import DocTree from "./components/DocTree.vue";
import DocViewer from "./components/DocViewer.vue";
import ReplyDialog from "./components/ReplyDialog.vue";

const tree = ref<TreeNode | null>(null);
const selectedPath = ref<string | null>(null);
const currentDoc = ref<DocDetail | null>(null);
const tab = ref<"tree" | "design" | "logs" | "pending">("tree");
const designList = ref<DocListItem[]>([]);
const logsList = ref<DocListItem[]>([]);
const allPending = ref<PendingItem[]>([]);
const changes = ref<ChangeNotice[]>([]);
const changedPaths = computed(() => new Set(changes.value.map((c) => c.doc_path)));

const searchQuery = ref("");
const searchResults = ref<SearchResult[] | null>(null);
let searchDebounce: ReturnType<typeof setTimeout> | undefined;
watch(searchQuery, (q) => {
  clearTimeout(searchDebounce);
  if (!q.trim()) { searchResults.value = null; return; }
  searchDebounce = setTimeout(async () => {
    searchResults.value = await client.search(q.trim());
  }, 250);
});

const validateOpen = ref(false);
const validateBusy = ref(false);
const violations = ref<Violation[]>([]);
async function runValidate() {
  validateBusy.value = true;
  try {
    violations.value = await client.validate();
    validateOpen.value = true;
  } finally {
    validateBusy.value = false;
  }
}
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
  const [d, l, p] = await Promise.all([client.design(), client.logs(), client.pending()]);
  designList.value = d;
  logsList.value = l;
  allPending.value = p;
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

// 답변 대기 탭 카드는 문서를 열 필요 없이 곧장 답변 다이얼로그로 - DocViewer가
// 열려야 currentDoc(참고 문서 links)을 채우는 onReply와 별개 경로.
async function onReplyFromPendingTab(item: PendingItem) {
  select(item.doc_path);
  currentDoc.value = await client.doc(item.doc_path);
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
        <q-btn flat dense icon="fact_check" label="검증" :loading="validateBusy" @click="runValidate" />
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
      <div class="q-pa-sm">
        <q-input v-model="searchQuery" dense outlined placeholder="검색..." clearable>
          <template #prepend><q-icon name="search" /></template>
        </q-input>
      </div>

      <template v-if="searchResults">
        <q-list separator>
          <q-item v-for="r in searchResults" :key="r.path" clickable @click="select(r.path)">
            <q-item-section>
              <q-item-label lines="1">{{ r.id }} · {{ r.title || "(제목 없음)" }}</q-item-label>
              <q-item-label caption lines="1">…{{ r.snippet }}…</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="!searchResults.length"><q-item-section class="text-grey-6">검색 결과가 없습니다.</q-item-section></q-item>
        </q-list>
      </template>

      <template v-else>
        <q-tabs v-model="tab" dense class="text-grey-7" active-color="primary" indicator-color="primary">
          <q-tab name="tree" label="문서" />
          <q-tab name="design" label="설계" />
          <q-tab name="logs" label="기록" />
          <q-tab name="pending" label="답변 대기" />
        </q-tabs>
        <q-separator />
        <q-tab-panels v-model="tab" animated class="bg-transparent">
          <q-tab-panel name="tree" class="q-pa-none">
            <DocTree v-if="tree" :node="tree" :selected-path="selectedPath ?? undefined" :changed-paths="changedPaths" @select="select" />
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
          <q-tab-panel name="pending" class="q-pa-none">
            <q-list separator>
              <q-item v-for="p in allPending" :key="`${p.doc_path}:${p.question_id}`" clickable @click="onReplyFromPendingTab(p)">
                <q-item-section avatar><q-icon name="help_outline" color="warning" /></q-item-section>
                <q-item-section>
                  <q-item-label lines="1">{{ p.title || p.doc_path }}</q-item-label>
                  <q-item-label caption lines="2">(Q{{ p.question_id }}) {{ p.question }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="!allPending.length"><q-item-section class="text-grey-6">답변 대기 중인 질문이 없습니다.</q-item-section></q-item>
            </q-list>
          </q-tab-panel>
        </q-tab-panels>
      </template>
    </q-drawer>

    <q-dialog v-model="validateOpen">
      <q-card style="min-width: 420px; max-width: 90vw">
        <q-card-section class="text-h6">구조 검증 결과</q-card-section>
        <q-card-section v-if="!violations.length" class="text-positive">모든 문서가 유효합니다.</q-card-section>
        <q-card-section v-else style="max-height: 60vh; overflow: auto">
          <div v-for="(v, i) in violations" :key="i" class="q-mb-sm">
            <div class="text-weight-bold">{{ v.path }}</div>
            <div class="text-caption text-grey-8">[{{ v.rule }}] {{ v.field }} - {{ v.message }}</div>
          </div>
        </q-card-section>
        <q-card-actions align="right"><q-btn flat label="닫기" v-close-popup /></q-card-actions>
      </q-card>
    </q-dialog>

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
