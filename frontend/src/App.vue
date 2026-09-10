<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth";
import AppLayout from "./components/AppLayout.vue";

const route = useRoute();
const auth = useAuthStore();
const showLayout = computed(() => auth.loggedIn && !route.meta.public);
</script>

<template>
  <AppLayout v-if="showLayout">
    <router-view />
  </AppLayout>
  <router-view v-else />
</template>

<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
  color: #1a1a2e;
}
a {
  color: #3454d1;
}
button {
  font-family: inherit;
  cursor: pointer;
}
input,
textarea,
select {
  font-family: inherit;
  font-size: 14px;
}
</style>
