<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "./UserRef.vue";
import { useNicknamesStore } from "../stores/nicknames";
import { useEntityPickerStore } from "../stores/entityPicker";
import { PROJECT_MY_ROLE_KEY } from "../utils/projectContext";

const nicknames = useNicknamesStore();
const entityPicker = useEntityPickerStore();

const props = defineProps<{ projectId: string }>();

// 세부 접근 권한은 백엔드 자체가 owner 전용(GET .../access도 owner만
// 조회 가능) - non-owner는 애초에 이 섹션을 볼 이유가 없으므로
// 조회 자체를 건너뛴다(실패 응답을 보여주는 대신 통째로 숨김).
const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const isOwner = computed(() => myRole.value === "owner");

interface Member {
  userId: string;
  role: string;
}
interface DocType {
  id: string;
  code: string;
  label: string;
}
interface AccessOverride {
  id: string;
  userId: string;
  docTypeId: string | null;
  documentId: string | null;
  canRead: boolean | null;
  canWrite: boolean | null;
  canDelete: boolean | null;
}

const members = ref<Member[]>([]);
const docTypes = ref<DocType[]>([]);
const overrides = ref<AccessOverride[]>([]);
const loading = ref(true);
const error = ref("");

const targetUserId = ref("");
const scope = ref<"common" | "doctype" | "document">("common");
const targetDocTypeId = ref("");
const targetTrackingCode = ref("");
const readChoice = ref("keep");
const writeChoice = ref("keep");
const deleteChoice = ref("keep");
const saveError = ref("");
const saving = ref(false);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [m, d, o] = await Promise.all([
      apiCall<Member[]>(`/projects/${props.projectId}/members`),
      apiCall<DocType[]>(`/projects/${props.projectId}/doc-types`),
      apiCall<AccessOverride[]>(`/projects/${props.projectId}/access`),
    ]);
    members.value = m;
    docTypes.value = d;
    overrides.value = o;
    for (const member of m) nicknames.ensure(member.userId);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "접근 권한 정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function toBool(choice: string): boolean | undefined {
  if (choice === "allow") return true;
  if (choice === "deny") return false;
  return undefined;
}

async function save() {
  if (!targetUserId.value.trim()) return;
  saveError.value = "";
  saving.value = true;
  const patch = {
    userId: targetUserId.value.trim(),
    canRead: toBool(readChoice.value),
    canWrite: toBool(writeChoice.value),
    canDelete: toBool(deleteChoice.value),
  };
  try {
    if (scope.value === "document") {
      if (!targetTrackingCode.value.trim()) throw new Error("문서 추적 코드가 필요합니다");
      await apiCall(`/documents/${targetTrackingCode.value.trim()}/access`, { method: "PUT", body: JSON.stringify(patch) });
    } else if (scope.value === "doctype") {
      if (!targetDocTypeId.value) throw new Error("문서 타입을 선택하세요");
      await apiCall(`/projects/${props.projectId}/doc-types/${targetDocTypeId.value}/access`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
    } else {
      await apiCall(`/projects/${props.projectId}/access`, { method: "PUT", body: JSON.stringify(patch) });
    }
    await load();
  } catch (err) {
    saveError.value = err instanceof ApiError || err instanceof Error ? err.message : "저장에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

async function pickTargetDocument() {
  const result = await entityPicker.pick({
    kind: "document",
    projectId: props.projectId,
    multi: false,
    allowManualEntry: false,
    initialSelected: targetTrackingCode.value ? [targetTrackingCode.value] : [],
  });
  if (result && result[0]) targetTrackingCode.value = result[0];
}

function docTypeLabel(id: string): string {
  return docTypes.value.find((t) => t.id === id)?.code ?? id;
}

function flagText(b: boolean | null): string {
  if (b === null) return "-";
  return b ? "허용" : "차단";
}

onMounted(() => {
  if (isOwner.value) load();
});
</script>

<template>
  <div v-if="isOwner" class="manager">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <template v-else>
      <form class="form" @submit.prevent="save">
        <select v-model="targetUserId">
          <option value="">대상 설계자 선택</option>
          <option v-for="m in members" :key="m.userId" :value="m.userId">{{ nicknames.labels[m.userId] ?? m.userId }} ({{ m.role }})</option>
        </select>
        <div class="scope-tabs">
          <button type="button" :class="{ active: scope === 'common' }" @click="scope = 'common'">공통</button>
          <button type="button" :class="{ active: scope === 'doctype' }" @click="scope = 'doctype'">문서 타입별</button>
          <button type="button" :class="{ active: scope === 'document' }" @click="scope = 'document'">개별 문서</button>
        </div>
        <select v-if="scope === 'doctype'" v-model="targetDocTypeId">
          <option value="">문서 타입 선택</option>
          <option v-for="t in docTypes" :key="t.id" :value="t.id">{{ t.code }} · {{ t.label }}</option>
        </select>
        <button v-if="scope === 'document'" type="button" class="pick-btn" @click="pickTargetDocument">
          {{ targetTrackingCode || "문서 선택..." }}
        </button>
        <div class="flags">
          <label>읽기 <select v-model="readChoice"><option value="keep">변경 안 함</option><option value="allow">허용</option><option value="deny">차단</option></select></label>
          <label>쓰기 <select v-model="writeChoice"><option value="keep">변경 안 함</option><option value="allow">허용</option><option value="deny">차단</option></select></label>
          <label>삭제 <select v-model="deleteChoice"><option value="keep">변경 안 함</option><option value="allow">허용</option><option value="deny">차단</option></select></label>
        </div>
        <button type="submit" :disabled="saving">저장</button>
      </form>
      <p v-if="saveError" class="error">{{ saveError }}</p>

      <ul class="overrides">
        <li v-for="o in overrides" :key="o.id">
          <UserRef :user-id="o.userId" />
          <span class="scope-label">
            {{
              o.documentId
                ? `문서(${o.documentId})`
                : o.docTypeId
                  ? `타입(${docTypeLabel(o.docTypeId)})`
                  : "공통"
            }}
          </span>
          <span class="flags-view">읽기:{{ flagText(o.canRead) }} 쓰기:{{ flagText(o.canWrite) }} 삭제:{{ flagText(o.canDelete) }}</span>
        </li>
        <li v-if="overrides.length === 0" class="muted">설정된 세부 권한이 없습니다.</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.manager {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 12px;
}
.form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.form select,
.form input {
  padding: 6px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  font-size: 13px;
}
.scope-tabs {
  display: flex;
  gap: 4px;
}
.scope-tabs button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.scope-tabs button.active {
  background: #3454d1;
  color: #fff;
  border-color: #3454d1;
}
.pick-btn {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.flags {
  display: flex;
  gap: 10px;
  font-size: 12px;
}
.form button[type="submit"] {
  background: #3454d1;
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
}
.overrides {
  list-style: none;
  padding: 0;
  margin: 0;
}
.overrides li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #eee;
  font-size: 12px;
}
.overrides li:last-child {
  border-bottom: none;
}
.scope-label {
  color: #666;
}
.flags-view {
  margin-left: auto;
  color: #888;
}
.muted {
  color: #888;
  font-size: 13px;
}
.error {
  color: #d1344b;
  font-size: 13px;
}
</style>
