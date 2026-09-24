<template>
  <div style="max-width: var(--gh-page-width-wide); margin: 0 auto">
    <PageHeader
      variant="settings"
      title="내 템플릿 (architect 계정 하나당 하나, 프로젝트와 무관)"
      caption="여기서 편집한 템플릿은 이 프로젝트뿐 아니라 내가 관리하는 다른 프로젝트에도 배포할 수 있습니다."
    />

    <div class="q-mb-md">
      <div class="text-caption q-mb-xs" style="color: var(--gh-fg-muted)">CLAUDE.md</div>
      <MarkdownSourceView :content="claudeMd" @save="onSaveClaudeMd" />
    </div>
    <div class="q-mb-md">
      <div class="text-caption q-mb-xs" style="color: var(--gh-fg-muted)">.claude/skills/claude-native-workflow/SKILL.md</div>
      <MarkdownSourceView :content="skillMd" @save="onSaveSkillMd" />
    </div>

    <div class="row q-gutter-sm items-center">
      <q-btn v-if="project.isAdmin" color="primary" label="이 프로젝트에 배포" :loading="deploying" @click="deploy" />
      <span v-else class="text-caption" style="color: var(--gh-fg-muted)">배포는 이 프로젝트의 Admin만 할 수 있습니다.</span>
    </div>

    <div v-if="message" class="text-positive text-caption q-mt-sm">{{ message }}</div>
    <div v-if="error" class="text-negative text-caption q-mt-sm">{{ error }}</div>

    <div v-if="deployResult" class="q-mt-md">
      <div class="text-caption" style="color: var(--gh-fg-muted)">배포된 커밋</div>
      <pre class="doc-source">{{ JSON.stringify(deployResult, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import { useProjectStore } from "stores/project";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import PageHeader from "components/PageHeader.vue";
import * as api from "src/api/client";

const props = defineProps<{ owner: string; projectId: string }>();
const auth = useAuthStore();
const project = useProjectStore();

const claudeMd = ref("");
const skillMd = ref("");
const deploying = ref(false);
const message = ref("");
const error = ref("");
const deployResult = ref<unknown>(null);

async function load() {
  const result = await api.getTemplate(auth.apiKey!);
  if (result.ok) {
    const data = result.data as { claudeMd: string; skillMd: string };
    claudeMd.value = data.claudeMd;
    skillMd.value = data.skillMd;
  }
  // 아직 템플릿을 안 만든 계정이면 result.ok===false - 빈 내용으로 새로 작성하게 둔다.
}

// design-notes.md 후속 판단(설계자 요청, 2026-09-21) - CLAUDE.md/SKILL.md도
// 다른 Source View들과 동일하게 yiitap 기반 편집기를 쓴다. 각 필드가 독립
// 편집기이지만 template.set은 둘을 항상 함께 받으므로, 한쪽만 편집해
// 저장해도 다른 쪽의 현재 값을 같이 실어 보낸다.
async function persist() {
  message.value = "";
  error.value = "";
  const result = await api.setTemplate(auth.apiKey!, { claudeMd: claudeMd.value, skillMd: skillMd.value });
  if (!result.ok) {
    error.value = result.reason?.join(", ") ?? "저장에 실패했습니다.";
    return;
  }
  message.value = "저장했습니다.";
}

async function onSaveClaudeMd(markdown: string) {
  claudeMd.value = markdown;
  await persist();
}
async function onSaveSkillMd(markdown: string) {
  skillMd.value = markdown;
  await persist();
}

async function deploy() {
  deploying.value = true;
  message.value = "";
  error.value = "";
  deployResult.value = null;
  const result = await api.deployTemplate(auth.apiKey!, props.owner, props.projectId);
  deploying.value = false;
  if (!result.ok) {
    error.value = result.reason?.join(", ") ?? "배포에 실패했습니다.";
    return;
  }
  message.value = "배포했습니다.";
  deployResult.value = result.data;
}

onMounted(load);
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
