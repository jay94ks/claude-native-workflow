<script setup lang="ts">
import { ref, onMounted } from "vue";
import { projects3, type Project } from "../api3";

const props = defineProps<{ token: string }>();
const emit = defineEmits<{ select: [project: Project] }>();

const list = ref<Project[]>([]);
const showCreate = ref(false);
const newName = ref("");
const newRepo = ref("");
const error = ref("");
const busy = ref(false);

async function load() {
  list.value = await projects3(props.token).list();
}

async function create() {
  error.value = "";
  busy.value = true;
  try {
    const project = await projects3(props.token).create(newName.value, newRepo.value);
    showCreate.value = false;
    newName.value = "";
    newRepo.value = "";
    await load();
    emit("select", { ...project, role: "owner" });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="row justify-center q-pa-xl">
    <div style="width: min(640px, 92vw)">
      <div class="row items-center q-mb-md">
        <div class="text-h6">내 프로젝트</div>
        <q-space />
        <q-btn color="primary" icon="add" label="새 프로젝트 등록" @click="showCreate = true" />
      </div>

      <q-list bordered separator>
        <q-item v-for="p in list" :key="p.id" clickable @click="emit('select', p)">
          <q-item-section>
            <q-item-label>{{ p.name }}</q-item-label>
            <q-item-label caption>{{ p.gitRepoUrl }}</q-item-label>
          </q-item-section>
          <q-item-section side><q-badge outline>{{ p.role }}</q-badge></q-item-section>
        </q-item>
        <q-item v-if="!list.length"><q-item-section class="text-grey-6">등록된 프로젝트가 없습니다</q-item-section></q-item>
      </q-list>
    </div>

    <q-dialog v-model="showCreate">
      <q-card style="width: 420px">
        <q-card-section class="text-h6">새 프로젝트 등록</q-card-section>
        <q-card-section class="q-gutter-sm">
          <q-input v-model="newName" dense outlined label="프로젝트 이름" />
          <q-input v-model="newRepo" dense outlined label="git 저장소 URL" />
          <div v-if="error" class="text-negative text-caption">{{ error }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="취소" @click="showCreate = false" />
          <q-btn color="primary" label="등록" :loading="busy" @click="create" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>
