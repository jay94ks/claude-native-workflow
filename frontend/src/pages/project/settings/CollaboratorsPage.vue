<template>
  <div>
    <div class="text-subtitle1 q-mb-sm">Collaborators</div>
    <q-list bordered separator class="q-mb-lg">
      <q-item v-for="m in members">
        <q-item-section>{{ m.username }}</q-item-section>
        <q-item-section side><q-badge color="primary" outline>{{ m.role }}</q-badge></q-item-section>
      </q-item>
      <q-item v-if="members.length === 0"><q-item-section class="text-caption">멤버가 없습니다.</q-item-section></q-item>
    </q-list>

    <template v-if="pendingInvites.length > 0">
      <div class="text-subtitle1 q-mb-sm">대기 중인 초대</div>
      <q-list bordered separator class="q-mb-lg">
        <q-item v-for="i in pendingInvites">
          <q-item-section>{{ i.username }}</q-item-section>
          <q-item-section side><q-badge color="grey-6" outline>{{ i.role }} (pending)</q-badge></q-item-section>
        </q-item>
      </q-list>
    </template>

    <template v-if="project.isAdmin">
      <div class="text-subtitle1 q-mb-sm">초대하기 (Admin)</div>
      <q-form class="row q-gutter-sm items-center" @submit.prevent="invite">
        <q-input v-model="inviteUsername" label="username" dense style="width: 200px" />
        <q-select v-model="inviteRole" :options="['READ', 'WRITE']" label="role" dense style="width: 120px" />
        <q-btn type="submit" color="primary" label="초대" :loading="inviting" />
      </q-form>
      <div v-if="inviteError" class="text-negative text-caption q-mt-sm">{{ inviteError }}</div>
      <div v-if="inviteMessage" class="text-positive text-caption q-mt-sm">{{ inviteMessage }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "stores/auth";
import { useProjectStore } from "stores/project";
import * as api from "src/api/client";

const props = defineProps<{ owner: string; projectId: string }>();
const auth = useAuthStore();
const project = useProjectStore();

interface Member {
  username: string;
  role: string;
}
const members = ref<Member[]>([]);
const pendingInvites = ref<Member[]>([]);

const inviteUsername = ref("");
const inviteRole = ref<"READ" | "WRITE">("READ");
const inviting = ref(false);
const inviteError = ref("");
const inviteMessage = ref("");

async function load() {
  const result = await api.getProjectMembers(auth.apiKey!, props.owner, props.projectId);
  if (result.ok) {
    const data = result.data as { members: Member[]; pendingInvites: Member[] };
    members.value = data.members;
    pendingInvites.value = data.pendingInvites;
  }
}

async function invite() {
  inviting.value = true;
  inviteError.value = "";
  inviteMessage.value = "";
  const result = await api.inviteToProject(auth.apiKey!, props.owner, props.projectId, { username: inviteUsername.value, role: inviteRole.value });
  inviting.value = false;
  if (!result.ok) {
    inviteError.value = result.reason?.join(", ") ?? "초대에 실패했습니다.";
    return;
  }
  inviteMessage.value = `${inviteUsername.value}에게 초대를 보냈습니다.`;
  inviteUsername.value = "";
  await load();
}

onMounted(load);
</script>
