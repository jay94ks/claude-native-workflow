<template>
  <div class="q-pa-md" style="max-width: 900px; margin: 0 auto">
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn flat dense round icon="arrow_back" :to="listRoute" />
      <div class="text-h6">새 Pull request</div>
    </div>

    <div class="q-gutter-md">
      <q-input v-model="title" label="제목" />
      <div class="row q-gutter-md">
        <q-select v-model="source" :options="branchNames" label="source branch" style="min-width: 200px" />
        <q-select v-model="target" :options="branchNames" label="target branch" style="min-width: 200px" />
      </div>

      <div>
        <div class="text-caption q-mb-xs" style="color: var(--gh-fg-muted)">설명 (선택)</div>
        <MarkdownSourceView ref="descriptionEditorRef" content="" start-in-edit hide-toolbar />
      </div>

      <div v-if="createError" class="text-negative text-caption">{{ createError }}</div>

      <div class="q-gutter-sm">
        <q-btn flat :to="listRoute" label="취소" />
        <q-btn color="primary" label="만들기" :loading="creating" :disable="!canCreate" @click="create" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import * as api from "src/api/client";

const props = defineProps<{ owner: string; projectId: string }>();
const auth = useAuthStore();
const router = useRouter();

const listRoute = `/${props.owner}/${props.projectId}/pull-requests`;

interface MarkdownSourceViewRef {
  getMarkdown(): string;
}

const branchNames = ref<string[]>([]);
const title = ref("");
const source = ref<string | null>(null);
const target = ref<string | null>(null);
const descriptionEditorRef = ref<MarkdownSourceViewRef | null>(null);
const creating = ref(false);
const createError = ref("");

const canCreate = computed(() => title.value.trim().length > 0 && !!source.value && !!target.value && source.value !== target.value);

async function loadBranches() {
  const result = await api.listBranches(auth.apiKey!, props.owner, props.projectId);
  if (result.ok) branchNames.value = (result.data as { items: { name: string }[] }).items.map((b) => b.name);
}

async function create() {
  creating.value = true;
  createError.value = "";
  const description = descriptionEditorRef.value?.getMarkdown() ?? "";
  const result = await api.createPullRequest(auth.apiKey!, props.owner, props.projectId, {
    title: title.value,
    description: description || undefined,
    sourceBranch: source.value!,
    targetBranch: target.value!,
  });
  creating.value = false;
  if (!result.ok) {
    createError.value = result.reason?.join(", ") ?? "생성에 실패했습니다.";
    return;
  }
  router.push(listRoute);
}

onMounted(loadBranches);
</script>
