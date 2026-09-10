<script setup lang="ts">
defineProps<{ userId: string }>();
</script>

<template>
  <router-link :to="`/users/${userId}`" class="user-ref"><code>[{{ userId }}]</code></router-link>
</template>

<style scoped>
.user-ref {
  color: #3454d1;
  text-decoration: none;
}
.user-ref code {
  background: #f0f1f5;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.user-ref:hover code {
  background: #e4e9fb;
}
</style>
