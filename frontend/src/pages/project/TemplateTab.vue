<template>
  <div class="q-pa-md" style="max-width: 720px">
    <div class="text-subtitle1">내 템플릿 (architect 계정 하나당 하나, 프로젝트와 무관)</div>
    <div class="text-caption q-mb-md">여기서 편집한 템플릿은 이 프로젝트뿐 아니라 내가 관리하는 다른 프로젝트에도 배포할 수 있습니다.</div>

    <q-input v-model="claudeMd" label="CLAUDE.md" type="textarea" autogrow class="q-mb-md" />
    <q-input v-model="skillMd" label=".claude/skills/claude-native-workflow/SKILL.md" type="textarea" autogrow class="q-mb-md" />

    <div class="row q-gutter-sm items-center">
      <q-btn color="primary" label="템플릿 저장" :loading="saving" @click="save" />
      <q-btn
        v-if="project.isAdmin"
        color="secondary"
        label="이 프로젝트에 배포"
        :loading="deploying"
        @click="deploy"
      />
      <span v-else class="text-caption text-grey-7">배포는 이 프로젝트의 Admin만 할 수 있습니다.</span>
    </div>

    <div v-if="message" class="text-positive text-caption q-mt-sm">{{ message }}</div>
    <div v-if="error" class="text-negative text-caption q-mt-sm">{{ error }}</div>

    <div v-if="deployResult" class="q-mt-md">
      <div class="text-caption text-grey-8">배포된 커밋</div>
      <pre class="doc-source">{{ JSON.stringify(deployResult, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import { useProjectStore } from "stores/project";

const props = defineProps<{ projectId: string }>();
const auth = useAuthStore();
const project = useProjectStore();

const claudeMd = ref("");
const skillMd = ref("");
const saving = ref(false);
const deploying = ref(false);
const message = ref("");
const error = ref("");
const deployResult = ref<unknown>(null);

async function load() {
  const result = await auth.run({ action: "template.get", projectId: props.projectId });
  if (result.ok) {
    const data = result.data as { claudeMd: string; skillMd: string };
    claudeMd.value = data.claudeMd;
    skillMd.value = data.skillMd;
  }
  // 아직 템플릿을 안 만든 계정이면 result.ok===false - 빈 폼으로 새로 작성하게 둔다.
}

async function save() {
  saving.value = true;
  message.value = "";
  error.value = "";
  const result = await auth.run({ action: "template.set", projectId: props.projectId, claudeMd: claudeMd.value, skillMd: skillMd.value });
  saving.value = false;
  if (!result.ok) {
    error.value = result.reason?.join(", ") ?? "저장에 실패했습니다.";
    return;
  }
  message.value = "저장했습니다.";
}

async function deploy() {
  deploying.value = true;
  message.value = "";
  error.value = "";
  deployResult.value = null;
  const result = await auth.run({ action: "template.deploy", projectId: props.projectId });
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
