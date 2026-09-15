<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import UserRef from "../components/UserRef.vue";
import TrackingCodeText from "../components/TrackingCodeText.vue";
import { useKanbanCardDialogStore } from "../stores/kanbanCardDialog";

const props = defineProps<{ id: string }>();
const kanbanDialog = useKanbanCardDialogStore();

interface PendingQuestion {
  trackingCode: string;
  targetType: string;
  targetKey: string;
  targetLabel: string;
  text: string;
  status: string;
}
interface FavoriteDocument {
  trackingCode: string;
  title: string;
}
interface FavoriteDocumentPage {
  items: FavoriteDocument[];
}
interface DocStatusCount {
  code: string;
  label: string;
  count: number;
}
interface StaleDocument {
  trackingCode: string;
  title: string;
  statusCode: string;
  updatedAt: number;
}
interface KanbanColumnCount {
  columnId: string;
  columnName: string;
  count: number;
}
interface ActivityItem {
  type: string;
  trackingCode: string | null;
  summary: string;
  at: string;
}
interface ProjectDashboard {
  docStatusCounts: DocStatusCount[];
  staleDocuments: StaleDocument[];
  openQuestionsCount: number;
  activeMessagesCount: number;
  kanbanColumns: KanbanColumnCount[];
  activity: ActivityItem[];
}
// 같은 계정의 다른 Claude 세션이 지금 뭘 작업 중인지(SP-976DD4ED,
// #multi-session-workclaim) - 락이 아니라 광고판이라 그냥 조회만.
interface WorkClaimItem {
  id: string;
  sessionId: string;
  sessionName: string;
  targetType: string;
  targetKey: string;
  claimedAt: string;
}
// "이 프로젝트에서 어떤 설계자의 어떤 세션이 활동 중인지"(설계자
// 지시) - 위 workClaims(무엇을 하는지)와 달리 세션/계정 자체가
// 관심사라 별도 섹션으로 둔다.
interface SessionItem {
  id: string;
  userId: string;
  name: string;
  clientKind: string;
  lastSeenAt: string;
}
interface SessionPage {
  items: SessionItem[];
}

const pending = ref<PendingQuestion[]>([]);
const favoriteDocuments = ref<FavoriteDocument[]>([]);
const dashboard = ref<ProjectDashboard | null>(null);
const workClaims = ref<WorkClaimItem[]>([]);
const sessions = ref<SessionItem[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [pendingResult, favorites, dashboardResult, claims, sessionPage] = await Promise.all([
      apiCall<{ questions: PendingQuestion[] }>(`/projects/${props.id}/pending`).catch(() => ({ questions: [] })),
      apiCall<FavoriteDocumentPage>(`/projects/${props.id}/documents/favorites/page?page=1&pageSize=5`).catch(() => ({ items: [] })),
      apiCall<ProjectDashboard>(`/projects/${props.id}/dashboard`).catch(() => null),
      apiCall<WorkClaimItem[]>(`/projects/${props.id}/work-claims`).catch(() => []),
      apiCall<SessionPage>(`/projects/${props.id}/sessions/page?page=1&pageSize=5`).catch(() => ({ items: [] })),
    ]);
    // "pending"(설계자 답변 완료, AI 확인 대기)은 AI가 처리할 몫이라
    // 설계자 화면엔 노이즈로 안 얹는다 - "open"(설계자가 지금 답해야
    // 할 것)만 보여준다.
    pending.value = pendingResult.questions.filter((q) => q.status === "open");
    favoriteDocuments.value = favorites.items;
    dashboard.value = dashboardResult;
    workClaims.value = claims;
    sessions.value = sessionPage.items;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "정보를 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function workClaimHref(c: WorkClaimItem): string | null {
  if (c.targetType === "document") return `/projects/${props.id}/documents/${c.targetKey}`;
  if (c.targetType === "plan") return `/projects/${props.id}/plans/${c.targetKey}`;
  if (c.targetType === "sourceFile") return `/projects/${props.id}/source?path=${encodeURIComponent(c.targetKey)}`;
  return null;
}

function openQuestionTarget(q: PendingQuestion) {
  if (q.targetType === "kanbanCard") kanbanDialog.show(q.targetKey);
}

function daysAgo(updatedAt: number): number {
  return Math.floor((Date.now() - updatedAt) / (24 * 60 * 60 * 1000));
}

onMounted(load);
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>

  <section v-if="!loading && dashboard" class="stat-strip">
    <h2>프로젝트 현황</h2>
    <div class="chips">
      <span v-for="s in dashboard.docStatusCounts" :key="s.code" class="chip">{{ s.label }} {{ s.count }}</span>
      <span v-if="dashboard.docStatusCounts.length === 0" class="chip muted-chip">문서 없음</span>
      <router-link :to="`/projects/${id}/messages?status=active`" class="chip chip-link">미처리 메시지 {{ dashboard.activeMessagesCount }}</router-link>
      <span class="chip">미답변 질의 {{ dashboard.openQuestionsCount }}</span>
      <span v-for="c in dashboard.kanbanColumns" :key="c.columnId" class="chip">{{ c.columnName }} {{ c.count }}</span>
    </div>
  </section>

  <section v-if="!loading && workClaims.length > 0">
    <h2>지금 작업 중</h2>
    <ul class="list">
      <li v-for="c in workClaims" :key="c.id">
        <router-link v-if="workClaimHref(c)" :to="workClaimHref(c)!">
          <code>{{ c.targetType }}</code> {{ c.targetKey }}
        </router-link>
        <span v-else><code>{{ c.targetType }}</code> {{ c.targetKey }}</span>
        <span class="right muted">{{ c.sessionName }} · {{ new Date(c.claimedAt).toLocaleString() }}</span>
      </li>
    </ul>
  </section>

  <section v-if="!loading && sessions.length > 0">
    <div class="section-header">
      <h2>활동 세션</h2>
      <router-link :to="`/projects/${id}/sessions`">더보기</router-link>
    </div>
    <ul class="list">
      <li v-for="s in sessions" :key="s.id">
        <span><UserRef :user-id="s.userId" /> {{ s.name }}</span>
        <span class="right muted">{{ s.clientKind }} · {{ new Date(s.lastSeenAt).toLocaleString() }}</span>
      </li>
    </ul>
  </section>

  <section v-if="!loading && dashboard && dashboard.staleDocuments.length > 0">
    <h2>정체된 문서</h2>
    <ul class="list">
      <li v-for="d in dashboard.staleDocuments" :key="d.trackingCode">
        <router-link :to="`/projects/${id}/documents/${d.trackingCode}`">
          <code>{{ d.trackingCode }}</code> {{ d.title }}
        </router-link>
        <span class="right muted">{{ daysAgo(d.updatedAt) }}일째 변경 없음</span>
      </li>
    </ul>
  </section>

  <section v-if="!loading && pending.length > 0">
    <h2>답변 대기 질문</h2>
    <ul class="list">
      <li v-for="q in pending" :key="q.trackingCode">
        <router-link v-if="q.targetType === 'document'" :to="`/projects/${id}/documents/${q.targetKey}`">
          <code>{{ q.trackingCode }}</code> {{ q.targetLabel }} - {{ q.text }}
        </router-link>
        <router-link v-else-if="q.targetType === 'source'" :to="`/projects/${id}/source?path=${encodeURIComponent(q.targetKey)}`">
          <code>{{ q.trackingCode }}</code> {{ q.targetLabel }} - {{ q.text }}
        </router-link>
        <button v-else type="button" class="target-link" @click="openQuestionTarget(q)">
          <code>{{ q.trackingCode }}</code> {{ q.targetLabel }} - {{ q.text }}
        </button>
      </li>
    </ul>
  </section>
  <p v-else-if="!loading" class="muted">답변 대기 중인 질문이 없습니다.</p>

  <section v-if="!loading">
    <div class="section-header">
      <h2>즐겨찾기한 문서</h2>
      <router-link :to="`/projects/${id}/documents?favorites=1`">더보기</router-link>
    </div>
    <ul v-if="favoriteDocuments.length > 0" class="list">
      <li v-for="d in favoriteDocuments" :key="d.trackingCode">
        <router-link :to="`/projects/${id}/documents/${d.trackingCode}`">
          <code>{{ d.trackingCode }}</code> {{ d.title }}
        </router-link>
      </li>
    </ul>
    <p v-else class="muted">즐겨찾기한 문서가 없습니다.</p>
  </section>

  <section v-if="!loading">
    <div class="section-header">
      <h2>최근 활동</h2>
      <router-link :to="`/projects/${id}/activity`">더보기</router-link>
    </div>
    <ul v-if="dashboard && dashboard.activity.length > 0" class="activity-list">
      <li v-for="(item, i) in dashboard.activity" :key="i">
        <TrackingCodeText :text="item.summary" />
        <span class="right muted">{{ new Date(item.at).toLocaleString() }}</span>
      </li>
    </ul>
    <p v-else class="muted">최근 활동이 없습니다.</p>
  </section>
</template>

<style scoped>
h2 {
  font-size: 15px;
  margin: 0 0 10px;
}
section {
  margin-bottom: 28px;
}
.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.section-header h2 {
  margin: 0;
}
.section-header a {
  font-size: 12px;
  color: var(--color-primary);
  text-decoration: none;
}
.section-header a:hover {
  text-decoration: underline;
}
.stat-strip .chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-block;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--color-surface);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  font-size: 12px;
  color: var(--color-text);
}
.chip-link {
  text-decoration: none;
  cursor: pointer;
}
.chip-link:hover {
  text-decoration: underline;
}
.muted-chip {
  color: var(--color-text-faint);
}
.list {
  list-style: none;
  padding: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.list li {
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.list li:last-child {
  border-bottom: none;
}
.list li a {
  color: var(--color-text);
  text-decoration: none;
  font-size: 13px;
}
.list li a code {
  font-size: 11px;
  background: var(--color-surface-hover);
  padding: 2px 6px;
  border-radius: 4px;
}
.list li a:hover {
  text-decoration: underline;
}
.target-link {
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 13px;
  text-align: left;
  padding: 0;
  cursor: pointer;
}
.target-link:hover {
  text-decoration: underline;
}
.activity-list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.activity-list li {
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.activity-list li:last-child {
  border-bottom: none;
}
.right {
  flex-shrink: 0;
  margin-left: 12px;
}
.error {
  color: var(--color-danger);
  font-size: 13px;
}
.muted {
  color: var(--color-text-muted);
  font-size: 13px;
}
</style>
