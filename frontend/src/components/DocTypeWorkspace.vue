<template>
  <div class="row no-wrap" style="min-height: calc(100vh - 160px)">
    <ProjectSidebar>
      <PageHeader variant="section" :title="title" :count="items.length">
        <template #actions>
          <q-btn v-if="!readOnly" size="sm" color="primary" icon="add" :label="createLabel" :to="createRoute" />
        </template>
      </PageHeader>
      <!-- 설계자 요청(2026-09-22 후속) - 분류/상태별로 걸러보거나 키워드로
           검색할 수 있어야 한다. 처음엔 분류를 탭으로 뒀었는데, 상태
           필터/키워드 검색까지 추가되면서 축이 여러 개가 돼 탭보단
           다이얼로그로 한 번에 설정하는 편이 낫다는 지적을 받아 이 모양으로
           바꿨다. 지금 적용된 필터는 쿼리 스트링(?kind=&state=&q=)에 반영해
           뒤로가기/새로고침에도 유지되게 한다. -->
      <div class="row items-center q-gutter-xs q-mb-sm">
        <q-btn flat dense size="sm" icon="filter_list" label="필터" @click="openFilterDialog" />
        <q-chip v-if="selectedKind" dense removable color="primary" text-color="white" @remove="clearFilter('kind')">
          분류: {{ kindLabels[selectedKind] ?? selectedKind }}
        </q-chip>
        <q-chip v-if="selectedState" dense removable color="primary" text-color="white" @remove="clearFilter('state')">
          상태: {{ selectedState }}
        </q-chip>
        <q-chip v-if="searchQuery" dense removable color="primary" text-color="white" @remove="clearFilter('q')">
          검색: {{ searchQuery }}
        </q-chip>
      </div>
      <!-- design-notes.md "문서 의존성" - dependsOn readiness(아직 해소되지
           않은 의존 개수) 오름차순 정렬을 docs.list의 sort 옵션으로 노출.
           docs.search는 이 정렬을 지원하지 않으므로 키워드 검색 중엔 숨긴다. -->
      <q-toggle
        v-if="!searchQuery"
        v-model="sortByDependency"
        label="의존성 순 정렬"
        dense
        size="sm"
        class="q-mb-sm"
        @update:model-value="load"
      />
      <div v-if="loading" class="text-caption">불러오는 중...</div>
      <q-list v-else bordered separator>
        <q-item
          v-for="doc in items"
          :key="doc.code"
          clickable
          :active="selected?.code === doc.code"
          active-class="bg-blue-1"
          @click="select(doc.code)"
        >
          <q-item-section>
            <q-item-label>{{ doc.title }}</q-item-label>
            <q-item-label caption>{{ doc.code }} · {{ doc.kind }} · {{ doc.chapter ?? "-" }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge :color="stateColor(doc.state)">{{ doc.state }}</q-badge>
          </q-item-section>
        </q-item>
        <EmptyState v-if="items.length === 0" as="item" :message="hasActiveFilter ? '조건에 맞는 문서가 없습니다.' : '문서가 없습니다.'" />
      </q-list>
    </ProjectSidebar>

    <q-separator vertical />

    <div class="col q-pa-md" style="overflow-y: auto">
      <template v-if="selected">
        <div class="row items-center justify-between">
          <div class="text-h6">{{ selected.title }}</div>
          <q-badge :color="stateColor(selected.state)">{{ selected.state }}</q-badge>
        </div>
        <div class="text-caption q-mb-sm">
          {{ selected.code }} · author: {{ selected.author }} · etag: {{ selected.etag }}
          <span v-if="selected.chapter"> · chapter: {{ selected.chapter }}</span>
        </div>

        <!-- design-notes.md "문서간 참조"/"의존성" - related/dependsOn을 태그
             배지로 보여주고, 클릭하면(다른 type이어도) 그 문서로 바로 이동한다. -->
        <div class="q-gutter-xs q-mb-sm">
          <CategoryPill
            v-for="ref in selected.related"
            :key="'related-' + ref.code"
            color="primary"
            class="cursor-pointer"
            @click="select(ref.code)"
          >
            related: {{ ref.code }}
          </CategoryPill>
          <CategoryPill
            v-for="ref in selected.dependsOn"
            :key="'dependsOn-' + ref.code"
            color="deep-orange"
            class="cursor-pointer"
            @click="select(ref.code)"
          >
            dependsOn: {{ ref.code }}
          </CategoryPill>
          <q-btn v-if="!readOnly" size="sm" dense flat icon="add_link" label="태그 추가" @click="openTagDialog" />
        </div>

        <div v-if="!readOnly" class="q-gutter-sm q-mb-md">
          <q-btn
            v-for="t in availableTransitions"
            :key="t.to"
            size="sm"
            :color="t.color ?? 'primary'"
            :label="t.label"
            :loading="transitioning === t.to"
            @click="transition(t.to)"
          />
        </div>
        <div v-if="actionError" class="text-negative text-caption q-mb-sm">{{ actionError }}</div>

        <div class="text-caption text-grey-8 q-mb-xs">Source View</div>
        <MarkdownSourceView :key="selected.code" :content="selected.content" :read-only="readOnly" @save="saveContent" />

        <q-separator class="q-my-md" />
        <!-- design-notes.md "UI 설계" - question/answer/opinion은 별도 Q&A 탭이
             아니라 PR 리뷰 코멘트처럼 그 문서를 보는 화면 안에 통합된다. -->
        <DocumentDiscussion ref="discussionRef" :owner="owner" :project-id="projectId" :parent-code="selected.code" :highlight-code="highlightCode" />
      </template>
      <!-- 설계자 요청(2026-09-22 후속) - Documents/Plans/Issues에서 문서를
           선택하지 않았을 때 빈 안내 문구 대신 지금 목록(필터 적용 후 기준)의
           상태별/분류별 종합 현황을 보여준다. Trackers/Tests도 같은 컴포넌트를
           쓰므로 자연히 상태별 현황을 같이 얻는다(분류는 kind가 1개뿐이라 그
           블록만 안 뜬다). -->
      <div v-else class="q-pa-sm">
        <div class="text-subtitle1 q-mb-xs">{{ title }} 종합 현황</div>
        <div class="text-caption text-grey-8 q-mb-md">왼쪽 목록에서 문서를 선택하면 상세 내용을 볼 수 있습니다.</div>
        <template v-if="stateBreakdown.length > 0">
          <div class="text-caption text-grey-8 q-mb-xs">상태별</div>
          <div class="row q-gutter-md q-mb-md">
            <div v-for="s in stateBreakdown" :key="s.state" class="row items-center q-gutter-xs">
              <q-badge :color="stateColor(s.state)">{{ s.state }}</q-badge>
              <span class="text-caption">{{ s.count }}</span>
            </div>
          </div>
        </template>
        <template v-if="kindBreakdown.length > 1">
          <div class="text-caption text-grey-8 q-mb-xs">분류별</div>
          <div class="row q-gutter-md q-mb-md">
            <div v-for="k in kindBreakdown" :key="k.kind" class="row items-center q-gutter-xs">
              <CategoryPill>{{ kindLabels[k.kind] ?? k.kind }}</CategoryPill>
              <span class="text-caption">{{ k.count }}</span>
            </div>
          </div>
        </template>

        <!-- 설계자 요청(2026-09-22 후속) - REST API에서 각 추적 코드별로 어떤
             동작이 언제 있었는지 activity.summary로 모아 최근 30일 히트맵 +
             최근 활동 로그를 보여준다. 지금 걸린 분류/상태 필터를 그대로
             반영한다(상태별/분류별 집계와 같은 판단). -->
        <div v-if="heatmapWeeks.length > 0" class="q-mb-md">
          <div class="text-caption text-grey-8 q-mb-xs">최근 {{ activityHeatmap.length }}일 활동</div>
          <div class="row q-gutter-xs">
            <div v-for="(week, wi) in heatmapWeeks" :key="wi" class="column q-gutter-xs">
              <div
                v-for="(day, di) in week"
                :key="di"
                class="activity-heatmap-cell"
                :style="{ background: day ? heatColor(day.count) : 'transparent' }"
                :title="day ? `${day.date}: ${day.count}건` : ''"
              />
            </div>
          </div>
        </div>
        <template v-if="activityRecent.length > 0">
          <div class="text-caption text-grey-8 q-mb-xs">최근 활동</div>
          <q-list dense bordered separator style="max-width: 480px">
            <q-item v-for="(entry, i) in activityRecent" :key="i">
              <q-item-section>
                <q-item-label>{{ entry.code }} · {{ entry.action }}</q-item-label>
                <q-item-label caption>{{ agentLabel(entry) }} · {{ new Date(entry.createdAt).toLocaleString() }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </template>
      </div>
    </div>

    <q-dialog v-model="showTagDialog">
      <q-card style="width: var(--gh-dialog-width-md)">
        <q-card-section class="text-h6">태그 추가</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-select v-model="tagKind" :options="['related', 'dependsOn']" label="종류" />
          <q-input v-model="tagCode" label="대상 추적 코드 (예: SP-XXXXXXXX)" />
          <div v-if="tagError" class="text-negative text-caption">{{ tagError }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn color="primary" label="추가" :loading="tagging" @click="addTag" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="filterDialogOpen">
      <q-card style="width: var(--gh-dialog-width-md)">
        <q-card-section class="text-h6">필터</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-select
            v-if="kinds.length > 1"
            v-model="draftKind"
            :options="kindOptions"
            option-label="label"
            option-value="value"
            emit-value
            map-options
            dense
            label="분류"
          />
          <q-select
            v-if="states.length > 0"
            v-model="draftState"
            :options="stateOptions"
            option-label="label"
            option-value="value"
            emit-value
            map-options
            dense
            label="상태"
          />
          <q-input v-model="draftQuery" dense label="키워드 검색" @keyup.enter="applyFilters" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="초기화" @click="resetFilterDraft" />
          <q-btn flat label="취소" v-close-popup />
          <q-btn color="primary" label="적용" @click="applyFilters" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import DocumentDiscussion from "components/DocumentDiscussion.vue";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import ProjectSidebar from "components/ProjectSidebar.vue";
import PageHeader from "components/PageHeader.vue";
import EmptyState from "components/EmptyState.vue";
import CategoryPill from "components/CategoryPill.vue";
import { stateColor } from "src/utils/stateColor";
import * as api from "src/api/client";

interface TaggedRef {
  code: string;
  etag: string;
}
interface DocSummary {
  code: string;
  parent_id: string | null;
  etag: string;
  type: string;
  kind: string;
  state: string;
  chapter: string | null;
  title: string;
  author: string;
  related: TaggedRef[];
  dependsOn: TaggedRef[];
}
interface DocFull extends DocSummary {
  content: string;
}
interface TransitionOption {
  to: string;
  label: string;
  color?: string;
}

const props = withDefaults(
  defineProps<{
    owner: string;
    projectId: string;
    type: string;
    kinds: string[];
    title: string;
    createLabel?: string;
    createRoute?: string;
    readOnly?: boolean;
    transitionsByState?: Record<string, TransitionOption[]>;
    // 설계자 요청(2026-09-21 후속) - 지금 선택된 문서의 추적 코드를
    // /{owner}/{projectId}/{documents|plans|issues}/{code} path segment로
    // 반영해 Browser History/새로고침에서 그 상태가 살아남게 한다.
    // RecentQaFeed에서 넘어올 때도(예전엔 ?open=으로만 왔음) 이제 이
    // prop이 곧 그 path segment 값이다 - trackers/tests는 이번 스코프
    // 밖이라 여전히 query(open=)로만 넘어온다(URL_SYNCED_TYPES에
    // "tracker"/"test"가 없어서 select()가 자동으로 push를 건너뛴다).
    code?: string;
    highlightCode?: string;
    // 설계자 요청(2026-09-22 후속) - 필터 다이얼로그의 분류 선택지에
    // 코드(SP/RP/...) 대신/같이 보여줄 한글 이름 - 안 넘기면 코드만 보인다.
    kindLabels?: Record<string, string>;
    // 상태 필터 선택지(documentRules.ts의 STATES_BY_TYPE과 맞춘 것) -
    // 안 넘기거나 빈 배열이면 상태 필터 자체를 숨긴다.
    states?: string[];
  }>(),
  { readOnly: false, createLabel: "새로 만들기", createRoute: "", transitionsByState: () => ({}), kindLabels: () => ({}), states: () => [] }
);

// design-notes.md 참고 - "관련 문서"(related/dependsOn)는 타입이 달라도
// 서로 참조할 수 있다(예: Plan에서 Document를 참조) - select()가 그
// 대상의 실제 type을 보고 맞는 tab의 URL로 이동시킨다(지금 보고 있는
// tab의 URL을 그대로 쓰면 다른 타입인데 documents/plans/issues 셋
// 다 이 컴포넌트를 그대로 재사용하므로, 실제로 화면이 바뀌는 게 아니라
// "잘못된 탭의 URL에 다른 타입 문서가 얹힌" 것처럼 보이는 버그가 된다).
const URL_SYNCED_TYPES: Record<string, string> = { doc: "documents", plan: "plans", issue: "issues" };

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const items = ref<DocSummary[]>([]);
const selected = ref<DocFull | null>(null);
const transitioning = ref<string | null>(null);
const actionError = ref("");

const sortByDependency = ref(false);
const loading = ref(true);

// 설계자 요청(2026-09-22 후속) - 분류/상태/키워드 검색 세 축의 필터를
// 쿼리 스트링(?kind=&state=&q=)에 반영한다 - "전체"/미검색은 그 쿼리
// 키 자체를 생략해서 지금까지의 "필터 없이 전체 보기" 기본 동작과 URL
// 모양이 그대로 호환된다. 오래된/잘못된 URL(kind가 이 탭의 kinds에
// 없는 값 등)이면 조용히 "전체"로 되돌아간다.
function stringFromRoute(key: "kind" | "state" | "q", validValues?: readonly string[]): string {
  const q = route.query[key];
  if (typeof q !== "string") return "";
  if (validValues && !validValues.includes(q)) return "";
  return q;
}
// 설계자 지적(2026-09-22 후속, "더 최적화해") - Documents 탭은 kinds를
// 서버(docKind.list)에서 비동기로 받아온다 - 여기서 마운트 시점에
// props.kinds로 즉시 검증하려 들면, 그 fetch가 끝날 때까지 페이지
// 렌더링 자체를 막아야 했다(예전엔 DocumentsTab.vue가 그렇게 했다 -
// 매번 여분의 네트워크 왕복만큼 화면이 늦게 뜸). 그 블로킹을 없애려고
// kind는 URL 값을 낙관적으로 그대로 받아들이고(검증 안 함), kinds가
// 실제로 채워진 뒤 그 값이 없는 값이면 그때 되돌린다(아래 watch) -
// state는 모든 탭이 항상 정적 배열을 넘겨 이 경합이 없어 그대로 둔다.
const selectedKind = ref(props.kinds.length > 0 ? stringFromRoute("kind", props.kinds) : stringFromRoute("kind"));
const selectedState = ref(stringFromRoute("state", props.states));
const searchQuery = ref(stringFromRoute("q"));
const hasActiveFilter = computed(() => !!(selectedKind.value || selectedState.value || searchQuery.value));

watch(
  () => props.kinds,
  (kinds) => {
    if (kinds.length > 0 && selectedKind.value && !kinds.includes(selectedKind.value)) {
      selectedKind.value = "";
      syncFilterQueryAndLoad();
    }
  }
);

// 설계자 요청(2026-09-22 후속) - 문서를 선택하지 않았을 때 지금 목록(필터
// 적용 후 기준)의 상태별/분류별 개수를 보여준다 - props.states/kinds
// 순서대로 먼저 나열하고, 그 목록에 없는 값(예: 어휘에 없는 예전 값)은
// 뒤에 덧붙인다.
const stateBreakdown = computed(() => {
  const counts = new Map<string, number>();
  for (const doc of items.value) counts.set(doc.state, (counts.get(doc.state) ?? 0) + 1);
  const known = props.states.filter((s) => counts.has(s));
  const rest = [...counts.keys()].filter((s) => !props.states.includes(s));
  return [...known, ...rest].map((state) => ({ state, count: counts.get(state)! }));
});
const kindBreakdown = computed(() => {
  const counts = new Map<string, number>();
  for (const doc of items.value) counts.set(doc.kind, (counts.get(doc.kind) ?? 0) + 1);
  const known = props.kinds.filter((k) => counts.has(k));
  const rest = [...counts.keys()].filter((k) => !props.kinds.includes(k));
  return [...known, ...rest].map((kind) => ({ kind, count: counts.get(kind)! }));
});

// 설계자 요청(2026-09-22 후속) - "각 추적 코드별로 어떤 동작을 언제
// 얼마나 했는지" 히트맵/활동 로그. 지금 걸린 분류/상태 필터를 그대로
// 반영해 activity.summary를 부른다(상태별/분류별 집계와 같은 판단) -
// load()가 문서 목록을 새로 불러올 때마다 같이 갱신한다.
interface HeatmapDay {
  date: string;
  count: number;
}
interface ActivityEntry {
  code: string;
  action: string;
  channel: string;
  // 설계자 요청(2026-09-22 후속) - 같은 계정을 쓰는 여러 에이전트를
  // 구별하기 위한 선택 필드(architect 채널은 항상 null).
  agentId: string | null;
  createdAt: string;
}
const activityHeatmap = ref<HeatmapDay[]>([]);
const activityRecent = ref<ActivityEntry[]>([]);

const heatmapWeeks = computed(() => {
  const days = activityHeatmap.value;
  if (days.length === 0) return [];
  const weeks: (HeatmapDay | null)[][] = [];
  let week: (HeatmapDay | null)[] = [];
  const firstDow = new Date(`${days[0].date}T00:00:00`).getDay(); // 0=일요일
  for (let i = 0; i < firstDow; i++) week.push(null);
  for (const day of days) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
});

// GitHub 컨트리뷰션 그래프와 같은 5단계 팔레트 - 익숙한 배색이라 별도
// 범례 없이도 "진할수록 활동이 많았다"는 걸 바로 알 수 있다.
function heatColor(count: number): string {
  if (count === 0) return "#ebedf0";
  if (count <= 2) return "#9be9a8";
  if (count <= 5) return "#40c463";
  if (count <= 10) return "#30a14e";
  return "#216e39";
}

// 설계자 요청(2026-09-22 후속) - "AI 에이전트 N개와 설계자 1명이 같은
// 계정으로 작업한다" - agentId가 있으면 그 값으로, 없으면(architect
// 이거나 agentId를 설정 안 한 에이전트) 기존처럼 "Claude"/"architect"로.
function agentLabel(entry: ActivityEntry): string {
  if (entry.channel !== "agent") return "architect";
  return entry.agentId ? `Claude (${entry.agentId})` : "Claude";
}

async function loadActivity() {
  const result = await api.getActivitySummary(auth.apiKey!, props.owner, props.projectId, {
    type: props.type,
    kind: selectedKind.value || undefined,
    state: selectedState.value || undefined,
  });
  if (result.ok) {
    const data = result.data as { heatmap: HeatmapDay[]; recent: ActivityEntry[] };
    activityHeatmap.value = data.heatmap;
    activityRecent.value = data.recent;
  }
}

const kindOptions = computed(() => [
  { label: "전체", value: "" },
  ...props.kinds.map((k) => ({ label: props.kindLabels[k] ? `${k} · ${props.kindLabels[k]}` : k, value: k })),
]);
const stateOptions = computed(() => [{ label: "전체", value: "" }, ...props.states.map((s) => ({ label: s, value: s }))]);

async function load() {
  loading.value = true;
  const result = searchQuery.value
    ? await api.searchDocuments(auth.apiKey!, props.owner, props.projectId, {
        q: searchQuery.value,
        type: props.type,
        kind: selectedKind.value || undefined,
        state: selectedState.value || undefined,
      })
    : await api.listDocuments(auth.apiKey!, props.owner, props.projectId, {
        type: props.type,
        kind: selectedKind.value || undefined,
        state: selectedState.value || undefined,
        sort: sortByDependency.value ? "dependency" : undefined,
      });
  loading.value = false;
  if (result.ok) items.value = (result.data as { items: DocSummary[] }).items;
  loadActivity();
}

// 지금 적용된 필터(selectedKind/selectedState/searchQuery) 값 그대로
// 쿼리 스트링에 반영하고 목록을 다시 불러온다 - 다이얼로그의 "적용"과
// 칩의 "x"(개별 필터 제거) 둘 다 이 함수 하나로 처리한다.
function syncFilterQueryAndLoad() {
  const next = { ...route.query } as Record<string, string>;
  const entries: [string, string][] = [
    ["kind", selectedKind.value],
    ["state", selectedState.value],
    ["q", searchQuery.value],
  ];
  for (const [key, value] of entries) {
    if (value) next[key] = value;
    else delete next[key];
  }
  router.push({ path: route.path, query: next });
  load();
}

const filterDialogOpen = ref(false);
const draftKind = ref("");
const draftState = ref("");
const draftQuery = ref("");

function openFilterDialog() {
  draftKind.value = selectedKind.value;
  draftState.value = selectedState.value;
  draftQuery.value = searchQuery.value;
  filterDialogOpen.value = true;
}
function resetFilterDraft() {
  draftKind.value = "";
  draftState.value = "";
  draftQuery.value = "";
}
function applyFilters() {
  selectedKind.value = draftKind.value;
  selectedState.value = draftState.value;
  searchQuery.value = draftQuery.value.trim();
  filterDialogOpen.value = false;
  syncFilterQueryAndLoad();
}
function clearFilter(key: "kind" | "state" | "q") {
  if (key === "kind") selectedKind.value = "";
  if (key === "state") selectedState.value = "";
  if (key === "q") searchQuery.value = "";
  syncFilterQueryAndLoad();
}

async function loadSelected(code: string) {
  actionError.value = "";
  const result = await api.getDocument(auth.apiKey!, props.owner, props.projectId, code);
  if (result.ok) selected.value = result.data as DocFull;
}

async function select(code: string) {
  await loadSelected(code);
  if (!selected.value) return;
  const segment = URL_SYNCED_TYPES[selected.value.type];
  if (!segment) return;
  // 같은 탭 안에서(=같은 type) 이동할 때만 지금 걸려있던 필터를 URL에
  // 실어 보낸다 - related/dependsOn으로 다른 type 탭(예: plan)으로
  // 건너뛸 땐 이 필터가 그쪽에서 의미가 없으므로 싣지 않는다.
  const query: Record<string, string> = {};
  if (selected.value.type === props.type) {
    if (selectedKind.value) query.kind = selectedKind.value;
    if (selectedState.value) query.state = selectedState.value;
    if (searchQuery.value) query.q = searchQuery.value;
  }
  router.push({ path: `/${props.owner}/${props.projectId}/${segment}/${code}`, query });
}

const availableTransitions = ref<TransitionOption[]>([]);
watch(selected, (doc) => {
  availableTransitions.value = doc ? props.transitionsByState[doc.state] ?? [] : [];
});

async function transition(to: string) {
  if (!selected.value) return;
  transitioning.value = to;
  actionError.value = "";
  // docs.transition의 실제 계약: etag가 아니라 "지금 이 상태일 거라
  // 예상한다"는 현재 상태 문자열로 낙관적 동시성을 건다.
  const result = await api.transitionDocument(auth.apiKey!, props.owner, props.projectId, selected.value.code, to, selected.value.state);
  transitioning.value = null;
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "전이에 실패했습니다.";
    return;
  }
  await load();
  await loadSelected(selected.value.code);
}

// design-notes.md 후속 판단(설계자 요청) - "Source View"는 view/edit 두
// 모드를 가진 것으로 정의됐다(MarkdownSourceView) - 기존 문서의 본문도
// 여기서 바로 편집해 docs.update로 저장할 수 있다.
async function saveContent(markdown: string) {
  if (!selected.value) return;
  actionError.value = "";
  const result = await api.updateDocument(auth.apiKey!, props.owner, props.projectId, selected.value.code, { etag: selected.value.etag, content: markdown });
  if (!result.ok) {
    actionError.value = result.reason?.join(", ") ?? "저장에 실패했습니다.";
    return;
  }
  await load();
  await loadSelected(selected.value.code);
}

const showTagDialog = ref(false);
const tagKind = ref<"related" | "dependsOn">("related");
const tagCode = ref("");
const tagging = ref(false);
const tagError = ref("");

function openTagDialog() {
  tagCode.value = "";
  tagError.value = "";
  showTagDialog.value = true;
}

// docs.tag는 related/dependsOn을 "전체 교체"로 받으므로(design-notes.md
// "문서간 참조" - 항목 하나만 추가/제거하는 액션이 아니다), 대상의 최신
// etag를 docs.get으로 확인한 뒤 지금 배열에 이어붙여서 다시 통째로 보낸다.
async function addTag() {
  if (!selected.value) return;
  tagging.value = true;
  tagError.value = "";

  const targetResult = await api.getDocument(auth.apiKey!, props.owner, props.projectId, tagCode.value);
  if (!targetResult.ok) {
    tagging.value = false;
    tagError.value = targetResult.reason?.join(", ") ?? "대상 문서를 찾을 수 없습니다.";
    return;
  }
  const target = targetResult.data as { code: string; etag: string };

  const nextRelated = tagKind.value === "related" ? [...selected.value.related, { code: target.code, etag: target.etag }] : undefined;
  const nextDependsOn = tagKind.value === "dependsOn" ? [...selected.value.dependsOn, { code: target.code, etag: target.etag }] : undefined;

  const result = await api.tagDocument(auth.apiKey!, props.owner, props.projectId, selected.value.code, {
    etag: selected.value.etag,
    related: nextRelated,
    dependsOn: nextDependsOn,
  });
  tagging.value = false;
  if (!result.ok) {
    tagError.value = result.reason?.join(", ") ?? "태그 추가에 실패했습니다.";
    return;
  }
  showTagDialog.value = false;
  await loadSelected(selected.value.code);
}

onMounted(async () => {
  await load();
  if (props.code) await loadSelected(props.code);
});
watch(() => [props.owner, props.projectId], load);
// 브라우저 뒤로/앞으로 가기로 쿼리의 필터가 바뀐 경우 - syncFilterQueryAndLoad()가
// 스스로 만든 변화는 이미 각 ref가 그 값이라 여기서 다시 안 걸림(무한
// 루프/중복 조회 방지), 뒤로가기처럼 이 컴포넌트 바깥에서 URL이 바뀐
// 경우만 세 필터 ref를 맞추고 다시 불러온다.
watch(
  () => [route.query.kind, route.query.state, route.query.q],
  () => {
    const nextKind = stringFromRoute("kind", props.kinds);
    const nextState = stringFromRoute("state", props.states);
    const nextQuery = stringFromRoute("q");
    if (nextKind === selectedKind.value && nextState === selectedState.value && nextQuery === searchQuery.value) return;
    selectedKind.value = nextKind;
    selectedState.value = nextState;
    searchQuery.value = nextQuery;
    load();
  }
);
// 브라우저 뒤로/앞으로 가기 - path의 :code가 바뀌면 그에 맞는 문서를
// 다시 불러온다. select()가 이미 방금 반영해둔 경우(사용자가 방금
// 클릭해서 router.push가 스스로 이 변화를 일으킨 경우)는 중복 조회를
// 건너뛴다.
watch(
  () => props.code,
  (code) => {
    if (!code) {
      selected.value = null;
      return;
    }
    if (selected.value?.code === code) return;
    loadSelected(code);
  }
);
</script>

<style scoped>
.activity-heatmap-cell {
  width: 11px;
  height: 11px;
  border-radius: 2px;
}
</style>
