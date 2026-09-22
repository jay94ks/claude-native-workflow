<template>
  <q-layout view="lHh Lpr lFf">
    <q-header style="background: var(--gh-header-bg)">
      <q-toolbar style="height: 62px" class="q-gutter-x-md">
        <!-- 반응형 시나리오(설계자 요청) - 좁은 화면에서 270px 좌측 패널이
             오프캔버스로 숨는데, 이걸 다시 꺼내는 햄버거를 로고 좌측에 둔다.
             프로젝트 화면(좌측 패널이 존재하는 화면)에서만 의미가 있다. -->
        <q-btn v-if="currentProject" flat dense round icon="menu" color="white" class="hamburger-btn" @click="ui.toggleSidebar()" />
        <router-link to="/projects" class="row items-center no-wrap" style="text-decoration: none; gap: 8px">
          <q-icon name="hub" color="white" size="28px" />
          <span v-if="!currentProject" class="text-white text-weight-bold" style="font-size: 18px">claude-native-workflow</span>
        </router-link>

        <!-- 프로젝트 화면일 땐 예전에 ProjectShell 안에 따로 있던 브레드크럼/타이틀/배지 줄을
             이 탑바 안으로 합친다(탑바+그 바로 밑 바를 하나로 통합해달라는 설계자 요청). -->
        <template v-if="currentProject">
          <div class="row items-center no-wrap text-white" style="gap: 8px">
            <router-link to="/projects" class="text-white text-caption" style="opacity: 0.75; text-decoration: none">Projects</router-link>
            <span style="opacity: 0.5">/</span>
            <span class="text-weight-bold">{{ currentProject.name }}</span>
            <span class="gh-pill" style="background: transparent; border-color: rgba(255, 255, 255, 0.4); color: white">
              <q-icon :name="currentProject.visibility === 'PUBLIC' ? 'public' : 'lock'" size="12px" />
              {{ currentProject.visibility === "PUBLIC" ? "Public" : "Private" }}
            </span>
            <span
              class="gh-pill"
              style="background: transparent"
              :style="{ borderColor: currentProject.myRole ? 'var(--gh-accent)' : 'rgba(255,255,255,0.4)', color: currentProject.myRole ? 'var(--gh-header-accent)' : 'white' }"
            >
              <q-icon name="badge" size="12px" />
              {{ currentProject.myRole ?? "viewer" }}
            </span>
          </div>
          <q-btn flat dense round icon="mail" color="white" @click="showMessages = true" />
        </template>

        <q-space />

        <div class="row items-center no-wrap" style="gap: 10px; cursor: pointer">
          <span class="text-white text-caption">{{ displayLabel || auth.username }}</span>
          <div class="gh-avatar" style="width: var(--gh-avatar-lg); height: var(--gh-avatar-lg); font-size: 13px">{{ initial }}</div>
          <q-menu>
            <q-list style="min-width: 160px">
              <q-item clickable v-close-popup @click="showNickname = true">
                <q-item-section>닉네임 변경</q-item-section>
              </q-item>
              <q-item clickable v-close-popup @click="showChangePassword = true">
                <q-item-section>비밀번호 변경</q-item-section>
              </q-item>
              <q-item clickable v-close-popup :to="'/keys'">
                <q-item-section>API 키 관리</q-item-section>
              </q-item>
              <!-- docs/plan-account-management.md - superAdmin(부트스트랩 admin
                   계정) 힌트일 뿐, 실제 접근 제어는 AccountsPage/서버가 한다. -->
              <q-item v-if="auth.username === 'admin'" clickable v-close-popup :to="'/accounts'">
                <q-item-section>계정 관리</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
          <q-btn flat dense round icon="logout" color="white" @click="logout" />
        </div>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <MessagesDialog v-if="currentProject" v-model="showMessages" :owner="currentProject.ownerUsername" :project-id="currentProject.id" />
    <ChangePasswordDialog v-model="showChangePassword" />
    <NicknameDialog v-model="showNickname" @updated="loadDisplayLabel" />
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "stores/auth";
import { useProjectStore } from "stores/project";
import { useUiStore } from "stores/ui";
import * as api from "src/api/client";
import MessagesDialog from "components/MessagesDialog.vue";
import ChangePasswordDialog from "components/ChangePasswordDialog.vue";
import NicknameDialog from "components/NicknameDialog.vue";

const auth = useAuthStore();
const project = useProjectStore();
const ui = useUiStore();
const router = useRouter();
const route = useRoute();
const showMessages = ref(false);
const showChangePassword = ref(false);
const showNickname = ref(false);
const displayLabel = ref("");

const initial = computed(() => (auth.username ?? "?").charAt(0).toUpperCase());

// docs/plan-nickname-apikey-policy.md - 탑바에 username 대신 표시 라벨
// ("닉네임 #번호", 미설정이면 "설계자 #번호")을 보여준다. 로그인 응답엔
// 없는 정보라 account.me로 한 번 더 조회한다.
async function loadDisplayLabel() {
  if (!auth.isLoggedIn) return;
  const result = await api.getMe(auth.apiKey!);
  if (result.ok) displayLabel.value = (result.data as { displayLabel: string }).displayLabel;
}
onMounted(loadDisplayLabel);
watch(() => auth.apiKey, loadDisplayLabel);

// project.current는 마지막으로 연 프로젝트가 남아있을 수 있으므로, 지금
// 라우트의 owner+projectId와 실제로 일치할 때만 "프로젝트 화면"으로
// 취급한다(다른 프로젝트/목록 화면으로 넘어가는 순간 잠깐 옛 프로젝트
// 정보가 깜빡이는 것을 막는다). 설계자 요청(2026-09-21 후속)으로 project
// id가 이제 생성자별로만 유일해져서 owner까지 같이 맞아야 한다 - id만
// 비교하면 서로 다른 두 설계자의 동일한 id를 같은 프로젝트로 착각할 수 있다.
const currentProject = computed(() =>
  route.params.owner === project.current?.ownerUsername && route.params.projectId === project.current?.id ? project.current : null
);

function logout() {
  auth.logout();
  router.push("/login");
}
</script>

<style scoped>
/* 좌측 패널이 오프캔버스로 바뀌는 폭(components/ProjectSidebar.vue와
   동일한 1024px 기준)에서만 햄버거를 보여준다 - 넓은 화면에선 패널이
   항상 보이니 토글할 게 없다. */
.hamburger-btn {
  display: none;
}
@media (max-width: 1023px) {
  .hamburger-btn {
    display: inline-flex;
  }
}
</style>
