<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import {
  client, configureApi,
  type TreeNode, type DocListItem, type PendingItem, type ChangeNotice, type DocDetail,
} from "../../../../tier2/dashboard/src/api";
import DocTree from "../../../../tier2/dashboard/src/components/DocTree.vue";
import DocViewer from "../../../../tier2/dashboard/src/components/DocViewer.vue";
import ReplyDialog from "../../../../tier2/dashboard/src/components/ReplyDialog.vue";
import MembersView from "./MembersView.vue";
import type { Project } from "../api3";

// SP-00002 8절: 문서 조회/편집 화면 자체는 SP-00001과 동일하다 - 여기서
// 새로 만들지 않고 tier2/dashboard의 컴포넌트+api 클라이언트를 그대로
// import해서 쓴다. configureApi로 이 프로젝트 네임스페이스 + 로그인
// 토큰만 주입하면, DocTree/DocViewer/ReplyDialog는 자기가 tier2용인지
// tier3용인지 전혀 몰라도 된다.
const props = defineProps<{ token: string; project: Project }>();
const emit = defineEmits<{ switchProject: [] }>();

configureApi({ basePath: `/api/projects/${props.project.id}`, authToken: props.token });
watch(() => props.token, (t) => configureApi({ authToken: t }));

const tree = ref<TreeNode | null>(null);
const selectedPath = ref<string | null>(null);
const currentDoc = ref<DocDetail | null>(null);
const tab = ref<"tree" | "design" | "logs">("tree");
const designList = ref<DocListItem[]>([]);
const logsList = ref<DocListItem[]>([]);
const changes = ref<ChangeNotice[]>([]);
const viewerRefreshKey = ref(0);
const showMembers = ref(false);

const replyOpen = ref(false);
const replyItem = ref<PendingItem | null>(null);
const gitBusy = ref(false);

const canEdit = computed(() => props.project.role === "editor" || props.project.role === "owner");

async function refreshTree() { tree.value = await client.tree(); }
async function refreshChanges() { changes.value = await client.changes(); }
async function refreshLists() {
  const [d, l] = await Promise.all([client.design(), client.logs()]);
  designList.value = d;
  logsList.value = l;
}

function select(path: string) { selectedPath.value = path; }

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

async function runGitPull() {
  gitBusy.value = true;
  try {
    await client.gitPull();
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
        <q-toolbar-title>
          docs 대시보드 (Tier 3) · {{ project.name }}
          <q-badge outline class="q-ml-sm">{{ project.role }}</q-badge>
        </q-toolbar-title>
        <q-btn flat dense icon="group" label="멤버" @click="showMembers = !showMembers" />
        <q-btn flat dense icon="sync" label="pull" :loading="gitBusy" @click="runGitPull" />
        <q-btn flat dense icon="swap_horiz" label="프로젝트 변경" @click="emit('switchProject')" />
      </q-toolbar>
      <div v-if="changes.length" class="bg-warning text-black q-pa-xs row items-center q-gutter-sm">
        <q-icon name="info" />
        <span class="text-caption">확인 안 된 변경 {{ changes.length }}건</span>
        <q-chip v-for="c in changes" :key="c.id" removable dense @remove="ackChange(c.id)">
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
        <MembersView v-if="showMembers" :token="token" :project-id="project.id" :my-role="project.role" />
        <template v-else>
          <DocViewer
            v-if="selectedPath"
            :key="`${selectedPath}:${viewerRefreshKey}`"
            :path="selectedPath"
            @reply="onReply"
            @changed="afterReplySubmitted"
          />
          <div v-else class="text-grey-6 text-center q-pa-xl">왼쪽 트리에서 문서를 선택하세요.</div>
        </template>
      </q-page>
    </q-page-container>

    <ReplyDialog
      v-if="canEdit"
      v-model="replyOpen"
      :item="replyItem"
      :current-doc-links="currentLinks"
      @submitted="afterReplySubmitted"
    />
  </q-layout>
</template>
