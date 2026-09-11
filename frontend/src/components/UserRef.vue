<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useNicknamesStore } from "../stores/nicknames";

const props = defineProps<{ userId: string }>();
const store = useNicknamesStore();
onMounted(() => store.ensure(props.userId));
const label = computed(() => store.labels[props.userId] ?? "...");
</script>
<template>
  <router-link :to="`/users/${userId}`" class="user-ref"><code>[{{ label }}]</code></router-link>
</template>
