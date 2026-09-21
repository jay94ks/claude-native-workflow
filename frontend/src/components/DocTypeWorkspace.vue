<template>
  <div class="row no-wrap" style="min-height: calc(100vh - 160px)">
    <ProjectSidebar>
      <div class="row items-center justify-between q-mb-sm">
        <div class="text-subtitle1">{{ title }} ({{ items.length }})</div>
        <q-btn v-if="!readOnly" size="sm" color="primary" icon="add" :label="createLabel" :to="createRoute" />
      </div>
      <!-- design-notes.md "문서 의존성" - dependsOn readiness(아직 해소되지
           않은 의존 개수) 오름차순 정렬을 docs.list의 sort 옵션으로 노출. -->
      <q-toggle v-model="sortByDependency" label="의존성 순 정렬" dense size="sm" class="q-mb-sm" @update:model-value="load" />
      <q-list bordered separator>
        <q-item
          v-for="doc in items"
          :key="doc.code"
          clickable
          :active="selected?.code === doc.code"
          active-class="bg-blue-1"
          @click="select(doc.code)"
        >
          <q-item-section>
            <q-item-label>{{ doc.title }}</q-item-label>
            <q-item-label caption>{{ doc.code }} · {{ doc.kind }} · {{ doc.chapter ?? "-" }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge :color="stateColor(doc.state)">{{ doc.state }}</q-badge>
          </q-item-section>
        </q-item>
        <q-item v-if="items.length === 0">
          <q-item-section class="text-caption">문서가 없습니다.</q-item-section>
        </q-item>
      </q-list>
    </ProjectSidebar>

    <q-separator vertical />

    <div class="col q-pa-md" style="overflow-y: auto">
      <template v-if="selected">
        <div class="row items-center justify-between">
          <div class="text-h6">{{ selected.title }}</div>
          <q-badge :color="stateColor(selected.state)">{{ selected.state }}</q-badge>
        </div>
        <div class="text-caption q-mb-sm">
          {{ selected.code }} · author: {{ selected.author }} · etag: {{ selected.etag }}
          <span v-if="selected.chapter"> · chapter: {{ selected.chapter }}</span>
        </div>

        <!-- design-notes.md "문서간 참조"/"의존성" - related/dependsOn을 태그
             배지로 보여주고, 클릭하면(다른 type이어도) 그 문서로 바로 이동한다. -->
        <div class="q-gutter-xs q-mb-sm">
          <q-badge
            v-for="ref in selected.related"
            :key="'related-' + ref.code"
            outline
            color="primary"
            class="cursor-pointer"
            @click="select(ref.code)"
          >
            related: {{ ref.code }}
          </q-badge>
          <q-badge
            v-for="ref in selected.dependsOn"
            :key="'dependsOn-' + ref.code"
            outline
            color="deep-orange"
            class="cursor-pointer"
            @click="select(ref.code)"
          >
            dependsOn: {{ ref.code }}
          </q-badge>
          <q-btn v-if="!readOnly" size="sm" dense flat icon="add_link" label="태그 추가" @click="openTagDialog" />
        </div>

        <div v-if="!readOnly" class="q-gutter-sm q-mb-md">
          <q-btn
            v-for="t in availableTransitions"
            :key="t.to"
            size="sm"
            :color="t.color ?? 'primary'"
            :label="t.label"
            :loading="transitioning === t.to"
            @click="transition(t.to)"
          />
        </div>
        <div v-if="actionError" class="text-negative text-caption q-mb-sm">{{ actionError }}</div>

        <div class="text-caption text-grey-8 q-mb-xs">Source View</div>
        <MarkdownSourceView :key="selected.code" :content="selected.content" :read-only="readOnly" @save="saveContent" />

        <q-separator class="q-my-md" />
        <!-- design-notes.md "UI 설계" - question/answer/opinion은 별도 Q&A 탭이
             아니라 PR 리뷰 코멘트처럼 그 문서를 보는 화면 안에 통합된다. -->
        <DocumentDiscussion ref="discussionRef" :owner="owner" :project-id="projectId" :parent-code="selected.code" :highlight-code="highlightCode" />
      </template>
      <div v-else class="text-caption">왼쪽에서 문서를 선택하세요.</div>
    </div>

    <q-dialog v-model="showTagDialog">
      <q-card style="width: 420px">
        <q-card-section class="text-h6">태그 추가</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-select v-model="tagKind" :options="['related', 'dependsOn']" label="종류" />
          <q-input v-model="tagCode" label="대상 추적 코드 (예: SP-XXXXXXXX)" />
          <div v-if="tagError" class="text-negative text-caption">{{ tagError }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn color="primary" label="추가" :loading="tagging" @click="addTag" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import DocumentDiscussion from "components/DocumentDiscussion.vue";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import ProjectSidebar from "components/ProjectSidebar.vue";
import * as api from "src/api/client";

interface TaggedRef {
  code: string;
  etag: string;
}
interface DocSummary {
  code: string;
  parent_id: string | null;
  etag: string;
  type: string;
  kind: string;
  state: string;
  chapter: string | null;
  title: string;
  author: string;
  related: TaggedRef[];
  dependsOn: TaggedRef[];
}
interface DocFull extends DocSummary {
  content: string;
}
interface TransitionOption {
  to: string;
  label: string;
  color?: string;
}

const props = withDefaults(
  defineProps<{
    owner: string;
    projectId: string;
    type: string;
    kinds: string[];
    title: string;
    createLabel?: string;
    createRoute?: string;
    readOnly?: boolean;
    transitionsByState?: Record<string, TransitionOption[]>;
    // 설계자 요청(2026-09-21 후속) - 지금 선택된 문서의 추적 코드를
    // /{owner}/{projectId}/{documents|plans|issues}/{code} path segment로
    // 반영해 Browser History/새로고침에서 그 상태가 살아남게 한다.
    // RecentQaFeed에서 넘어올 때도(예전엔 ?open=으로만 왔음) 이제 이
    // prop이 곧 그 path segment 값이다 - trackers/tests는 이번 스코프
    // 밖이라 여전히 query(open=)로만 넘어온다(URL_SYNCED_TYPES에
    // "tracker"/"test"가 없어서 select()가 자동으로 push를 건너뛴다).
    code?: string;
    highlightCode?: string;
  }>(),
  { readOnly: false, createLabel: "새로 만들기", createRoute: "", transitionsByState: () => ({}) }
);

// design-notes.md 참고 - "관련 문서"(related/dependsOn)는 타입이 달라도
// 서로 참조할 수 있다(예: Plan에서 Document를 참조) - select()가 그
// 대상의 실제 type을 보고 맞는 tab의 URL로 이동시킨다(지금 보고 있는
// tab의 URL을 그대로 쓰면 다른 타입인데 documents/plans/issues 셋
// 다 이 컴포넌트를 그대로 재사용하므로, 실제로 화면이 바뀌는 게 아니라
// "잘못된 탭의 URL에 다른 타입 문서가 얹힌" 것처럼 보이는 버그가 된다).
const URL_SYNCED_TYPES: Record<string, string> = { doc: "documents", plan: "plans", issue: "issues" };

const router = useRouter();
const auth = useAuthStore();
const items = ref<DocSummary[]>([]);
const selected = ref<DocFull | null>(null);
const transitioning = ref<string | null>(null);
const actionError = ref("");

function stateColor(state: string): string {
  if (state === "done" || state === "ended") return "positive";
  if (state === "discard" || state === "canceled") return "grey-6";
  if (state === "active" || state === "resumed") return "orange";
  return "primary";
}

const sortByDependency = ref(false);

async function load() {
  const result = await api.listDocuments(auth.apiKey!, props.owner, props.projectId, {
    type: props.type,
    sort: sortByDependency.value ? "dependency" : undefined,
  });
  if (result.ok) items.value = (result.data as { items: DocSummary[] }).items;
}

async function loadSelected(code: string) {
  actionError.value = "";
  const result = await api.getDocument(auth.apiKey!, props.owner, props.projectId, code);
  if (result.ok) selected.value = result.data as DocFull;
}

async function select(code: string) {
  await loadSelected(code);
  if (!selected.value) return;
  const segment = URL_SYNCED_TYPES[selected.value.type];
  if (segment) router.push(`/${props.owner}/${props.projectId}/${segment}/${code}`);
}

const availableTransitions = ref<TransitionOption[]>([]);
watch(selected, (doc) => {
  availableTransitions.value = doc ? props.transitionsByState[doc.state] ?? [] : [];
});

async function transition(to: string) {
  if (!selected.value) return;
  transitioning.value = to;
  actionError.value = "";
  // docs.transition의 실제 계약: etag가 아니라 "지금 이 상태일 거라
  // 예상한다"는 현재 상태 문자열로 낙관적 동시성을 건다.
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, selected.value.code, to, selected.value.state);
  transitioning.value = null;
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "전이에 실패했습니다.";
    return;
  }
  await load();
  await loadSelected(selected.value.code);
}

// design-notes.md 후속 판단(설계자 요청) - "Source View"는 view/edit 두
// 모드를 가진 것으로 정의됐다(MarkdownSourceView) - 기존 문서의 본문도
// 여기서 바로 편집해 docs.update로 저장할 수 있다.
async function saveContent(markdown: string) {
  if (!selected.value) return;
  actionError.value = "";
  const result = await api.updateDocument(auth.apiKey!, props.owner, props.projectId, selected.value.code, { etag: selected.value.etag, content: markdown });
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "저장에 실패했습니다.";
    return;
  }
  await load();
  await loadSelected(selected.value.code);
}

const showTagDialog = ref(false);
const tagKind = ref<"related" | "dependsOn">("related");
const tagCode = ref("");
const tagging = ref(false);
const tagError = ref("");

function openTagDialog() {
  tagCode.value = "";
  tagError.value = "";
  showTagDialog.value = true;
}

// docs.tag는 related/dependsOn을 "전체 교체"로 받으므로(design-notes.md
// "문서간 참조" - 항목 하나만 추가/제거하는 액션이 아니다), 대상의 최신
// etag를 docs.get으로 확인한 뒤 지금 배열에 이어붙여서 다시 통째로 보낸다.
async function addTag() {
  if (!selected.value) return;
  tagging.value = true;
  tagError.value = "";

  const targetResult = await api.getDocument(auth.apiKey!, props.owner, props.projectId, tagCode.value);
  if (!targetResult.ok) {
    tagging.value = false;
    tagError.value = targetResult.reason?.join(", ") ?? "대상 문서를 찾을 수 없습니다.";
    return;
  }
  const target = targetResult.data as { code: string; etag: string };

  const nextRelated = tagKind.value === "related" ? [...selected.value.related, { code: target.code, etag: target.etag }] : undefined;
  const nextDependsOn = tagKind.value === "dependsOn" ? [...selected.value.dependsOn, { code: target.code, etag: target.etag }] : undefined;

  const result = await api.tagDocument(auth.apiKey!, props.owner, props.projectId, selected.value.code, {
    etag: selected.value.etag,
    related: nextRelated,
    dependsOn: nextDependsOn,
  });
  tagging.value = false;
  if (!result.ok) {
    tagError.value = result.reason?.join(", ") ?? "태그 추가에 실패했습니다.";
    return;
  }
  showTagDialog.value = false;
  await loadSelected(selected.value.code);
}

onMounted(async () => {
  await load();
  if (props.code) await loadSelected(props.code);
});
watch(() => [props.owner, props.projectId], load);
// 브라우저 뒤로/앞으로 가기 - path의 :code가 바뀌면 그에 맞는 문서를
// 다시 불러온다. select()가 이미 방금 반영해둔 경우(사용자가 방금
// 클릭해서 router.push가 스스로 이 변화를 일으킨 경우)는 중복 조회를
// 건너뛴다.
watch(
  () => props.code,
  (code) => {
    if (!code) {
      selected.value = null;
      return;
    }
    if (selected.value?.code === code) return;
    loadSelected(code);
  }
);
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
