<template>
  <div class="row no-wrap" style="min-height: calc(100vh - 160px)">
    <ProjectSidebar>
      <q-list>
        <q-item
          v-for="m in menu"
          :key="m.to"
          clickable
          :to="`/${owner}/${projectId}/settings/${m.to}`"
          active-class="bg-blue-1"
        >
          <q-item-section avatar><q-icon :name="m.icon" /></q-item-section>
          <q-item-section>{{ m.label }}</q-item-section>
        </q-item>
      </q-list>
    </ProjectSidebar>

    <q-separator vertical />

    <div class="col q-pa-md" style="overflow-y: auto">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
// 설계자 요청(2026-09-21) - Collaborators/Template을 독립 탭에서 Settings
// 탭 안 좌측 메뉴("기본 설정"/"Collaborators"/"Template")로 통합한
// 중첩 레이아웃 - ProjectShell.vue의 GitHub 탭바 밑에 이 셸이 또 자체
// 270px 좌측 패널 + router-view를 갖는다(routes.ts의 settings 하위
// children 참고).
import ProjectSidebar from "components/ProjectSidebar.vue";

defineProps<{ owner: string; projectId: string }>();

const menu = [
  { to: "general", icon: "tune", label: "기본 설정" },
  { to: "collaborators", icon: "group", label: "Collaborators" },
  { to: "template", icon: "integration_instructions", label: "Template" },
];
</script>
