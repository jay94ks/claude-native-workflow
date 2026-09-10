#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiCall, apiCallText, loadCredentials } from "../cli/apiclient.js";

// cli/index.ts의 모든 명령을 1:1로 미러링한다("CLI/MCP 명령어 완전성"
// 원칙 - 대칭이 깨지면 어느 한쪽에서만 되는 동작이 생긴다). CLI와 마찬가지로
// core/를 직접 호출하지 않고 REST API만 호출하는 순수 클라이언트다 -
// 개인 PC/서버/클라우드 배포 형태를 API 계층 하나로 통일하기 위해서다.
// auth register/login/logout은 도구로 노출하지 않는다(비밀번호가 대화
// 컨텍스트에 남는 걸 피하기 위해 - CLI로 미리 `docs auth login`을 한 번
// 해두는 걸 전제로 한다). 진단용으로 auth_whoami만 예외로 둔다.

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function call<T>(pathSuffix: string, init?: RequestInit): Promise<T> {
  return apiCall<T>(pathSuffix, init);
}

async function main() {
  const server = new McpServer({ name: "claude-native-workflow", version: "0.1.0" });

  function tool(
    name: string,
    title: string,
    description: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ) {
    server.registerTool(name, { title, description, inputSchema }, async (args) => {
      try {
        return textResult(await handler(args ?? {}));
      } catch (err) {
        return errorResult(err);
      }
    });
  }

  // ---------------------------------------------------------------- 인증(진단용)

  tool("auth_whoami", "로그인 상태 확인", "현재 저장된 자격증명의 API 주소를 반환한다(로그인 자체는 CLI에서 `docs auth login`으로).", {}, async () => {
    const creds = loadCredentials();
    if (!creds) return { logged_in: false };
    return { logged_in: true, api_base: creds.api_base };
  });

  // ---------------------------------------------------------------- git 자격증명

  tool(
    "credential_add",
    "git 자격증명 등록",
    "외부 git 저장소용 자격증명을 AES-256-GCM으로 암호화해 저장한다.",
    { credentialType: z.enum(["token", "username_password", "ssh_key"]), value: z.string(), hostPattern: z.string().optional() },
    async (a) => call("/api/credentials", { method: "POST", body: JSON.stringify(a) }),
  );
  tool("credential_list", "git 자격증명 목록", "저장된 자격증명 목록(payload는 제외).", {}, async () => call("/api/credentials"));
  tool("credential_remove", "git 자격증명 삭제", "id로 자격증명을 삭제한다.", { id: z.string() }, async (a) =>
    call(`/api/credentials/${a.id}`, { method: "DELETE" }),
  );

  // ---------------------------------------------------------------- 기관/그룹/프로젝트

  tool("institution_create", "기관 생성", "새 기관을 만든다.", { name: z.string() }, async (a) =>
    call("/api/institutions", { method: "POST", body: JSON.stringify(a) }),
  );
  tool("institution_list", "기관 목록", "전체 기관 목록.", {}, async () => call("/api/institutions"));
  tool(
    "group_create",
    "프로젝트 그룹 생성",
    "새 프로젝트 그룹을 만든다.",
    { name: z.string(), institutionId: z.string().optional() },
    async (a) => call("/api/project-groups", { method: "POST", body: JSON.stringify(a) }),
  );
  tool("group_list", "프로젝트 그룹 목록", "프로젝트 그룹 목록(institutionId로 필터 가능).", { institutionId: z.string().optional() }, async (a) => {
    const qs = a.institutionId ? `?institutionId=${encodeURIComponent(String(a.institutionId))}` : "";
    return call(`/api/project-groups${qs}`);
  });
  tool(
    "project_create",
    "프로젝트 생성",
    "새 프로젝트를 만든다(그룹 생략 시 기본 그룹 사용).",
    { name: z.string(), projectGroupId: z.string().optional() },
    async (a) => call("/api/projects", { method: "POST", body: JSON.stringify(a) }),
  );
  tool("project_list", "프로젝트 목록", "프로젝트 목록(projectGroupId로 필터 가능).", { projectGroupId: z.string().optional() }, async (a) => {
    const qs = a.projectGroupId ? `?projectGroupId=${encodeURIComponent(String(a.projectGroupId))}` : "";
    return call(`/api/projects${qs}`);
  });
  tool("project_get", "프로젝트 조회", "id로 프로젝트 1건을 조회한다.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}`),
  );
  tool(
    "member_add",
    "프로젝트 멤버 추가",
    "프로젝트에 사용자를 role과 함께 추가한다.",
    { projectId: z.string(), userId: z.string(), role: z.enum(["owner", "editor", "viewer"]) },
    async (a) => call(`/api/projects/${a.projectId}/members`, { method: "POST", body: JSON.stringify({ userId: a.userId, role: a.role }) }),
  );
  tool("member_list", "프로젝트 멤버 목록", "프로젝트 멤버 목록.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/members`),
  );

  // ---------------------------------------------------------------- 문서 타입 체계

  tool(
    "doctype_create",
    "문서 타입 생성",
    "프로젝트 스코프로 새 문서 타입을 정의한다(code는 영문 2글자).",
    { projectId: z.string(), code: z.string(), label: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/doc-types`, { method: "POST", body: JSON.stringify({ code: a.code, label: a.label }) }),
  );
  tool("doctype_list", "문서 타입 목록", "프로젝트의 문서 타입 목록.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/doc-types`),
  );

  // ---------------------------------------------------------------- 문서

  tool(
    "document_new",
    "문서 생성",
    "새 문서를 만들고 추적 코드를 발급받는다.",
    { projectId: z.string(), docTypeCode: z.string(), title: z.string(), body: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/documents`, {
        method: "POST",
        body: JSON.stringify({ docTypeCode: a.docTypeCode, title: a.title, body: a.body }),
      }),
  );
  tool("document_get", "문서 조회", "추적 코드로 문서 1건을 조회한다.", { trackingCode: z.string() }, async (a) =>
    call(`/api/documents/${a.trackingCode}`),
  );
  tool("document_list", "문서 목록", "프로젝트의 문서 목록(docTypeId로 필터 가능).", { projectId: z.string(), docTypeId: z.string().optional() }, async (a) => {
    const qs = a.docTypeId ? `?docTypeId=${encodeURIComponent(String(a.docTypeId))}` : "";
    return call(`/api/projects/${a.projectId}/documents${qs}`);
  });
  tool("document_search", "문서 검색", "Meilisearch 기반 전문 검색.", { projectId: z.string(), query: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/search?q=${encodeURIComponent(String(a.query))}`),
  );
  tool("document_save", "문서 본문 갱신", "문서 본문을 덮어쓰고 버전 이력을 남긴다.", { trackingCode: z.string(), body: z.string() }, async (a) =>
    call(`/api/documents/${a.trackingCode}`, { method: "PUT", body: JSON.stringify({ body: a.body }) }),
  );
  tool(
    "document_transition",
    "문서 상태 전이",
    "정의된 전이 규칙에 따라 문서 상태를 바꾼다.",
    { trackingCode: z.string(), toStatusCode: z.string() },
    async (a) => call(`/api/documents/${a.trackingCode}/transition`, { method: "POST", body: JSON.stringify({ toStatusCode: a.toStatusCode }) }),
  );
  tool(
    "document_link",
    "문서 링크 추가",
    "한 문서에서 다른 문서로의 링크를 추가한다.",
    { fromTrackingCode: z.string(), toTrackingCode: z.string(), linkType: z.string().optional() },
    async (a) =>
      call(`/api/documents/${a.fromTrackingCode}/links`, {
        method: "POST",
        body: JSON.stringify({ toTrackingCode: a.toTrackingCode, linkType: a.linkType }),
      }),
  );
  tool("document_backlinks", "역참조 조회", "이 문서를 링크한 다른 문서 목록.", { trackingCode: z.string() }, async (a) =>
    call(`/api/documents/${a.trackingCode}/backlinks`),
  );

  // ---------------------------------------------------------------- 보고서

  tool(
    "report_new",
    "보고서 생성",
    "여러 문서를 링크로 엮는 보고서를 생성한다.",
    { projectId: z.string(), title: z.string(), body: z.string(), links: z.array(z.string()).optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/reports`, {
        method: "POST",
        body: JSON.stringify({ title: a.title, body: a.body, links: a.links }),
      }),
  );

  // ---------------------------------------------------------------- 질의/답변

  tool("question_add", "질의 등록", "문서에 대한 질의를 등록하고 추적 코드를 발급받는다.", { trackingCode: z.string(), text: z.string() }, async (a) =>
    call(`/api/documents/${a.trackingCode}/questions`, { method: "POST", body: JSON.stringify({ text: a.text }) }),
  );
  tool("pending_list", "답변 대기 목록", "프로젝트의 미답변 질의 목록.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/pending`),
  );
  tool(
    "question_reply",
    "질의에 답변",
    "질의에 답변하면 상태가 answered로 바뀌고, 문서의 모든 질의가 답변되면 문서 상태도 자동 전이될 수 있다.",
    { questionTrackingCode: z.string(), body: z.string() },
    async (a) => call(`/api/questions/${a.questionTrackingCode}/answer`, { method: "POST", body: JSON.stringify({ body: a.body }) }),
  );

  // ---------------------------------------------------------------- 코멘트

  tool("comment_list", "코멘트 목록", "문서의 코멘트 목록.", { projectId: z.string(), trackingCode: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/documents/${a.trackingCode}/comments`),
  );
  tool(
    "comment_add",
    "코멘트 추가",
    "문서에 코멘트를 남긴다.",
    { projectId: z.string(), trackingCode: z.string(), body: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/documents/${a.trackingCode}/comments`, { method: "POST", body: JSON.stringify({ body: a.body }) }),
  );
  tool("comment_resolve", "코멘트 해결 처리", "코멘트를 해결 처리한다.", { projectId: z.string(), commentId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/comments/${a.commentId}/resolve`, { method: "POST" }),
  );

  // ---------------------------------------------------------------- 템플릿 (CLAUDE.md, SKILL.md 등)

  tool(
    "template_get",
    "템플릿 조회",
    "CLAUDE.md/SKILL.md 등 템플릿 파일의 실제 적용될 내용을 조회한다(project → group → institution → 전역 기본값 순).",
    { filename: z.string(), projectId: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ filename: String(a.filename), ...(a.projectId ? { projectId: String(a.projectId) } : {}) });
      return call(`/api/templates?${qs}`);
    },
  );
  tool(
    "template_set",
    "템플릿 override 설정",
    "특정 스코프(기관/그룹/프로젝트, 생략하면 전역 기본값)에 템플릿 내용을 설정한다.",
    { filename: z.string(), content: z.string(), institutionId: z.string().optional(), projectGroupId: z.string().optional(), projectId: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ filename: String(a.filename) });
      return call(`/api/templates?${qs}`, {
        method: "PUT",
        body: JSON.stringify({ content: a.content, institutionId: a.institutionId, projectGroupId: a.projectGroupId, projectId: a.projectId }),
      });
    },
  );
  tool(
    "template_deploy",
    "템플릿 배포",
    "CLAUDE.md/SKILL.md를 해석해 프로젝트의 자체 호스팅 git 저장소 루트에 실제로 커밋한다.",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/templates/deploy`, { method: "POST" }),
  );

  // ---------------------------------------------------------------- git 저장소 연결 + 이력 조회 (Phase 2)

  tool(
    "git_link",
    "git 저장소 연결(자체 호스팅)",
    "Gitea에 저장소를 만들고 프로젝트에 연결한다.",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/link`, { method: "POST" }),
  );
  tool(
    "git_link_external",
    "git 저장소 연결(외부)",
    "이미 존재하는 외부 GitHub/GitLab 저장소를 프로젝트에 연결한다.",
    { projectId: z.string(), provider: z.enum(["github", "gitlab"]), repoUrl: z.string(), gitCredentialId: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/link-external`, {
        method: "POST",
        body: JSON.stringify({ provider: a.provider, repoUrl: a.repoUrl, gitCredentialId: a.gitCredentialId }),
      }),
  );
  tool("git_repo", "연결된 git 저장소 조회", "프로젝트에 연결된 git 저장소 정보를 반환한다.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/repo`),
  );
  tool("git_log", "git 로그 조회", "자체 호스팅 저장소의 커밋 로그.", { projectId: z.string(), ref: z.string().optional() }, async (a) => {
    const qs = a.ref ? `?ref=${encodeURIComponent(String(a.ref))}` : "";
    return call(`/api/projects/${a.projectId}/git/log${qs}`);
  });
  tool("git_blame", "git blame 조회", "파일의 라인별 최종 수정 커밋.", { projectId: z.string(), path: z.string(), ref: z.string().optional() }, async (a) => {
    const qs = new URLSearchParams({ path: String(a.path), ...(a.ref ? { ref: String(a.ref) } : {}) });
    return call(`/api/projects/${a.projectId}/git/blame?${qs}`);
  });
  tool("git_show", "git show 조회", "커밋 1건의 메타데이터.", { projectId: z.string(), sha: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/git/show/${a.sha}`),
  );

  // git_diff는 응답이 JSON이 아니라 순수 텍스트(unified diff)라 다른
  // 도구처럼 JSON.stringify로 감싸지 않고 원문 그대로 반환한다.
  server.registerTool(
    "git_diff",
    { title: "git diff 조회", description: "커밋 1건의 unified diff 원문.", inputSchema: { projectId: z.string(), sha: z.string() } },
    async (a: Record<string, unknown>) => {
      try {
        const diff = await apiCallText(`/api/projects/${a.projectId}/git/diff/${a.sha}`);
        return { content: [{ type: "text" as const, text: diff }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---------------------------------------------------------------- git push 훅 프롬프트 자동화 (Phase 3 - 대기열 방식)

  tool(
    "hook_create",
    "push 훅 프롬프트 생성",
    "지정한 브랜치(생략하면 전체)로 push될 때 대기열에 쌓일 프롬프트를 등록한다.",
    { projectId: z.string(), promptTemplate: z.string(), triggerBranch: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/push-hook-prompts`, {
        method: "POST",
        body: JSON.stringify({ promptTemplate: a.promptTemplate, triggerBranch: a.triggerBranch }),
      }),
  );
  tool("hook_list", "push 훅 프롬프트 목록", "프로젝트에 등록된 프롬프트 목록.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/push-hook-prompts`),
  );
  tool("hook_delete", "push 훅 프롬프트 삭제", "프롬프트를 삭제한다(이후 push에 더는 매칭되지 않음).", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/push-hook-prompts/${a.id}`, { method: "DELETE" }),
  );
  tool(
    "hook_queue_list",
    "push 훅 대기열 조회",
    "이 프로젝트를 열 때 먼저 확인해야 할 대기 중인 push 훅 목록(세션 시작 시 pending으로 확인 권장).",
    { projectId: z.string(), status: z.string().optional() },
    async (a) => {
      const qs = a.status ? `?status=${encodeURIComponent(String(a.status))}` : "";
      return call(`/api/projects/${a.projectId}/push-hook-queue${qs}`);
    },
  );
  tool("hook_ack", "push 훅 처리 시작", "대기열 항목을 acknowledged로 표시한다(처리를 막 시작했을 때).", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/push-hook-queue/${a.id}/ack`, { method: "POST" }),
  );
  tool("hook_done", "push 훅 처리 완료", "대기열 항목을 done으로 표시한다(처리를 끝냈을 때).", { projectId: z.string(), id: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/push-hook-queue/${a.id}/done`, { method: "POST" }),
  );

  tool("message_list", "인스턴스 메시지 목록(Phase 4)", "아직 미구현 - EMQX 구독 측 완성 후 사용 가능.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/messages`),
  );
  tool("message_send", "인스턴스 메시지 전송(Phase 4)", "아직 미구현 - EMQX 구독 측 완성 후 사용 가능.", { projectId: z.string(), body: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/messages`, { method: "POST", body: JSON.stringify({ body: a.body }) }),
  );
  tool(
    "message_wait",
    "새 메시지 대기(Phase 4)",
    "아직 미구현 - EMQX 구독 측 완성 후, 새 메시지가 오거나 타임아웃될 때까지 블로킹한다.",
    { projectId: z.string(), timeoutSec: z.number().optional() },
    async (a) => call(`/api/projects/${a.projectId}/messages/wait?timeout=${a.timeoutSec ?? 60}`),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
