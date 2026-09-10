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
    {
      path: "/projects/:id",
      component: () => import("../views/ProjectShellView.vue"),
      props: true,
      children: [
        { path: "", name: "project-detail", component: () => import("../views/ProjectHomeView.vue"), props: true },
        { path: "documents", name: "documents", component: () => import("../views/DocumentsView.vue"), props: true },
        {
          path: "documents/:trackingCode",
          name: "document-editor",
          component: () => import("../views/DocumentEditorView.vue"),
          props: true,
        },
        { path: "source", name: "source", component: () => import("../views/SourceBrowserView.vue"), props: true },
        { path: "changes", name: "changes", component: () => import("../views/ChangeTrackingView.vue"), props: true },
        { path: "settings", name: "project-settings", component: () => import("../views/ProjectSettingsView.vue"), props: true },
      ],
    },
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
