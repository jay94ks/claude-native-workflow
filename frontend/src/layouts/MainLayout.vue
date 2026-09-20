<template>
  <q-layout view="lHh Lpr lFf">
    <q-header style="background: var(--gh-header-bg)">
      <q-toolbar style="height: 62px" class="q-gutter-x-md">
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
              :style="{ borderColor: currentProject.myRole ? 'var(--gh-accent)' : 'rgba(255,255,255,0.4)', color: currentProject.myRole ? '#79c0ff' : 'white' }"
            >
              <q-icon name="badge" size="12px" />
              {{ currentProject.myRole ?? "viewer" }}
            </span>
          </div>
          <q-btn flat dense round icon="mail" color="white" @click="showMessages = true" />
          <q-btn
            flat
            dense
            no-caps
            icon="settings"
            label="Settings"
            color="white"
            :to="`/projects/${currentProject.id}/settings`"
          />
        </template>

        <q-space />

        <div class="row items-center no-wrap" style="gap: 10px">
          <span class="text-white text-caption">{{ auth.username }}</span>
          <div class="gh-avatar" style="width: 28px; height: 28px; font-size: 13px">{{ initial }}</div>
          <q-btn flat dense round icon="logout" color="white" @click="logout" />
        </div>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <MessagesDialog v-if="currentProject" v-model="showMessages" :project-id="currentProject.id" />
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "stores/auth";
import { useProjectStore } from "stores/project";
import MessagesDialog from "components/MessagesDialog.vue";

const auth = useAuthStore();
const project = useProjectStore();
const router = useRouter();
const route = useRoute();
const showMessages = ref(false);

const initial = computed(() => (auth.username ?? "?").charAt(0).toUpperCase());

// project.current는 마지막으로 연 프로젝트가 남아있을 수 있으므로, 지금
// 라우트의 projectId와 실제로 일치할 때만 "프로젝트 화면"으로 취급한다
// (다른 프로젝트/목록 화면으로 넘어가는 순간 잠깐 옛 프로젝트 정보가
// 깜빡이는 것을 막는다).
const currentProject = computed(() => (route.params.projectId === project.current?.id ? project.current : null));

function logout() {
  auth.logout();
  router.push("/login");
}
</script>
