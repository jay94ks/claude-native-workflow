<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { client, type DocDetail, type PendingItem, type Comment, type CommitSummary } from "../api";

const props = defineProps<{ path: string }>();
const emit = defineEmits<{ reply: [item: PendingItem]; changed: [] }>();

const doc = ref<DocDetail | null>(null);
const pending = ref<PendingItem[]>([]);
const editing = ref(false);
const editBody = ref("");
const editArea = ref<HTMLTextAreaElement>();
const saving = ref(false);

const comments = ref<Comment[]>([]);
const newComment = ref("");
const commits = ref<CommitSummary[]>([]);
const selectedDiff = ref<{ sha: string; text: string; files: string[] } | null>(null);
const blameText = ref<string | null>(null);
const blameLoading = ref(false);

// marked는 마크다운 소스에 섞인 raw HTML을 기본적으로 그대로 통과시킨다
// (별도 sanitize 옵션이 없음 - v5+에서 제거됨) - 문서 본문은 Tier 3에서
// 나(owner)보다 낮은 신뢰의 editor가 쓸 수도 있는 콘텐츠라, 그대로
// v-html에 넣으면 <img onerror=...> 같은 저장형 XSS가 그대로 실행된다
// (스크래치 환경에서 실제로 재현해서 확인한 뒤 고침). DOMPurify로
// 스크립트/이벤트 핸들러를 걷어내고서만 렌더링한다.
const renderedBody = computed(() =>
  doc.value ? DOMPurify.sanitize(marked.parse(doc.value.body, { async: false }) as string) : "",
);

async function load() {
  editing.value = false;
  const [d, allPending] = await Promise.all([client.doc(props.path), client.pending()]);
  doc.value = d;
  pending.value = allPending.filter((p) => p.doc_path === props.path);
  await Promise.all([loadComments(), loadHistory()]);
}

async function loadComments() {
  comments.value = await client.comments(props.path);
}

async function loadHistory() {
  commits.value = await client.gitLog(props.path, 20);
  selectedDiff.value = null;
  blameText.value = null;
}

async function toggleBlame() {
  if (blameText.value !== null) { blameText.value = null; return; }
  blameLoading.value = true;
  try {
    blameText.value = await client.gitBlame(props.path);
  } finally {
    blameLoading.value = false;
  }
}

watch(() => props.path, load, { immediate: true });

function startEdit() {
  if (!doc.value) return;
  editBody.value = doc.value.body;
  editing.value = true;
}

async function save() {
  saving.value = true;
  try {
    await client.saveDoc(props.path, editBody.value);
    await load();
    emit("changed"); // sidebar/list rows show `updated` - keep them in sync
  } finally {
    saving.value = false;
  }
}

// 굵게/취소선/제목 등 - 선택 영역을 감싸거나 현재 줄 앞에 접두어를 붙인다.
function wrapSelection(before: string, after: string) {
  const el = editArea.value;
  if (!el) return;
  const { selectionStart: s, selectionEnd: e, value } = el;
  editBody.value = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(s + before.length, e + before.length);
  });
}

function prefixLine(prefix: string) {
  const el = editArea.value;
  if (!el) return;
  const { selectionStart: s, value } = el;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  editBody.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  requestAnimationFrame(() => el.focus());
}

async function submitComment() {
  if (!newComment.value.trim()) return;
  await client.addComment(props.path, newComment.value.trim());
  newComment.value = "";
  await loadComments();
}

async function resolveComment(id: number) {
  await client.resolveComment(props.path, id);
  await loadComments();
}

async function viewDiff(sha: string) {
  const [text, detail] = await Promise.all([client.gitDiff(sha), client.gitCommit(sha)]);
  selectedDiff.value = { sha, text, files: detail?.files ?? [] };
}
</script>

<template>
  <div v-if="doc" class="doc-viewer">
    <div class="row items-center q-gutter-sm q-mb-sm">
      <q-badge color="grey-8">{{ doc.meta.type }}</q-badge>
      <div class="text-h6">{{ doc.meta.id }} {{ doc.meta.title }}</div>
      <q-badge outline color="primary">{{ doc.meta.status }}</q-badge>
      <q-space />
      <q-btn v-if="!editing" flat dense icon="edit" label="편집" @click="startEdit" />
      <template v-else>
        <q-btn flat dense label="취소" @click="editing = false" />
        <q-btn color="primary" dense label="저장" :loading="saving" @click="save" />
      </template>
    </div>
    <div class="text-caption text-grey-7 q-mb-md">
      생성 {{ doc.meta.created }} · 갱신 {{ doc.meta.updated }}
      <template v-if="doc.meta.links?.length">· links: {{ doc.meta.links.join(", ") }}</template>
    </div>

    <q-list v-if="pending.length" bordered separator class="q-mb-md">
      <q-item v-for="p in pending" :key="p.question_id" clickable @click="emit('reply', p)">
        <q-item-section avatar><q-icon name="help_outline" color="warning" /></q-item-section>
        <q-item-section>
          <q-item-label>(Q{{ p.question_id }}) {{ p.question }}</q-item-label>
          <q-item-label v-if="p.options.find((o) => o.kind === '권장')" caption>
            권장: {{ p.options.find((o) => o.kind === "권장")?.text }}
          </q-item-label>
        </q-item-section>
        <q-item-section side><q-btn flat dense color="primary" label="답변" /></q-item-section>
      </q-item>
    </q-list>

    <div v-if="!editing" class="doc-body markdown-body" v-html="renderedBody"></div>
    <div v-else class="doc-edit">
      <div class="edit-toolbar q-mb-xs">
        <q-btn dense flat icon="format_bold" @click="wrapSelection('**', '**')" />
        <q-btn dense flat icon="strikethrough_s" @click="wrapSelection('~~', '~~')" />
        <q-btn dense flat label="H1" @click="prefixLine('# ')" />
        <q-btn dense flat label="H2" @click="prefixLine('## ')" />
        <q-btn dense flat icon="code" @click="wrapSelection('`', '`')" />
        <q-btn dense flat icon="link" @click="wrapSelection('[', '](url)')" />
      </div>
      <textarea ref="editArea" v-model="editBody" class="edit-textarea" rows="18"></textarea>
    </div>

    <q-separator class="q-my-md" />

    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-6">
        <div class="text-subtitle2 q-mb-xs">코멘트 (비공식 토론)</div>
        <q-list bordered separator dense class="q-mb-sm">
          <q-item v-for="c in comments" :key="c.id">
            <q-item-section>
              <q-item-label :class="{ 'text-strike text-grey-6': c.resolved_at }">{{ c.body }}</q-item-label>
              <q-item-label caption>{{ c.created_at }}</q-item-label>
            </q-item-section>
            <q-item-section side v-if="!c.resolved_at">
              <q-btn flat dense size="sm" label="해결" @click="resolveComment(c.id)" />
            </q-item-section>
          </q-item>
          <q-item v-if="!comments.length"><q-item-section class="text-grey-6">코멘트 없음</q-item-section></q-item>
        </q-list>
        <q-input v-model="newComment" dense outlined placeholder="코멘트 작성" @keyup.enter="submitComment">
          <template #append><q-btn flat dense icon="send" @click="submitComment" /></template>
        </q-input>
      </div>

      <div class="col-12 col-md-6">
        <div class="row items-center q-mb-xs">
          <div class="text-subtitle2">커밋 이력</div>
          <q-space />
          <q-btn flat dense size="sm" :loading="blameLoading" :label="blameText !== null ? 'blame 닫기' : 'blame 보기'" @click="toggleBlame" />
        </div>
        <pre v-if="blameText !== null" class="diff-box">{{ blameText }}</pre>
        <q-list bordered separator dense>
          <q-item v-for="c in commits" :key="c.sha" clickable @click="viewDiff(c.sha)">
            <q-item-section>
              <q-item-label lines="1">{{ c.message }}</q-item-label>
              <q-item-label caption>{{ c.sha.slice(0, 7) }} · {{ c.author }} · {{ c.date }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="!commits.length"><q-item-section class="text-grey-6">이력 없음</q-item-section></q-item>
        </q-list>
        <div v-if="selectedDiff && selectedDiff.files.length" class="commit-files">
          <div class="text-caption text-weight-bold">변경된 파일 ({{ selectedDiff.files.length }})</div>
          <div v-for="f in selectedDiff.files" :key="f" class="commit-file-row">{{ f }}</div>
        </div>
        <pre v-if="selectedDiff" class="diff-box">{{ selectedDiff.text }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.markdown-body :deep(h1) { font-size: 1.4rem; margin: 0.6em 0 0.3em; }
.markdown-body :deep(h2) { font-size: 1.2rem; margin: 0.6em 0 0.3em; }
.markdown-body :deep(h3) { font-size: 1.05rem; margin: 0.6em 0 0.3em; }
.markdown-body :deep(code) { background: #f0f0f0; padding: 0 4px; border-radius: 3px; }
.markdown-body :deep(pre) { background: #f5f5f5; padding: 8px; border-radius: 4px; overflow-x: auto; }
.markdown-body :deep(table) { border-collapse: collapse; }
.markdown-body :deep(td), .markdown-body :deep(th) { border: 1px solid #ddd; padding: 4px 8px; }
.diff-box { background: #f5f5f5; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 12px; max-height: 400px; }
.commit-files { margin-top: 8px; font-family: ui-monospace, monospace; font-size: 12px; color: #666; }
.commit-file-row { padding: 1px 0; }
.edit-toolbar { display: flex; gap: 4px; }
.edit-textarea {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  resize: vertical;
}
</style>
