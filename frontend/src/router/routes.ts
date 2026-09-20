import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    component: () => import("pages/LoginPage.vue"),
  },
  {
    path: "/",
    component: () => import("layouts/MainLayout.vue"),
    children: [
      { path: "", redirect: "/projects" },
      { path: "projects", component: () => import("pages/ProjectListPage.vue") },
      {
        path: "projects/:projectId",
        component: () => import("layouts/ProjectShell.vue"),
        props: true,
        children: [
          { path: "", redirect: (to) => `/projects/${to.params.projectId}/code` },
          { path: "code", component: () => import("pages/project/CodeTab.vue"), props: true },
          { path: "pull-requests", component: () => import("pages/project/PullRequestsTab.vue"), props: true },
          {
            path: "pull-requests/new",
            component: () => import("pages/project/PrCreatePage.vue"),
            props: (route) => ({ projectId: route.params.projectId }),
          },
          { path: "issues", component: () => import("pages/project/IssuesTab.vue"), props: true },
          {
            path: "issues/new",
            component: () => import("pages/project/DocCreatePage.vue"),
            props: (route) => ({
              projectId: route.params.projectId,
              type: "issue",
              kinds: ["IS"],
              createLabel: "새 이슈",
              listRoute: `/projects/${route.params.projectId}/issues`,
            }),
          },
          { path: "documents", component: () => import("pages/project/DocumentsTab.vue"), props: true },
          {
            path: "documents/new",
            component: () => import("pages/project/DocCreatePage.vue"),
            props: (route) => ({
              projectId: route.params.projectId,
              type: "doc",
              kinds: ["SP", "RP", "RM", "QA", "BT"],
              createLabel: "새 문서",
              listRoute: `/projects/${route.params.projectId}/documents`,
              allowChapter: true,
            }),
          },
          { path: "plans", component: () => import("pages/project/PlansTab.vue"), props: true },
          {
            path: "plans/new",
            component: () => import("pages/project/DocCreatePage.vue"),
            props: (route) => ({
              projectId: route.params.projectId,
              type: "plan",
              kinds: ["PL"],
              createLabel: "새 계획",
              listRoute: `/projects/${route.params.projectId}/plans`,
            }),
          },
          { path: "trackers-tests", component: () => import("pages/project/TrackersTestsTab.vue"), props: true },
          { path: "collaborators", component: () => import("pages/project/CollaboratorsTab.vue"), props: true },
          { path: "template", component: () => import("pages/project/TemplateTab.vue"), props: true },
          { path: "settings", component: () => import("pages/project/SettingsTab.vue"), props: true },
        ],
      },
    ],
  },
  {
    path: "/:catchAll(.*)*",
    component: () => import("pages/ErrorNotFound.vue"),
  },
];

export default routes;
