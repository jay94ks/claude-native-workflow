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
      // docs/plan-account-management.md - 시스템 전체 스코프(프로젝트와 무관)라
      // `:owner/:projectId` 동적 라우트보다 먼저 오는 정적 형제 경로로 둔다
      // ("projects"와 동일한 관례 - vue-router가 정적 경로를 항상 먼저 매치).
      { path: "accounts", component: () => import("pages/AccountsPage.vue") },
      // docs/plan-nickname-apikey-policy.md - 마찬가지로 시스템/계정
      // 스코프(내 키만) - 프로젝트 하나에 종속되지 않는다. **주의**: 경로를
      // "api-keys"로 뒀다가 실기동 검증 중 발견 - Vite dev 서버의 프록시
      // 설정(quasar.config의 `"/api": {...}`)이 문자열 접두사로만 매치해서
      // "/api-keys"도 "/api"로 시작한다는 이유로 백엔드로 그대로 넘어가
      // 버렸다("Cannot GET /api-keys" - Express의 기본 404, 프론트 라우트가
      // 전혀 안 뜸). "/api"로 시작하지 않는 이름으로 바꿔서 피한다.
      { path: "keys", component: () => import("pages/ApiKeysPage.vue") },
      // 설계자 요청(2026-09-21 후속) - 프로젝트별 웹 접속 path를
      // /{생성자 login명}/{project id} 형태로 바꿨다(GitHub의 /{owner}/{repo}
      // 스타일 참고) - `owner`는 URL 표시용일 뿐 실제 조회는 항상
      // `projectId`(Project.id, 그 자체로 이미 고유)로만 한다. 즉 owner
      // 세그먼트가 그 프로젝트의 실제 생성자 username과 다르게 들어와도
      // 백엔드는 개의치 않고 그대로 응답한다 - "정확한 owner가 아니면
      // 404/redirect" 같은 정합성 검증은 이번 라운드 스코프 밖으로
      // 남겨둔다(docs/design-notes.md 기록).
      {
        path: ":owner/:projectId",
        component: () => import("layouts/ProjectShell.vue"),
        props: true,
        children: [
          { path: "", redirect: (to) => `/${to.params.owner}/${to.params.projectId}/code` },
          // 설계자 요청(2026-09-21 후속) - Code 탭 URL 체계:
          //   /code?path=P            -> 기본 브랜치, 그 브랜치의 지금 시점
          //   /code/:branch?path=P    -> 그 브랜치의 지금 시점
          //   /code/:branch/:commitId?path=P -> 그 브랜치 위 특정 커밋 시점(읽기 전용)
          // branch/commitId 둘 다 optional param이라 이 한 라우트가 셋 다 받는다.
          { path: "code/:branch?/:commitId?", component: () => import("pages/project/CodeTab.vue"), props: true },
          { path: "pull-requests", component: () => import("pages/project/PullRequestsTab.vue"), props: true },
          {
            path: "pull-requests/new",
            component: () => import("pages/project/PrCreatePage.vue"),
            props: (route) => ({ owner: route.params.owner, projectId: route.params.projectId }),
          },
          // 설계자 요청(2026-09-21 후속) - PR도 새로고침/북마크에서 그 PR을
          // 계속 보고 있게 /pull-requests/{PR id}로 - PullRequestsTab 자신이
          // 목록+상세를 같이 그리므로 같은 컴포넌트를 optional :id로 재사용.
          { path: "pull-requests/:id", component: () => import("pages/project/PullRequestsTab.vue"), props: true },
          // 설계자 요청(2026-09-21 후속) - Documents/Plans/Issues도 지금 보고
          // 있는 항목의 추적 코드를 path에 실어 Browser History/새로고침에
          // 그 상태가 살아남게 한다 - "new"는 완전히 정적인 경로라 vue-router가
          // 항상 이 동적 :code보다 먼저(더 구체적으로) 매치한다.
          { path: "issues/:code?", component: () => import("pages/project/IssuesTab.vue"), props: true },
          {
            path: "issues/new",
            component: () => import("pages/project/DocCreatePage.vue"),
            props: (route) => ({
              owner: route.params.owner,
              projectId: route.params.projectId,
              type: "issue",
              kinds: ["IS"],
              createLabel: "새 이슈",
              listRoute: `/${route.params.owner}/${route.params.projectId}/issues`,
            }),
          },
          { path: "documents/:code?", component: () => import("pages/project/DocumentsTab.vue"), props: true },
          {
            path: "documents/new",
            component: () => import("pages/project/DocCreatePage.vue"),
            props: (route) => ({
              owner: route.params.owner,
              projectId: route.params.projectId,
              type: "doc",
              kinds: ["SP", "RP", "RM", "QA", "BT"],
              createLabel: "새 문서",
              listRoute: `/${route.params.owner}/${route.params.projectId}/documents`,
              allowChapter: true,
            }),
          },
          { path: "plans/:code?", component: () => import("pages/project/PlansTab.vue"), props: true },
          {
            path: "plans/new",
            component: () => import("pages/project/DocCreatePage.vue"),
            props: (route) => ({
              owner: route.params.owner,
              projectId: route.params.projectId,
              type: "plan",
              kinds: ["PL"],
              createLabel: "새 계획",
              listRoute: `/${route.params.owner}/${route.params.projectId}/plans`,
            }),
          },
          { path: "trackers-tests", component: () => import("pages/project/TrackersTestsTab.vue"), props: true },
          { path: "thread/:code", component: () => import("pages/project/DocumentThreadPage.vue"), props: true },
          { path: "commits", component: () => import("pages/project/BranchCommitsPage.vue"), props: true },
          // 설계자 요청(2026-09-21 후속) - 커밋 diff에서 "코드 트리에서 보기"가
          // 그 커밋 시점(/code/:branch/:commitId)으로 이어지려면 이 페이지도
          // 자신이 어느 브랜치 위의 커밋인지 알아야 한다 - branch를 필수
          // 세그먼트로 추가(호출부인 BranchCommitsPage/CodeTab의 파일별
          // Recent Commits 둘 다 이미 branch를 알고 있는 상태에서만 이
          // 페이지로 링크한다).
          { path: "commit/:branch/:commitId", component: () => import("pages/project/CommitDiffPage.vue"), props: true },
          {
            path: "settings",
            component: () => import("layouts/SettingsShell.vue"),
            props: true,
            children: [
              { path: "", redirect: (to) => `/${to.params.owner}/${to.params.projectId}/settings/general` },
              { path: "general", component: () => import("pages/project/settings/GeneralPage.vue"), props: true },
              { path: "collaborators", component: () => import("pages/project/settings/CollaboratorsPage.vue"), props: true },
              { path: "template", component: () => import("pages/project/settings/TemplatePage.vue"), props: true },
              { path: "doc-kinds", component: () => import("pages/project/settings/DocKindsPage.vue"), props: true },
            ],
          },
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
