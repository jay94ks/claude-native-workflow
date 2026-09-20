<template>
  <div class="q-pa-md">
    <div class="text-caption q-mb-sm" style="color: var(--gh-fg-muted)">
      프로젝트 전체의 최근 질의/답변/의견 모아보기 - 읽기 전용이며, 실제로 질문/답변/의견을 달거나 처리하려면 그 문서 화면의
      Discussion으로 이동해야 합니다. 항목을 누르면 그 문서로 이동해 스크롤되고, 자식이 있으면 more 아이콘으로 계층을 볼 수 있습니다.
    </div>
    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <q-list v-else bordered separator>
      <q-item v-for="item in feed" :key="item.code" clickable :disable="opening === item.code" @click="openItem(item)">
        <q-item-section>
          <q-item-label>
            {{ item.title }}
            <!-- 설계자 요청(2026-09-21) - Q&A는 계층 구조(질문->답변->재질의->...)인데
                 이 목록이 완전히 평평해서 그게 안 보인다는 지적 - 이 항목이 무엇에
                 대한 답/재질의인지(parent) 배지로 같이 보여준다. -->
            <q-badge v-if="parentInfo[item.code]" outline color="grey-7" class="q-ml-xs cursor-pointer" @click.stop="goToCode(parentInfo[item.code]!.code)">
              ↳ {{ kindLabel(parentInfo[item.code]!.type) }}: {{ parentInfo[item.code]!.title }}
            </q-badge>
          </q-item-label>
          <q-item-label caption>{{ item.code }} · author: {{ item.author }} · {{ new Date(item.createdAt).toLocaleString() }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="column items-end" style="gap: 4px">
            <div class="row items-center" style="gap: 2px">
              <q-badge :color="item.type === 'opinion' ? 'teal' : 'primary'" outline dense>{{ item.type }}</q-badge>
              <q-badge :color="stateColor(item.state)">{{ item.state }}</q-badge>
              <!-- 설계자 요청(2026-09-21) - 자식이 있으면 more 아이콘 -> 별도 페이지(계층 드릴다운). -->
              <q-btn
                v-if="(childCounts[item.code] ?? 0) > 0"
                flat
                dense
                round
                size="sm"
                icon="more_horiz"
                @click.stop="goToThread(item.code)"
              >
                <q-tooltip>자식 항목 {{ childCounts[item.code] }}개 보기</q-tooltip>
              </q-btn>
            </div>
          </div>
        </q-item-section>
        <q-item-section v-if="opening === item.code" side><q-spinner size="20px" /></q-item-section>
      </q-item>
      <q-item v-if="feed.length === 0"><q-item-section class="text-caption">최근 질의/의견이 없습니다.</q-item-section></q-item>
    </q-list>
    <div v-if="openError" class="text-negative text-caption q-mt-sm">{{ openError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";

interface DocSummary {
  code: string;
  parent_id: string | null;
  type: string;
  state: string;
  title: string;
  author: string;
  createdAt: string;
}
interface ResolvedDoc {
  code: string;
  type: string;
  title: string;
  parent_id: string | null;
}

const props = defineProps<{ projectId: string }>();
const auth = useAuthStore();
const router = useRouter();
const feed = ref<DocSummary[]>([]);
const loading = ref(true);
const opening = ref<string | null>(null);
const openError = ref("");
const childCounts = reactive<Record<string, number>>({});
const parentInfo = reactive<Record<string, ResolvedDoc | null>>({});

function stateColor(state: string): string {
  if (state === "done") return "positive";
  if (state === "discard") return "grey-6";
  return "primary";
}
function kindLabel(type: string): string {
  if (type === "question") return "질문";
  if (type === "answer") return "답변";
  if (type === "opinion") return "의견";
  return type;
}

// design-notes.md의 tracking code 파서(parseTrackingCode)는 kind 접두사
// 두세 글자만 형식을 검사할 뿐 실제 그 문서의 kind와 일치하는지는 안
// 따진다(=id만으로 조회) - 그래서 raw id만 있고 kind를 모를 때도
// 아무 자리 표시 kind("XX")를 붙여 docs.get을 부르면 실제 문서(진짜
// kind 포함)를 그대로 돌려받을 수 있다.
async function resolveByRawId(rawId: string): Promise<ResolvedDoc | null> {
  const result = await api.getDocument(auth.apiKey!, props.projectId, `XX-${rawId}`);
  if (!result.ok) return null;
  return result.data as ResolvedDoc;
}
function parseIdFromCode(code: string): string {
  return code.split("-")[1] ?? code;
}

async function load() {
  loading.value = true;
  const [q, a, o] = await Promise.all([
    api.listDocuments(auth.apiKey!, props.projectId, { type: "question" }),
    api.listDocuments(auth.apiKey!, props.projectId, { type: "answer" }),
    api.listDocuments(auth.apiKey!, props.projectId, { type: "opinion" }),
  ]);
  const items: DocSummary[] = [];
  for (const r of [q, a, o]) {
    if (r.ok) items.push(...(r.data as { items: DocSummary[] }).items);
  }
  items.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  feed.value = items.slice(0, 30);
  loading.value = false;
  await Promise.all([loadParents(), loadChildCounts()]);
}

async function loadParents() {
  await Promise.all(
    feed.value.map(async (item) => {
      if (!item.parent_id) {
        parentInfo[item.code] = null;
        return;
      }
      parentInfo[item.code] = await resolveByRawId(item.parent_id);
    })
  );
}

async function loadChildCounts() {
  await Promise.all(
    feed.value.map(async (item) => {
      const rawId = parseIdFromCode(item.code);
      const result = await api.listDocuments(auth.apiKey!, props.projectId, { parentId: rawId });
      if (result.ok) childCounts[item.code] = (result.data as { items: unknown[] }).items.length;
    })
  );
}

const TAB_PATH_BY_TYPE: Record<string, string> = {
  doc: "documents",
  plan: "plans",
  issue: "issues",
  tracker: "trackers-tests",
  test: "trackers-tests",
};

async function resolveRealDocument(startCode: string, startType: string, startParentId: string | null): Promise<ResolvedDoc | null> {
  // question/answer/opinion은 전부 뭔가의 자식이다 - question/opinion이
  // answer의 자식(재질의 흐름)일 수도 있으므로, Q&A 타입이 아닌 "진짜
  // 문서"(doc/plan/issue/tracker/test)를 찾을 때까지 parent_id를 계속
  // 타고 올라간다.
  let current: ResolvedDoc | null = { code: startCode, type: startType, title: "", parent_id: startParentId };
  let guard = 0;
  while (current && ["question", "answer", "opinion"].includes(current.type) && guard < 10) {
    if (!current.parent_id) return null;
    current = await resolveByRawId(current.parent_id);
    guard++;
  }
  return current;
}

async function openItem(item: DocSummary) {
  opening.value = item.code;
  openError.value = "";

  const current = await resolveRealDocument(item.code, item.type, item.parent_id);

  opening.value = null;
  if (!current) {
    openError.value = "이 항목이 등록된 문서를 찾을 수 없습니다.";
    return;
  }

  const tabPath = TAB_PATH_BY_TYPE[current.type];
  if (!tabPath) {
    openError.value = `"${current.type}" 타입은 아직 이동을 지원하지 않습니다.`;
    return;
  }

  const query: Record<string, string> = { open: current.code, highlight: item.code };
  if (current.type === "tracker" || current.type === "test") query.inner = current.type;
  router.push({ path: `/projects/${props.projectId}/${tabPath}`, query });
}

function goToThread(code: string) {
  router.push(`/projects/${props.projectId}/thread/${code}`);
}
function goToCode(code: string) {
  router.push(`/projects/${props.projectId}/thread/${code}`);
}

onMounted(load);
</script>
