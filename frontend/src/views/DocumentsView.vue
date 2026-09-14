<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import { PROJECT_MY_ROLE_KEY, roleSatisfies } from "../utils/projectContext";
import FolderSelectTree from "../components/FolderSelectTree.vue";
import { UNFILED_SENTINEL } from "../utils/folderTree";
import DocumentListPanel from "../components/DocumentListPanel.vue";
import QuestionListPanel from "../components/QuestionListPanel.vue";
import RelationGraphCanvas from "../components/RelationGraphCanvas.vue";
import type { RelationGraphNode, RelationGraphEdge } from "../utils/relationGraph";
import { RELATION_VIEW_MODES } from "../utils/relationViewModes";

const props = defineProps<{ id: string }>();
const router = useRouter();
const route = useRoute();
const isRecentMode = computed(() => route.query.recent === "1");
const isFavoritesMode = computed(() => route.query.favorites === "1");

const myRole = inject(PROJECT_MY_ROLE_KEY, ref(null));
const canCreateDocument = computed(() => roleSatisfies(myRole.value, "editor"));

interface DocumentSummary {
  trackingCode: string;
  title: string;
  docTypeId: string;
  statusCode: string;
}
interface DocType {
  id: string;
  code: string;
  label: string;
  guideline: string | null;
}
interface DocumentPage {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
interface QuestionSummary {
  trackingCode: string;
  targetType: string;
  targetKey: string;
  targetLabel: string;
  kind: string;
  text: string;
  status: string;
}
interface QuestionPage {
  items: QuestionSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const recentDocuments = ref<DocumentSummary[]>([]);
const docTypes = ref<DocType[]>([]);
const error = ref("");

function docTypeLabel(id: string): string {
  const t = docTypes.value.find((dt) => dt.id === id);
  return t ? `${t.code} · ${t.label}` : id;
}

async function loadDocTypes() {
  try {
    docTypes.value = await apiCall<DocType[]>(`/projects/${props.id}/doc-types`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 분류 목록을 불러오지 못했습니다";
  }
}

async function loadRecent() {
  try {
    recentDocuments.value = await apiCall<DocumentSummary[]>(`/projects/${props.id}/documents/recent?limit=100`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  }
}

// ---------------------------------------------------------------- "즐겨찾기" 전용 페이지(#document-favorites)
// 홈 화면 "즐겨찾기한 문서" 섹션의 "더보기"가 여기로 온다(recent 모드와
// 같은 쿼리 파라미터 패턴) - recent와 달리 페이지네이션 있음.

const favoritesPage = ref<DocumentPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const favoritesLoading = ref(true);
const favoritesError = ref("");
const favoritesPageNum = ref(1);

async function loadFavoritesPage() {
  favoritesLoading.value = true;
  favoritesError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(favoritesPageNum.value), pageSize: "20" });
    favoritesPage.value = await apiCall<DocumentPage>(`/projects/${props.id}/documents/favorites/page?${qs}`);
  } catch (err) {
    favoritesError.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    favoritesLoading.value = false;
  }
}
function onFavoritesPageChange(page: number) {
  favoritesPageNum.value = page;
  loadFavoritesPage();
}

const newTitle = ref("");
const newTypeCode = ref("");
async function create() {
  if (!newTitle.value.trim() || !newTypeCode.value.trim()) return;
  error.value = "";
  try {
    const doc = await apiCall<{ trackingCode: string }>(`/projects/${props.id}/documents`, {
      method: "POST",
      body: JSON.stringify({ docTypeCode: newTypeCode.value.trim(), title: newTitle.value.trim(), body: "" }),
    });
    newTitle.value = "";
    router.push(`/projects/${props.id}/documents/${doc.trackingCode}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "생성에 실패했습니다";
  }
}

watch(docTypes, (types) => {
  if (types.length > 0 && !newTypeCode.value) newTypeCode.value = types[0].code;
});

const selectedTypeGuideline = computed(() => docTypes.value.find((t) => t.code === newTypeCode.value)?.guideline ?? null);

// ---------------------------------------------------------------- 서브탭(폴더/문서 분류/리스트/답변 대기/답변 기록)
// - #documents-tab-redesign, "답변 대기"/"답변 기록"은 #document-answer-status-subtabs

type SubTab = "folder" | "status" | "type" | "list" | "pendingAnswers" | "answerHistory" | "docGraph";
const activeTab = ref<SubTab>("folder");

// ---------------------------------------------------------------- "폴더" 서브탭 (요청 1번)

const selectedFolderId = ref<string | null>(null);
const folderPage = ref<DocumentPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const folderLoading = ref(true);
const folderError = ref("");
const folderPageNum = ref(1);

async function loadFolderPage() {
  folderLoading.value = true;
  folderError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(folderPageNum.value), pageSize: "20" });
    const url =
      selectedFolderId.value === null
        ? `/projects/${props.id}/documents/page?${qs}`
        : selectedFolderId.value === UNFILED_SENTINEL
          ? `/projects/${props.id}/documents/unfiled/page?${qs}`
          : `/folders/${selectedFolderId.value}/documents/page?${qs}`;
    folderPage.value = await apiCall<DocumentPage>(url);
  } catch (err) {
    folderError.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    folderLoading.value = false;
  }
}
function onSelectFolder(folderId: string | null) {
  selectedFolderId.value = folderId;
  folderPageNum.value = 1;
  loadFolderPage();
}
function onFolderPageChange(page: number) {
  folderPageNum.value = page;
  loadFolderPage();
}

// ---------------------------------------------------------------- "상태별 조회" 서브탭(#document-status-subtab)
// 문서 상태(DocStatus.code)는 6개 고정값이라(docTypes.ts의
// STANDARD_DOC_STATUSES, 프로젝트별 커스터마이즈 없음) 별도 조회
// 없이 그대로 하드코딩한다 - "문서 분류" 탭과 똑같은 구조(왼쪽에
// 선택 목록, 오른쪽에 그 조건의 문서 목록)로, 이미 CLI(`docs list
// --status`)/REST(`statusCode` 쿼리)가 갖추고 있던 필터를 웹에도
// 노출한 것뿐이다(백엔드 변경 없음).

const DOC_STATUS_OPTIONS = [
  { code: "draft", label: "초안" },
  { code: "review", label: "검토 중" },
  { code: "pending", label: "보류" },
  { code: "approved", label: "승인됨" },
  { code: "deprecated", label: "더 이상 인용되지 않음" },
  { code: "archived", label: "보관됨" },
];

const selectedStatusCode = ref<string | null>(null);
const statusPage = ref<DocumentPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const statusLoading = ref(true);
const statusError = ref("");
const statusPageNum = ref(1);

async function loadStatusPage() {
  statusLoading.value = true;
  statusError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(statusPageNum.value), pageSize: "20" });
    if (selectedStatusCode.value) qs.set("statusCode", selectedStatusCode.value);
    statusPage.value = await apiCall<DocumentPage>(`/projects/${props.id}/documents/page?${qs}`);
  } catch (err) {
    statusError.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    statusLoading.value = false;
  }
}
function onSelectStatus(code: string | null) {
  selectedStatusCode.value = code;
  statusPageNum.value = 1;
  loadStatusPage();
}
function onStatusPageChange(page: number) {
  statusPageNum.value = page;
  loadStatusPage();
}

// ---------------------------------------------------------------- "문서 분류" 서브탭 (요청 2-2번)

const selectedDocTypeId = ref<string | null>(null);
const typePage = ref<DocumentPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const typeLoading = ref(true);
const typeError = ref("");
const typePageNum = ref(1);

async function loadTypePage() {
  typeLoading.value = true;
  typeError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(typePageNum.value), pageSize: "20" });
    if (selectedDocTypeId.value) qs.set("docTypeId", selectedDocTypeId.value);
    typePage.value = await apiCall<DocumentPage>(`/projects/${props.id}/documents/page?${qs}`);
  } catch (err) {
    typeError.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    typeLoading.value = false;
  }
}
function onSelectDocType(id: string | null) {
  selectedDocTypeId.value = id;
  typePageNum.value = 1;
  loadTypePage();
}
function onTypePageChange(page: number) {
  typePageNum.value = page;
  loadTypePage();
}

// ---------------------------------------------------------------- "리스트" 서브탭 (요청 2-1번)

type SortOption = "createdAt:desc" | "updatedAt:desc" | "createdAt:asc";
const sortOption = ref<SortOption>("createdAt:desc");
const listPage = ref<DocumentPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const listLoading = ref(true);
const listError = ref("");
const listPageNum = ref(1);

async function loadListPage() {
  listLoading.value = true;
  listError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(listPageNum.value), pageSize: "20", sort: sortOption.value });
    listPage.value = await apiCall<DocumentPage>(`/projects/${props.id}/documents/page?${qs}`);
  } catch (err) {
    listError.value = err instanceof ApiError ? err.message : "문서 목록을 불러오지 못했습니다";
  } finally {
    listLoading.value = false;
  }
}
function onSortChange() {
  listPageNum.value = 1;
  loadListPage();
}
function onListPageChange(page: number) {
  listPageNum.value = page;
  loadListPage();
}

// ---------------------------------------------------------------- "답변 대기" 서브탭 (#document-answer-status-subtabs)
// 기존 /pending/page(open+pending - 미답변 + 설계자 답변완료·AI확인대기)를
// 그대로 재사용한다 - 새 백엔드 엔드포인트 불필요.

const pendingPage = ref<QuestionPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const pendingLoading = ref(true);
const pendingError = ref("");
const pendingPageNum = ref(1);

async function loadPendingPage() {
  pendingLoading.value = true;
  pendingError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(pendingPageNum.value), pageSize: "20" });
    pendingPage.value = await apiCall<QuestionPage>(`/projects/${props.id}/pending/page?${qs}`);
  } catch (err) {
    pendingError.value = err instanceof ApiError ? err.message : "질의 목록을 불러오지 못했습니다";
  } finally {
    pendingLoading.value = false;
  }
}
function onPendingPageChange(page: number) {
  pendingPageNum.value = page;
  loadPendingPage();
}

// ---------------------------------------------------------------- "답변 기록" 서브탭 (#document-answer-status-subtabs)
// resolved(AI 확인 완료까지 끝난) 질의만 - 신설 엔드포인트.

const historyPage = ref<QuestionPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
const historyLoading = ref(true);
const historyError = ref("");
const historyPageNum = ref(1);

async function loadHistoryPage() {
  historyLoading.value = true;
  historyError.value = "";
  try {
    const qs = new URLSearchParams({ page: String(historyPageNum.value), pageSize: "20" });
    historyPage.value = await apiCall<QuestionPage>(`/projects/${props.id}/questions/resolved/page?${qs}`);
  } catch (err) {
    historyError.value = err instanceof ApiError ? err.message : "질의 목록을 불러오지 못했습니다";
  } finally {
    historyLoading.value = false;
  }
}
function onHistoryPageChange(page: number) {
  historyPageNum.value = page;
  loadHistoryPage();
}

// ---------------------------------------------------------------- "문서간 관계" 서브탭 (#document-link-graph)
// DocumentLink(정방향/역방향 링크)를 프로젝트 전체 그래프로 - 관계도
// (코드 관계 그래프) 화면이 이미 쓰는 Cytoscape 캔버스/뷰 모드를
// 그대로 재사용한다(별도 그래프 컴포넌트를 새로 안 만듦). 코드
// 관계도와 달리 "펼치기" 개념 없이 한 번에 전체를 불러온다 - 문서
// 링크는 보통 코드 관계보다 훨씬 적어서(report/챕터 구조 용도) 상한
// 걱정 없이 다 받아도 된다.

interface DocumentLinkGraphNode {
  trackingCode: string;
  title: string;
  docTypeCode: string;
}
interface DocumentLinkGraphEdge {
  fromTrackingCode: string;
  toTrackingCode: string;
  linkType: string | null;
}
interface DocumentLinkGraph {
  nodes: DocumentLinkGraphNode[];
  edges: DocumentLinkGraphEdge[];
}

const docGraphLoading = ref(true);
const docGraphError = ref("");
const docGraphViewMode = ref("hierarchical");
const docGraphNodes = ref<RelationGraphNode[]>([]);
const docGraphEdges = ref<RelationGraphEdge[]>([]);

function truncateLabel(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

async function loadDocGraph() {
  docGraphLoading.value = true;
  docGraphError.value = "";
  docGraphSelectedCode.value = null;
  docGraphDetail.value = null;
  try {
    const graph = await apiCall<DocumentLinkGraph>(`/projects/${props.id}/document-graph`);
    docGraphNodes.value = graph.nodes.map((n) => ({
      id: n.trackingCode,
      label: `${n.trackingCode}\n${truncateLabel(n.title, 30)}`,
      primaryTag: n.docTypeCode,
    }));
    // RelationGraphCanvas는 parentChild 엣지를 "자식→부모"로 가정하고
    // 화면에서 화살표를 뒤집어(부모→자식으로 보이게) 그린다(코드
    // 관계도의 DB 방향 관례) - 문서 링크는 그런 관례가 없고 "A가
    // B를 링크한다"를 그대로 A→B로 보여줘야 하므로, from/to를 미리
    // 뒤집어 넘겨 그 반전을 상쇄한다(#document-link-graph).
    docGraphEdges.value = graph.edges.map((e) => ({
      id: `${e.fromTrackingCode}->${e.toTrackingCode}`,
      from: e.toTrackingCode,
      to: e.fromTrackingCode,
      kind: "parentChild",
    }));
  } catch (err) {
    docGraphError.value = err instanceof ApiError ? err.message : "문서 관계 그래프를 불러오지 못했습니다";
  } finally {
    docGraphLoading.value = false;
  }
}

// ---------------------------------------------------------------- 우측 상세 정보 패널(#document-link-graph-detail-panel)
// 관계도("관계") 화면의 RelationDetailPanel과 달리 편집/삭제 기능이
// 없는 순수 조회 패널이라(문서 자체 편집은 에디터 화면 몫) 공용
// 컴포넌트를 새로 만들지 않고 이 화면 안에 인라인으로 둔다. 클릭한
// 노드는 더 이상 즉시 에디터로 이동하지 않고(#document-link-graph의
// 기존 동작) 이 패널에 정보를 띄운다 - 전체 화면 이동은 패널의 "전체
// 화면에서 열기" 링크로만.

interface DocGraphDetail {
  trackingCode: string;
  projectId: string;
  docTypeId: string;
  title: string;
  statusCode: string;
  priority: number | null;
  updatedAt: number;
  linksOut: { trackingCode: string; title: string; linkType: string | null; order: number }[];
  backlinks: { trackingCode: string; title: string }[];
}

const docGraphSelectedCode = ref<string | null>(null);
const docGraphDetail = ref<DocGraphDetail | null>(null);
const docGraphDetailLoading = ref(false);
const docGraphDetailError = ref("");

async function selectDocGraphNode(trackingCode: string) {
  docGraphSelectedCode.value = trackingCode;
  docGraphDetail.value = null;
  docGraphDetailError.value = "";
  docGraphDetailLoading.value = true;
  try {
    // 문서 단건 조회는 본문도 함께 오지만(#document-detail-related-codes로
    // linksOut/backlinks가 이미 같은 응답에 포함됨) 이 패널은 "본문 제외"
    // 요구사항대로 body 필드를 그냥 바인딩하지 않는다.
    docGraphDetail.value = await apiCall<DocGraphDetail>(`/documents/${trackingCode}`);
  } catch (err) {
    docGraphDetailError.value = err instanceof ApiError ? err.message : "문서 정보를 불러오지 못했습니다";
  } finally {
    docGraphDetailLoading.value = false;
  }
}

function openDocGraphDetailInEditor() {
  if (!docGraphDetail.value) return;
  router.push(`/projects/${docGraphDetail.value.projectId}/documents/${docGraphDetail.value.trackingCode}`);
}

// 추적 코드로 바로 조회(설계자 지시, #document-graph-code-lookup) -
// "문서간 관계" 탭이 로드 전이어도(다른 탭을 보고 있어도) 상관없이
// 그 탭으로 전환하고 상세 패널을 채운다. 조회 대상이 그래프의 실제
// 노드(링크가 하나라도 있는 문서)가 아니어도 상세 패널 자체는
// selectDocGraphNode()가 문서 단건 조회로 채우므로 그대로 뜨고,
// 캔버스의 선택 하이라이트만 해당 노드가 없어 안 보일 뿐이다.
const lookupCode = ref("");

function submitLookup() {
  const code = lookupCode.value.trim();
  if (!code) return;
  activeTab.value = "docGraph";
  ensureTabLoaded("docGraph");
  selectDocGraphNode(code);
}

// 탭을 처음 열 때만 그 탭의 목록을 불러온다(전부 미리 불러올 필요 없음).
const loadedTabs = new Set<SubTab>();
function ensureTabLoaded(tab: SubTab) {
  if (loadedTabs.has(tab)) return;
  loadedTabs.add(tab);
  if (tab === "folder") loadFolderPage();
  else if (tab === "status") loadStatusPage();
  else if (tab === "type") loadTypePage();
  else if (tab === "list") loadListPage();
  else if (tab === "pendingAnswers") loadPendingPage();
  else if (tab === "docGraph") loadDocGraph();
  else loadHistoryPage();
}
watch(activeTab, (tab) => ensureTabLoaded(tab), { immediate: false });

onMounted(async () => {
  await loadDocTypes();
  if (isRecentMode.value) {
    await loadRecent();
  } else if (isFavoritesMode.value) {
    await loadFavoritesPage();
  } else {
    ensureTabLoaded(activeTab.value);
  }
});
</script>

<template>
  <div class="layout">
    <h2 v-if="isRecentMode" class="recent-heading">최근 변경된 문서(변경 순)</h2>
    <h2 v-else-if="isFavoritesMode" class="recent-heading">즐겨찾기한 문서</h2>
    <ul v-if="isRecentMode" class="recent-list">
      <li v-for="doc in recentDocuments" :key="doc.trackingCode">
        <router-link :to="`/projects/${id}/documents/${doc.trackingCode}`">
          <code>{{ doc.trackingCode }}</code> {{ doc.title }}
        </router-link>
        <span class="right">
          <span class="muted">{{ docTypeLabel(doc.docTypeId) }} · {{ doc.statusCode }}</span>
        </span>
      </li>
      <li v-if="recentDocuments.length === 0" class="muted">문서가 없습니다.</li>
    </ul>

    <DocumentListPanel
      v-else-if="isFavoritesMode"
      :project-id="id"
      :items="favoritesPage.items"
      :doc-types="docTypes"
      :page="favoritesPage.page"
      :total-pages="favoritesPage.totalPages"
      :total="favoritesPage.total"
      :loading="favoritesLoading"
      :error="favoritesError"
      @page-change="onFavoritesPageChange"
    />

    <template v-else>
      <form v-if="canCreateDocument" class="create-row" @submit.prevent="create">
        <input v-model="newTitle" type="text" placeholder="새 문서 제목" />
        <select v-model="newTypeCode">
          <option v-for="t in docTypes" :key="t.id" :value="t.code">{{ t.code }}</option>
        </select>
        <button type="submit">만들기</button>
      </form>
      <p v-if="canCreateDocument && selectedTypeGuideline" class="guideline-hint">{{ selectedTypeGuideline }}</p>
      <p v-if="error" class="error">{{ error }}</p>

      <nav class="subtabs">
        <button type="button" :class="{ active: activeTab === 'folder' }" @click="activeTab = 'folder'">폴더</button>
        <button type="button" :class="{ active: activeTab === 'status' }" @click="activeTab = 'status'">상태별 조회</button>
        <button type="button" :class="{ active: activeTab === 'type' }" @click="activeTab = 'type'">문서 분류</button>
        <button type="button" :class="{ active: activeTab === 'list' }" @click="activeTab = 'list'">리스트</button>
        <button type="button" :class="{ active: activeTab === 'pendingAnswers' }" @click="activeTab = 'pendingAnswers'">답변 대기</button>
        <button type="button" :class="{ active: activeTab === 'answerHistory' }" @click="activeTab = 'answerHistory'">답변 기록</button>
        <button type="button" :class="{ active: activeTab === 'docGraph' }" @click="activeTab = 'docGraph'">문서간 관계</button>
        <form class="doc-lookup" @submit.prevent="submitLookup">
          <input v-model="lookupCode" type="text" placeholder="추적 코드로 조회(예: SP-XXXXXXXX)" />
          <button type="submit">조회</button>
        </form>
      </nav>

      <!-- 요청 1번: 폴더 좌측 + 선택된 폴더(또는 전체)의 문서 우측 -->
      <div v-if="activeTab === 'folder'" class="split">
        <FolderSelectTree :project-id="id" :selected-folder-id="selectedFolderId" @select="onSelectFolder" />
        <DocumentListPanel
          :project-id="id"
          :items="folderPage.items"
          :doc-types="docTypes"
          :page="folderPage.page"
          :total-pages="folderPage.totalPages"
          :total="folderPage.total"
          :loading="folderLoading"
          :error="folderError"
          @page-change="onFolderPageChange"
        />
      </div>

      <!-- 상태별 조회: 상태 목록 좌측 + 그 상태의 문서 우측(#document-status-subtab) -->
      <div v-else-if="activeTab === 'status'" class="split">
        <div class="type-list">
          <div class="type-item" :class="{ selected: selectedStatusCode === null }" @click="onSelectStatus(null)">전체 상태</div>
          <div
            v-for="s in DOC_STATUS_OPTIONS"
            :key="s.code"
            class="type-item"
            :class="{ selected: selectedStatusCode === s.code }"
            @click="onSelectStatus(s.code)"
          >
            {{ s.label }}
          </div>
        </div>
        <DocumentListPanel
          :project-id="id"
          :items="statusPage.items"
          :doc-types="docTypes"
          :page="statusPage.page"
          :total-pages="statusPage.totalPages"
          :total="statusPage.total"
          :loading="statusLoading"
          :error="statusError"
          @page-change="onStatusPageChange"
        />
      </div>

      <!-- 요청 2-2번: 문서 분류 좌측 + 그 분류의 문서 우측 -->
      <div v-else-if="activeTab === 'type'" class="split">
        <div class="type-list">
          <div class="type-item" :class="{ selected: selectedDocTypeId === null }" @click="onSelectDocType(null)">전체 분류</div>
          <div
            v-for="t in docTypes"
            :key="t.id"
            class="type-item"
            :class="{ selected: selectedDocTypeId === t.id }"
            @click="onSelectDocType(t.id)"
          >
            {{ t.code }} · {{ t.label }}
          </div>
        </div>
        <DocumentListPanel
          :project-id="id"
          :items="typePage.items"
          :doc-types="docTypes"
          :page="typePage.page"
          :total-pages="typePage.totalPages"
          :total="typePage.total"
          :loading="typeLoading"
          :error="typeError"
          @page-change="onTypePageChange"
        />
      </div>

      <!-- 요청 2-1번: 정렬 콤보박스 + 전체 문서 리스트 -->
      <div v-else-if="activeTab === 'list'" class="list-tab">
        <div class="sort-row">
          <select v-model="sortOption" @change="onSortChange">
            <option value="createdAt:desc">최신순</option>
            <option value="updatedAt:desc">최근 수정순</option>
            <option value="createdAt:asc">오래된 순</option>
          </select>
        </div>
        <DocumentListPanel
          :project-id="id"
          :items="listPage.items"
          :doc-types="docTypes"
          :page="listPage.page"
          :total-pages="listPage.totalPages"
          :total="listPage.total"
          :loading="listLoading"
          :error="listError"
          @page-change="onListPageChange"
        />
      </div>

      <!-- 답변 대기: 미답변(open) + 설계자 답변완료·AI확인대기(pending) -->
      <div v-else-if="activeTab === 'pendingAnswers'" class="list-tab">
        <QuestionListPanel
          :items="pendingPage.items"
          :page="pendingPage.page"
          :total-pages="pendingPage.totalPages"
          :total="pendingPage.total"
          :loading="pendingLoading"
          :error="pendingError"
          empty-text="답변 대기 중인 질의가 없습니다."
          @page-change="onPendingPageChange"
        />
      </div>

      <!-- 답변 기록: AI 확인 완료(resolved)까지 끝난 질의 -->
      <div v-else-if="activeTab === 'answerHistory'" class="list-tab">
        <QuestionListPanel
          :items="historyPage.items"
          :page="historyPage.page"
          :total-pages="historyPage.totalPages"
          :total="historyPage.total"
          :loading="historyLoading"
          :error="historyError"
          empty-text="답변 기록이 없습니다."
          @page-change="onHistoryPageChange"
        />
      </div>

      <!-- 문서간 관계: DocumentLink 전체를 프로젝트 그래프로(#document-link-graph) -->
      <div v-else class="graph-tab">
        <nav class="subtabs">
          <button
            v-for="mode in RELATION_VIEW_MODES"
            :key="mode.id"
            type="button"
            :class="{ active: docGraphViewMode === mode.id }"
            @click="docGraphViewMode = mode.id"
          >
            {{ mode.label }}
          </button>
        </nav>
        <p v-if="docGraphError" class="error">{{ docGraphError }}</p>
        <p v-if="docGraphLoading" class="muted">불러오는 중...</p>
        <template v-else-if="docGraphNodes.length === 0">
          <p class="muted graph-empty">아직 문서 간 링크가 없습니다 - <code>docs link</code>/<code>document_link</code>로 문서끼리 연결하면 여기 그래프로 보입니다.</p>
        </template>
        <div v-else class="graph-layout">
          <RelationGraphCanvas
            class="graph-canvas"
            :nodes="docGraphNodes"
            :edges="docGraphEdges"
            :selected-id="docGraphSelectedCode"
            :view-mode="docGraphViewMode"
            @select="selectDocGraphNode"
          />
          <aside class="graph-detail-panel">
            <p v-if="!docGraphSelectedCode" class="muted">노드를 클릭하면 문서 정보가 여기 표시됩니다.</p>
            <p v-else-if="docGraphDetailLoading" class="muted">불러오는 중...</p>
            <p v-else-if="docGraphDetailError" class="error">{{ docGraphDetailError }}</p>
            <template v-else-if="docGraphDetail">
              <div class="detail-header">
                <code>{{ docGraphDetail.trackingCode }}</code>
                <span class="status">{{ docGraphDetail.statusCode }}</span>
              </div>
              <h3>{{ docGraphDetail.title }}</h3>
              <dl class="detail-fields">
                <dt>분류</dt>
                <dd>{{ docTypeLabel(docGraphDetail.docTypeId) }}</dd>
                <template v-if="docGraphDetail.priority !== null">
                  <dt>우선순위</dt>
                  <dd>{{ docGraphDetail.priority }}</dd>
                </template>
                <dt>수정 시각</dt>
                <dd>{{ new Date(docGraphDetail.updatedAt).toLocaleString() }}</dd>
              </dl>

              <div class="detail-links">
                <h4>이 문서가 링크한 문서 ({{ docGraphDetail.linksOut.length }})</h4>
                <ul v-if="docGraphDetail.linksOut.length > 0" class="chip-list">
                  <li v-for="l in docGraphDetail.linksOut" :key="l.trackingCode">
                    <button type="button" class="chip" @click="selectDocGraphNode(l.trackingCode)">{{ l.trackingCode }}</button>
                  </li>
                </ul>
                <p v-else class="muted small">없음</p>
              </div>
              <div class="detail-links">
                <h4>이 문서를 링크한 문서 ({{ docGraphDetail.backlinks.length }})</h4>
                <ul v-if="docGraphDetail.backlinks.length > 0" class="chip-list">
                  <li v-for="l in docGraphDetail.backlinks" :key="l.trackingCode">
                    <button type="button" class="chip" @click="selectDocGraphNode(l.trackingCode)">{{ l.trackingCode }}</button>
                  </li>
                </ul>
                <p v-else class="muted small">없음</p>
              </div>

              <button type="button" class="open-editor-btn" @click="openDocGraphDetailInEditor">전체 화면에서 열기 →</button>
            </template>
          </aside>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.recent-heading {
  font-size: 15px;
  margin: 0 0 12px;
}
.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.create-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.create-row select {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
}
.create-row button {
  background: var(--color-primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}
.guideline-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: -12px 0 16px;
}
.subtabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.subtabs button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
}
.subtabs button:hover {
  background: var(--color-surface-hover);
}
.subtabs button.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.doc-lookup {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.doc-lookup input {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  width: 200px;
}
.doc-lookup button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
}
.doc-lookup button:hover {
  background: var(--color-surface-hover);
}
.split {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.type-list {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 10px;
  min-width: 220px;
  flex-shrink: 0;
}
.type-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.type-item:hover {
  background: var(--color-surface-hover);
}
.type-item.selected {
  background: var(--color-primary);
  color: #fff;
}
.list-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sort-row {
  display: flex;
  justify-content: flex-end;
}
.sort-row select {
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.recent-list {
  list-style: none;
  padding: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.recent-list li {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.recent-list li:last-child {
  border-bottom: none;
}
.recent-list code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 6px;
}
.graph-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 75vh;
  min-height: 480px;
}
.graph-layout {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.graph-canvas {
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
.graph-empty {
  white-space: normal;
}
.graph-detail-panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  overflow-y: auto;
  font-size: 13px;
}
.graph-detail-panel .muted {
  white-space: normal;
}
.detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.detail-header code {
  font-size: 12px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
}
.detail-header .status {
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  padding: 2px 8px;
  border-radius: 999px;
}
.graph-detail-panel h3 {
  font-size: 15px;
  margin: 0 0 12px;
}
.detail-fields {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0 0 16px;
}
.detail-fields dt {
  color: var(--color-text-muted);
}
.detail-fields dd {
  margin: 0;
}
.detail-links {
  margin-bottom: 16px;
}
.detail-links h4 {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 8px;
  font-weight: 600;
}
.chip-list {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0;
  margin: 0;
}
.chip {
  background: var(--color-surface-hover);
  color: var(--color-primary);
  border: 1px solid var(--color-border);
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
}
.chip:hover {
  background: var(--color-primary);
  color: #fff;
}
.small {
  font-size: 12px;
}
.open-editor-btn {
  display: inline-block;
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 13px;
  padding: 0;
  cursor: pointer;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
  white-space: nowrap;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
</style>
