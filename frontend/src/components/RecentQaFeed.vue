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
            <CategoryPill v-if="parentInfo[item.code]" color="grey-7" class="q-ml-xs cursor-pointer" @click.stop="goToCode(parentInfo[item.code]!.code)">
              ↳ {{ kindLabel(parentInfo[item.code]!.type) }}: {{ parentInfo[item.code]!.title }}
            </CategoryPill>
          </q-item-label>
          <q-item-label caption>{{ item.code }} · author: {{ item.author }} · {{ new Date(item.createdAt).toLocaleString() }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="column items-end" style="gap: 4px">
            <div class="row items-center" style="gap: 2px">
              <CategoryPill :color="item.type === 'opinion' ? 'teal' : 'primary'">{{ item.type }}</CategoryPill>
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
      <EmptyState v-if="feed.length === 0" as="item" message="최근 질의/의견이 없습니다." />
    </q-list>
    <div v-if="openError" class="text-negative text-caption q-mt-sm">{{ openError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import * as api from "src/api/client";
import EmptyState from "components/EmptyState.vue";
import { stateColor } from "src/utils/stateColor";
import CategoryPill from "components/CategoryPill.vue";

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

const props = defineProps<{ owner: string; projectId: string }>();
const auth = useAuthStore();
const router = useRouter();
const feed = ref<DocSummary[]>([]);
const loading = ref(true);
const opening = ref<string | null>(null);
const openError = ref("");
const childCounts = reactive<Record<string, number>>({});
const parentInfo = reactive<Record<string, ResolvedDoc | null>>({});

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
  const result = await api.getDocument(auth.apiKey!, props.owner, props.projectId, `XX-${rawId}`);
  if (!result.ok) return null;
  return result.data as ResolvedDoc;
}
function parseIdFromCode(code: string): string {
  return code.split("-")[1] ?? code;
}

async function load() {
  loading.value = true;
  const [q, a, o] = await Promise.all([
    api.listDocuments(auth.apiKey!, props.owner, props.projectId, { type: "question" }),
    api.listDocuments(auth.apiKey!, props.owner, props.projectId, { type: "answer" }),
    api.listDocuments(auth.apiKey!, props.owner, props.projectId, { type: "opinion" }),
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

// 설계자 지적(2026-09-22 후속, "더 최적화해") - 피드 항목(최대 30개)마다
// docs.get/docs.list를 개별 호출하던 N+1을 Q&A 스레드와 같은 방식으로
// 없앤다 - 부모는 docs.getMany 한 번, 자식 개수는 docs.childCounts
// 한 번으로 끝낸다(항목 수와 무관하게 요청이 항상 최대 2개).
async function loadParents() {
  const rawIds = [...new Set(feed.value.map((item) => item.parent_id).filter((id): id is string => !!id))];
  for (const item of feed.value) if (!item.parent_id) parentInfo[item.code] = null;
  if (rawIds.length === 0) return;
  const result = await api.getManyDocuments(auth.apiKey!, props.owner, props.projectId, rawIds);
  if (!result.ok) return;
  const items = (result.data as { items: ResolvedDoc[] }).items;
  const byRawId = new Map(items.map((d) => [parseIdFromCode(d.code), d]));
  for (const item of feed.value) {
    if (item.parent_id) parentInfo[item.code] = byRawId.get(item.parent_id) ?? null;
  }
}

async function loadChildCounts() {
  const rawIds = feed.value.map((item) => parseIdFromCode(item.code));
  if (rawIds.length === 0) return;
  const result = await api.getChildCounts(auth.apiKey!, props.owner, props.projectId, rawIds);
  if (!result.ok) return;
  const counts = (result.data as { counts: Record<string, number> }).counts;
  for (const item of feed.value) {
    childCounts[item.code] = counts[parseIdFromCode(item.code)] ?? 0;
  }
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

  // 설계자 요청(2026-09-21 후속) - doc/plan/issue는 이제 그 문서의 추적
  // 코드가 path segment다(/{tab}/{code}) - Browser History/새로고침에도
  // "그 문서를 보고 있다"는 상태가 살아남는다. tracker/test는 이번
  // URL 개편 스코프 밖이라 여전히 query(open=/inner=)로만 연다.
  if (current.type === "tracker" || current.type === "test") {
    router.push({ path: `/${props.owner}/${props.projectId}/${tabPath}`, query: { open: current.code, highlight: item.code, inner: current.type } });
  } else {
    router.push({ path: `/${props.owner}/${props.projectId}/${tabPath}/${current.code}`, query: { highlight: item.code } });
  }
}

function goToThread(code: string) {
  router.push(`/${props.owner}/${props.projectId}/thread/${code}`);
}
function goToCode(code: string) {
  router.push(`/${props.owner}/${props.projectId}/thread/${code}`);
}

onMounted(load);
</script>
