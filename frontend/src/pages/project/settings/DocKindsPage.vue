<template>
  <div style="max-width: var(--gh-page-width-wide); margin: 0 auto">
    <PageHeader variant="settings" title="문서 분류" caption="Documents(doc 타입)의 분류(kind)를 이 프로젝트 안에서 추가/수정하고, 분류별 지침을 관리합니다." />

    <div class="row justify-end q-mb-sm">
      <q-btn color="primary" icon="add" label="새 분류 추가" @click="openCreate" />
    </div>

    <q-list bordered separator>
      <q-item v-for="k in kinds" :key="k.code">
        <q-item-section>
          <q-item-label>
            <CategoryPill>{{ k.code }}</CategoryPill>
            {{ k.label }}
            <q-badge v-if="k.builtin" color="grey-6" class="q-ml-xs">기본</q-badge>
          </q-item-label>
          <q-item-label caption v-if="k.guideline" class="ellipsis">{{ k.guideline }}</q-item-label>
          <q-item-label caption v-else>지침 없음</q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="row q-gutter-xs">
            <q-btn dense flat color="primary" label="수정" @click="openEdit(k)" />
            <q-btn dense flat color="negative" :label="k.builtin ? '초기화' : '삭제'" @click="removeKind(k)" />
          </div>
        </q-item-section>
      </q-item>
      <EmptyState v-if="kinds.length === 0" as="item" message="분류가 없습니다." />
    </q-list>
    <div v-if="loadError" class="text-negative text-caption q-mt-sm">{{ loadError }}</div>

    <q-dialog v-model="dialogOpen">
      <q-card style="width: var(--gh-dialog-width-lg)">
        <q-card-section class="text-h6">{{ editingCode ? "분류 수정" : "새 분류 추가" }}</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input v-model="draftCode" label="코드 (대문자 2~3자, 예: DG)" dense :readonly="!!editingCode" />
          <q-input v-model="draftLabel" label="이름" dense />
          <div>
            <div class="text-caption q-mb-xs" style="color: var(--gh-fg-muted)">지침 (클로드/architect 둘 다 볼 수 있습니다)</div>
            <MarkdownSourceView :key="editingCode ?? 'new'" ref="guidelineEditorRef" :content="draftGuideline" start-in-edit hide-toolbar :edit-min-height="200" />
          </div>
          <div v-if="dialogError" class="text-negative text-caption">{{ dialogError }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn color="primary" label="저장" :loading="saving" @click="save" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
// design-notes.md "문서 분류(kind) 추가/수정 + 분류별 지침 관리" - doc
// 타입(SP/RP/RM/QA/BT)의 기본 5개는 하드코딩된 기본값 위에, 이 프로젝트가
// 직접 등록한 오버레이(라벨/지침 수정)와 완전히 새 분류(추가)를 얹어서
// 보여준다(백엔드 docKind.list가 이미 병합해서 준다). 지침은 CLI/MCP도
// docKind.list로 그대로 볼 수 있다 - 웹 UI 전용 참고 문서가 아니다.
import { ref, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import PageHeader from "components/PageHeader.vue";
import EmptyState from "components/EmptyState.vue";
import CategoryPill from "components/CategoryPill.vue";
import * as api from "src/api/client";

interface MarkdownSourceViewRef {
  getMarkdown(): string;
}
interface DocKind {
  code: string;
  label: string;
  guideline: string;
  builtin: boolean;
}

const props = defineProps<{ owner: string; projectId: string }>();
const auth = useAuthStore();

const kinds = ref<DocKind[]>([]);
const loadError = ref("");

async function load() {
  loadError.value = "";
  const result = await api.listDocKinds(auth.apiKey!, props.owner, props.projectId);
  if (!result.ok) {
    loadError.value = result.reason?.join(", ") ?? "불러오기에 실패했습니다.";
    return;
  }
  kinds.value = (result.data as { items: DocKind[] }).items;
}

const dialogOpen = ref(false);
const editingCode = ref<string | null>(null);
const draftCode = ref("");
const draftLabel = ref("");
const draftGuideline = ref("");
const guidelineEditorRef = ref<MarkdownSourceViewRef | null>(null);
const saving = ref(false);
const dialogError = ref("");

function openCreate() {
  editingCode.value = null;
  draftCode.value = "";
  draftLabel.value = "";
  draftGuideline.value = "";
  dialogError.value = "";
  dialogOpen.value = true;
}
function openEdit(k: DocKind) {
  editingCode.value = k.code;
  draftCode.value = k.code;
  draftLabel.value = k.label;
  draftGuideline.value = k.guideline;
  dialogError.value = "";
  dialogOpen.value = true;
}

async function save() {
  saving.value = true;
  dialogError.value = "";
  const code = draftCode.value.trim().toUpperCase();
  const result = await api.setDocKind(auth.apiKey!, props.owner, props.projectId, code, {
    label: draftLabel.value,
    guideline: guidelineEditorRef.value?.getMarkdown() ?? "",
  });
  saving.value = false;
  if (!result.ok) {
    dialogError.value = result.reason?.join(", ") ?? "저장에 실패했습니다.";
    return;
  }
  dialogOpen.value = false;
  await load();
}

async function removeKind(k: DocKind) {
  loadError.value = "";
  const result = await api.deleteDocKind(auth.apiKey!, props.owner, props.projectId, k.code);
  if (!result.ok) {
    loadError.value = result.reason?.join(", ") ?? "삭제에 실패했습니다.";
    return;
  }
  await load();
}

onMounted(load);
</script>
