import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("../views/LoginView.vue"), meta: { public: true } },
    { path: "/register", name: "register", component: () => import("../views/RegisterView.vue"), meta: { public: true } },
    { path: "/", redirect: "/projects" },
    { path: "/institutions", name: "institutions", component: () => import("../views/InstitutionsView.vue") },
    { path: "/groups", name: "groups", component: () => import("../views/ProjectGroupsView.vue") },
    { path: "/projects", name: "projects", component: () => import("../views/ProjectsView.vue") },
    { path: "/projects/:id", name: "project-detail", component: () => import("../views/ProjectDetailView.vue"), props: true },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.loggedIn) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (to.meta.public && auth.loggedIn && (to.name === "login" || to.name === "register")) {
    return { name: "projects" };
  }
  return true;
});

export default router;
