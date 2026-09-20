<template>
  <div class="q-pa-md" style="max-width: 900px; margin: 0 auto">
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn flat dense round icon="arrow_back" :to="listRoute" />
      <div class="text-h6">{{ createLabel }}</div>
    </div>

    <div class="q-gutter-md">
      <q-select v-if="kinds.length > 1" v-model="kind" :options="kinds" label="kind" style="max-width: 240px" />
      <q-input v-model="title" label="제목" />
      <q-input v-if="allowChapter" v-model="chapter" label="chapter (선택)" />

      <div>
        <div class="text-caption q-mb-xs" style="color: var(--gh-fg-muted)">본문</div>
        <MarkdownSourceView ref="contentEditorRef" content="" start-in-edit hide-toolbar />
      </div>

      <div v-if="createError" class="text-negative text-caption">{{ createError }}</div>

      <div class="q-gutter-sm">
        <q-btn flat :to="listRoute" label="취소" />
        <q-btn color="primary" label="만들기" :loading="creating" :disable="!hasContent" @click="create" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import * as api from "src/api/client";

// design-notes.md 후속 판단(설계자 요청, 2026-09-21) - "새 문서/새 계획 등
// 다이얼로그로는 기능이 부족하고 불편하다" - 본문이 한 줄짜리인 경우가
// 없다는 지적대로, 다이얼로그 대신 독립 페이지 + yiitap 기반
// MarkdownSourceView로 실제 문서 작성이 가능한 공간을 확보했다.
// DocumentsTab/PlansTab/IssuesTab가 각자의 type/kinds/제목만 다르게
// 넘겨써서 재사용한다(DocTypeWorkspace의 List+Source View와는 별개 페이지).
const props = defineProps<{
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

const kind = ref(props.kinds[0]);
const title = ref("");
const chapter = ref("");
const contentEditorRef = ref<MarkdownSourceViewRef | null>(null);
const creating = ref(false);
const createError = ref("");

const hasContent = computed(() => title.value.trim().length > 0);

async function create() {
  creating.value = true;
  createError.value = "";
  const result = await api.createDocument(auth.apiKey!, props.projectId, {
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
