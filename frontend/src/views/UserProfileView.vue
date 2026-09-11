<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { apiCall, ApiError } from "../api/client";
import { useAuthStore } from "../stores/auth";
import UserRef from "../components/UserRef.vue";
import TrackingCodeText from "../components/TrackingCodeText.vue";
import PersonalKeysManager from "../components/PersonalKeysManager.vue";
import GiteaTokenCard from "../components/GiteaTokenCard.vue";
import AccessOverviewPanel from "../components/AccessOverviewPanel.vue";

const props = defineProps<{ id: string }>();
const auth = useAuthStore();

interface PublicProfile {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  nickname: string | null;
  displayLabel: string;
}
interface ActivityItem {
  type: string;
  trackingCode: string | null;
  summary: string;
  at: string;
}

const profile = ref<PublicProfile | null>(null);
const activity = ref<ActivityItem[]>([]);
const loading = ref(true);
const error = ref("");

const isSelf = computed(() => props.id === auth.me?.id);

const editing = ref(false);
const emailDraft = ref("");
const phoneDraft = ref("");
const emailVisibleDraft = ref(false);
const phoneVisibleDraft = ref(false);
const nicknameDraft = ref("");
const saveError = ref("");
const saving = ref(false);

const NICKNAME_COOLDOWN_DAYS = 7;
const nicknameCooldownRemainingDays = computed(() => {
  const changedAt = auth.me?.nicknameChangedAt;
  if (!changedAt) return 0;
  const elapsedMs = Date.now() - new Date(changedAt).getTime();
  const remaining = NICKNAME_COOLDOWN_DAYS - elapsedMs / (24 * 60 * 60 * 1000);
  return remaining > 0 ? Math.ceil(remaining) : 0;
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [p, a] = await Promise.all([
      apiCall<PublicProfile>(`/users/${props.id}`),
      apiCall<ActivityItem[]>(`/users/${props.id}/activity`).catch(() => []),
    ]);
    profile.value = p;
    activity.value = a;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "프로필을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

function startEdit() {
  emailDraft.value = auth.me?.email ?? "";
  phoneDraft.value = auth.me?.phone ?? "";
  emailVisibleDraft.value = auth.me?.emailVisible ?? false;
  phoneVisibleDraft.value = auth.me?.phoneVisible ?? false;
  nicknameDraft.value = auth.me?.nickname ?? "";
  saveError.value = "";
  editing.value = true;
}

async function save() {
  saving.value = true;
  saveError.value = "";
  try {
    await apiCall("/auth/me", {
      method: "PUT",
      body: JSON.stringify({
        email: emailDraft.value,
        phone: phoneDraft.value,
        emailVisible: emailVisibleDraft.value,
        phoneVisible: phoneVisibleDraft.value,
        nickname: nicknameDraft.value,
      }),
    });
    await auth.loadMe();
    editing.value = false;
    await load();
  } catch (err) {
    saveError.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
watch(() => props.id, load);
</script>

<template>
  <p v-if="loading">불러오는 중...</p>
  <p v-else-if="error" class="error">{{ error }}</p>
  <template v-else-if="profile">
    <h1><UserRef :user-id="profile.id" /> {{ profile.username }}</h1>

    <section class="card">
      <h2>연락처</h2>
      <template v-if="!editing">
        <div class="field"><span class="label">닉네임</span> <span>{{ profile.displayLabel }}</span></div>
        <div class="field"><span class="label">이메일</span> <span>{{ profile.email ?? "비공개" }}</span></div>
        <div class="field"><span class="label">전화번호</span> <span>{{ profile.phone ?? "비공개" }}</span></div>
        <button v-if="isSelf" class="edit-btn" @click="startEdit">수정</button>
      </template>
      <template v-else>
        <div class="field">
          <label>닉네임 <input v-model="nicknameDraft" type="text" placeholder="설정하지 않으면 '설계자'로 표시됩니다" /></label>
          <p v-if="nicknameCooldownRemainingDays > 0" class="hint">
            최근 변경 후 {{ nicknameCooldownRemainingDays }}일간 다시 변경할 수 없습니다(값을 바꾸지 않으면 그대로 저장 가능).
          </p>
        </div>
        <div class="field">
          <label>이메일 <input v-model="emailDraft" type="text" /></label>
          <label class="checkbox"><input v-model="emailVisibleDraft" type="checkbox" /> 다른 사람에게 공개</label>
        </div>
        <div class="field">
          <label>전화번호 <input v-model="phoneDraft" type="text" /></label>
          <label class="checkbox"><input v-model="phoneVisibleDraft" type="checkbox" /> 다른 사람에게 공개</label>
        </div>
        <div class="actions">
          <button :disabled="saving" @click="save">저장</button>
          <button type="button" class="cancel-btn" @click="editing = false">취소</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </template>
    </section>

    <PersonalKeysManager v-if="isSelf" />
    <GiteaTokenCard v-if="isSelf" />

    <section v-if="isSelf" class="card">
      <h2>내 접근 제한</h2>
      <AccessOverviewPanel endpoint="/auth/me/access-overview" />
    </section>

    <section class="card">
      <h2>최근 활동</h2>
      <ul v-if="activity.length > 0" class="activity-list">
        <li v-for="(item, i) in activity" :key="i">
          <TrackingCodeText :text="item.summary" />
          <span class="at">{{ new Date(item.at).toLocaleString() }}</span>
        </li>
      </ul>
      <p v-else class="muted">최근 활동이 없습니다.</p>
    </section>
  </template>
</template>

<style scoped>
h1 {
  font-size: 20px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 16px;
  margin-bottom: 20px;
}
h2 {
  font-size: 14px;
  margin: 0 0 12px;
  color: #555;
}
.field {
  margin-bottom: 8px;
  font-size: 13px;
}
.field .label {
  display: inline-block;
  width: 90px;
  color: #888;
}
.field input {
  padding: 5px 8px;
  border: 1px solid #d8dae0;
  border-radius: 6px;
  margin-left: 6px;
}
.checkbox {
  margin-left: 10px;
  font-size: 12px;
  color: #666;
}
.hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: #b58a00;
}
.edit-btn,
.actions button {
  background: #fff;
  border: 1px solid #d8dae0;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
.actions .cancel-btn {
  color: #888;
}
.activity-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.activity-list li {
  padding: 6px 0;
  border-bottom: 1px solid #eee;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.activity-list li:last-child {
  border-bottom: none;
}
.at {
  color: #999;
  font-size: 11px;
  flex-shrink: 0;
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
