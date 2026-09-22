<template>
  <div class="q-pa-md" style="max-width: var(--gh-page-width-wide); margin: 0 auto">
    <PageHeader variant="detail" :title="createLabel" :back-to="listRoute" />

    <q-form class="q-gutter-md" @submit.prevent="create">
      <q-select
        v-if="availableKinds.length > 1"
        v-model="kind"
        :options="kindOptions"
        option-label="label"
        option-value="value"
        emit-value
        map-options
        label="kind"
        style="max-width: 320px"
      />
      <q-input v-model="title" label="제목" />
      <q-input v-if="allowChapter" v-model="chapter" label="chapter (선택)" />

      <div>
        <div class="text-caption q-mb-xs" style="color: var(--gh-fg-muted)">본문</div>
        <MarkdownSourceView ref="contentEditorRef" content="" start-in-edit hide-toolbar />
      </div>

      <div v-if="createError" class="text-negative text-caption">{{ createError }}</div>

      <div class="q-gutter-sm">
        <q-btn flat :to="listRoute" label="취소" />
        <q-btn type="submit" color="primary" label="만들기" :loading="creating" :disable="!hasContent" />
      </div>
    </q-form>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import PageHeader from "components/PageHeader.vue";
import * as api from "src/api/client";

// design-notes.md 후속 판단(설계자 요청, 2026-09-21) - "새 문서/새 계획 등
// 다이얼로그로는 기능이 부족하고 불편하다" - 본문이 한 줄짜리인 경우가
// 없다는 지적대로, 다이얼로그 대신 독립 페이지 + yiitap 기반
// MarkdownSourceView로 실제 문서 작성이 가능한 공간을 확보했다.
// DocumentsTab/PlansTab/IssuesTab가 각자의 type/kinds/제목만 다르게
// 넘겨써서 재사용한다(DocTypeWorkspace의 List+Source View와는 별개 페이지).
const props = defineProps<{
  owner: string;
  projectId: string;
  type: string;
  kinds: string[];
  createLabel: string;
  listRoute: string;
  allowChapter?: boolean;
}>();

const auth = useAuthStore();
const router = useRouter();

interface MarkdownSourceViewRef {
  getMarkdown(): string;
}

// 설계자 요청(2026-09-22 후속) - "문서 분류도 추가/수정 가능해야 한다" -
// doc 타입만 라우트가 넘겨준 정적 kinds 대신 이 프로젝트의 docKind.list
// 결과로 덮어쓴다(다른 타입은 kind가 하나뿐인 구조적 상수라 정적 그대로).
// 라벨도 같이 받아와 드롭다운에 "SP · 설계 명세"처럼 보여준다(예전엔
// 코드만 보이던 갭).
const availableKinds = ref<string[]>(props.kinds);
const kindLabels = ref<Record<string, string>>({});
const kindOptions = computed(() => availableKinds.value.map((k) => ({ label: kindLabels.value[k] ? `${k} · ${kindLabels.value[k]}` : k, value: k })));

const kind = ref(props.kinds[0]);
const title = ref("");
const chapter = ref("");
const contentEditorRef = ref<MarkdownSourceViewRef | null>(null);
const creating = ref(false);
const createError = ref("");

const hasContent = computed(() => title.value.trim().length > 0);

onMounted(async () => {
  if (props.type !== "doc") return;
  const result = await api.listDocKinds(auth.apiKey!, props.owner, props.projectId);
  if (!result.ok) return;
  const items = (result.data as { items: { code: string; label: string }[] }).items;
  availableKinds.value = items.map((i) => i.code);
  kindLabels.value = Object.fromEntries(items.map((i) => [i.code, i.label]));
  if (!availableKinds.value.includes(kind.value)) kind.value = availableKinds.value[0];
});

async function create() {
  creating.value = true;
  createError.value = "";
  const result = await api.createDocument(auth.apiKey!, props.owner, props.projectId, {
    type: props.type,
    kind: kind.value,
    title: title.value,
    content: contentEditorRef.value?.getMarkdown() ?? "",
    chapter: props.allowChapter && chapter.value ? chapter.value : undefined,
  });
  creating.value = false;
  if (!result.ok) {
    createError.value = result.reason?.join(", ") ?? "생성에 실패했습니다.";
    return;
  }
  router.push(props.listRoute);
}
</script>
