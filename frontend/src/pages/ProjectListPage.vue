<template>
  <q-page class="q-pa-md">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h5">Projects</div>
      <div class="q-gutter-sm">
        <q-btn flat icon="mail" label="초대 수락" @click="openAcceptDialog">
          <q-badge v-if="myInvites.length > 0" color="red" floating>{{ myInvites.length }}</q-badge>
        </q-btn>
        <q-btn color="primary" icon="add" label="새 프로젝트" @click="showCreate = true" />
      </div>
    </div>

    <div v-if="loading" class="text-caption">불러오는 중...</div>
    <div v-else-if="projects.length === 0" class="text-caption">아직 프로젝트가 없습니다.</div>
    <div class="row q-col-gutter-md">
      <div v-for="project in projects" :key="project.id" class="col-12 col-sm-4">
        <router-link :to="`/projects/${project.id}`" style="text-decoration: none; color: inherit">
          <ProjectCard :name="project.name" :visibility="project.visibility" :description="project.description" :my-role="project.myRole" />
        </router-link>
      </div>
    </div>

    <q-dialog v-model="showCreate">
      <q-card style="width: 400px">
        <q-card-section class="text-h6">새 프로젝트</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input v-model="newName" label="이름" autofocus />
          <q-input v-model="newDescription" label="설명 (선택)" />
          <q-toggle v-model="newIsPublic" label="공개(PUBLIC) - 비멤버도 읽기 가능" />
          <div v-if="createError" class="text-negative text-caption">{{ createError }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" v-close-popup />
          <q-btn color="primary" label="만들기" :loading="creating" @click="create" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showAccept">
      <q-card style="width: 420px">
        <q-card-section class="text-h6">초대 수락</q-card-section>
        <q-list v-if="myInvites.length > 0" separator>
          <q-item v-for="invite in myInvites" :key="invite.projectId">
            <q-item-section>
              <q-item-label>{{ invite.projectName }}</q-item-label>
              <q-item-label caption>{{ invite.projectId }} · {{ invite.role }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn size="sm" color="primary" label="수락" :loading="accepting === invite.projectId" @click="acceptInvite(invite.projectId)" />
            </q-item-section>
          </q-item>
        </q-list>
        <q-card-section v-else class="text-caption">대기 중인 초대가 없습니다.</q-card-section>
        <q-card-section v-if="acceptError" class="text-negative text-caption">{{ acceptError }}</q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="닫기" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import ProjectCard from "components/ProjectCard.vue";
import { useAuthStore } from "stores/auth";

interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  myRole: "READ" | "WRITE" | "ADMIN" | null;
}

const auth = useAuthStore();
const projects = ref<ProjectSummary[]>([]);
const loading = ref(true);

const showCreate = ref(false);
const newName = ref("");
const newDescription = ref("");
const newIsPublic = ref(false);
const creating = ref(false);
const createError = ref("");

async function load() {
  loading.value = true;
  const result = await auth.run({ action: "project.list" });
  if (result.ok) {
    projects.value = (result.data as { items: ProjectSummary[] }).items;
  }
  loading.value = false;
}

async function create() {
  creating.value = true;
  createError.value = "";
  const result = await auth.run({
    action: "project.create",
    name: newName.value,
    description: newDescription.value || undefined,
    visibility: newIsPublic.value ? "PUBLIC" : "PRIVATE",
  });
  creating.value = false;
  if (!result.ok) {
    createError.value = result.reason?.join(", ") ?? "생성에 실패했습니다.";
    return;
  }
  showCreate.value = false;
  newName.value = "";
  newDescription.value = "";
  newIsPublic.value = false;
  await load();
}

interface MyInvite {
  projectId: string;
  projectName: string;
  role: "READ" | "WRITE" | "ADMIN";
}

const showAccept = ref(false);
const myInvites = ref<MyInvite[]>([]);
const accepting = ref<string | null>(null);
const acceptError = ref("");

async function loadMyInvites() {
  const result = await auth.run({ action: "project.invitesForMe" });
  if (result.ok) myInvites.value = (result.data as { items: MyInvite[] }).items;
}

function openAcceptDialog() {
  acceptError.value = "";
  showAccept.value = true;
}

async function acceptInvite(projectId: string) {
  accepting.value = projectId;
  acceptError.value = "";
  const result = await auth.run({ action: "project.acceptInvite", projectId });
  accepting.value = null;
  if (!result.ok) {
    acceptError.value = result.reason?.join(", ") ?? "수락에 실패했습니다.";
    return;
  }
  await Promise.all([load(), loadMyInvites()]);
}

onMounted(() => {
  load();
  loadMyInvites();
});
</script>
