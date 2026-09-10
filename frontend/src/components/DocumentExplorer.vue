<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import { connectProjectRealtime, type ChangeEvent } from "../realtime";

const props = defineProps<{ projectId: string }>();
const route = useRoute();
const router = useRouter();

interface DocType {
  id: string;
  code: string;
  label: string;
}
interface DocumentSummary {
  trackingCode: string;
  title: string;
  docTypeId: string;
}

const docTypes = ref<DocType[]>([]);
const documents = ref<DocumentSummary[]>([]);
const loading = ref(true);
const error = ref("");
const collapsedTypeIds = ref<Set<string>>(new Set());
const creatingTypeId = ref<string | null>(null);
const newTitle = ref("");
const creating = ref(false);

let disconnect: (() => void) | null = null;

const groups = computed(() =>
  docTypes.value.map((t) => ({
    type: t,
    docs: documents.value.filter((d) => d.docTypeId === t.id),
  })),
);

const activeTrackingCode = computed(() => (typeof route.params.trackingCode === "string" ? route.params.trackingCode : null));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [types, docs] = await Promise.all([
      apiCall<DocType[]>(`/projects/${props.projectId}/doc-types`),
      apiCall<DocumentSummary[]>(`/projects/${props.projectId}/documents`),
    ]);
    docTypes.value = types;
    documents.value = docs;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function toggle(typeId: string) {
  const next = new Set(collapsedTypeIds.value);
  if (next.has(typeId)) next.delete(typeId);
  else next.add(typeId);
  collapsedTypeIds.value = next;
}

function startCreate(typeId: string) {
  creatingTypeId.value = typeId;
  newTitle.value = "";
}

async function submitCreate(type: DocType) {
  if (!newTitle.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    const doc = await apiCall<{ trackingCode: string }>(`/projects/${props.projectId}/documents`, {
      method: "POST",
      body: JSON.stringify({ docTypeCode: type.code, title: newTitle.value.trim(), body: "" }),
    });
    creatingTypeId.value = null;
    newTitle.value = "";
    await load();
    router.push(`/projects/${props.projectId}/documents/${doc.trackingCode}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  } finally {
    creating.value = false;
  }
}

onMounted(async () => {
  await load();
  disconnect = await connectProjectRealtime(props.projectId, {
    onChange: (event: ChangeEvent) => {
      if (event.entity === "document") load();
    },
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <div class="explorer">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">불러오는 중...</p>
    <div v-else class="groups">
      <div v-for="g in groups" :key="g.type.id" class="group">
        <div class="group-header" @click="toggle(g.type.id)">
          <span class="caret">{{ collapsedTypeIds.has(g.type.id) ? "▸" : "▾" }}</span>
          <span class="type-label">{{ g.type.code }} · {{ g.type.label }}</span>
          <button class="add-btn" title="새 문서" @click.stop="startCreate(g.type.id)">+</button>
        </div>
        <div v-if="!collapsedTypeIds.has(g.type.id)" class="group-body">
          <form v-if="creatingTypeId === g.type.id" class="create-row" @submit.prevent="submitCreate(g.type)">
            <input v-model="newTitle" type="text" placeholder="새 문서 제목" autofocus />
            <button type="submit" :disabled="creating">만들기</button>
          </form>
          <ul class="docs">
            <li v-for="d in g.docs" :key="d.trackingCode">
              <router-link
                :to="`/projects/${projectId}/documents/${d.trackingCode}`"
                :class="{ active: d.trackingCode === activeTrackingCode }"
              >
                {{ d.title }}
              </router-link>
            </li>
            <li v-if="g.docs.length === 0" class="muted">문서 없음</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.explorer {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.group {
  margin-bottom: 4px;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  color: #c7c9e8;
}
.group-header:hover {
  background: #2e2f4d;
  color: #fff;
}
.caret {
  font-size: 10px;
  width: 10px;
  flex-shrink: 0;
}
.type-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add-btn {
  background: none;
  border: 1px solid #454668;
  color: #c7c9e8;
  border-radius: 4px;
  width: 18px;
  height: 18px;
  line-height: 1;
  font-size: 12px;
  flex-shrink: 0;
}
.add-btn:hover {
  background: #454668;
  color: #fff;
}
.group-body {
  padding-left: 18px;
}
.create-row {
  display: flex;
  gap: 4px;
  margin: 4px 0;
}
.create-row input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid #454668;
  background: #24253f;
  color: #fff;
  font-size: 12px;
}
.create-row button {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  border: none;
  background: #3454d1;
  color: #fff;
}
.docs {
  list-style: none;
  padding: 0;
  margin: 2px 0;
}
.docs li a {
  display: block;
  padding: 5px 8px;
  border-radius: 6px;
  color: #c7c9e8;
  text-decoration: none;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.docs li a:hover {
  background: #2e2f4d;
  color: #fff;
}
.docs li a.active {
  background: #3454d1;
  color: #fff;
}
.muted {
  color: #8688a8;
  font-size: 12px;
  padding: 2px 8px;
}
.error {
  color: #ff8a9b;
  font-size: 12px;
}
</style>
