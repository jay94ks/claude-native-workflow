<script setup lang="ts">
import { ref, onMounted } from "vue";
import { projects3, type Member } from "../api3";

const props = defineProps<{ token: string; projectId: string; myRole: string }>();

const members = ref<Member[]>([]);
const inviteEmail = ref("");
const inviteRole = ref("viewer");
const error = ref("");

async function load() {
  members.value = await projects3(props.token).members(props.projectId);
}

async function invite() {
  error.value = "";
  try {
    await projects3(props.token).invite(props.projectId, inviteEmail.value, inviteRole.value);
    inviteEmail.value = "";
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function changeRole(userId: string, role: string) {
  await projects3(props.token).updateRole(props.projectId, userId, role);
  await load();
}

async function remove(userId: string) {
  await projects3(props.token).removeMember(props.projectId, userId);
  await load();
}

onMounted(load);
</script>

<template>
  <div class="q-pa-md" style="max-width: 640px">
    <div class="text-subtitle1 q-mb-sm">멤버 관리 (SP-00002 3절)</div>

    <q-list bordered separator class="q-mb-md">
      <q-item v-for="m in members" :key="m.id">
        <q-item-section>
          <q-item-label>{{ m.username }} ({{ m.email }})</q-item-label>
          <q-item-label caption>가입 {{ m.joined_at }}</q-item-label>
        </q-item-section>
        <q-item-section side v-if="myRole === 'owner'">
          <div class="row q-gutter-xs items-center">
            <q-select
              dense outlined style="width: 110px"
              :model-value="m.role"
              :options="['viewer', 'editor', 'owner']"
              @update:model-value="(v) => changeRole(m.id, v)"
            />
            <q-btn flat dense round icon="delete" color="negative" @click="remove(m.id)" />
          </div>
        </q-item-section>
        <q-item-section side v-else>
          <q-badge outline>{{ m.role }}</q-badge>
        </q-item-section>
      </q-item>
    </q-list>

    <div v-if="myRole === 'owner'" class="row q-gutter-sm items-start">
      <q-input v-model="inviteEmail" dense outlined label="초대할 이메일" class="col" />
      <q-select v-model="inviteRole" dense outlined :options="['viewer', 'editor', 'owner']" style="width: 120px" />
      <q-btn color="primary" label="초대" @click="invite" />
    </div>
    <div v-if="error" class="text-negative text-caption q-mt-xs">{{ error }}</div>
  </div>
</template>
