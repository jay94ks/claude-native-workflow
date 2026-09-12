#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiCall, apiCallText, loadCredentials, waitForMessageDirect } from "../cli/apiclient.js";
import { scanDirectory, applyManifest } from "../cli/migrate.js";

// cli/index.ts의 모든 명령을 1:1로 미러링한다("CLI/MCP 명령어 완전성"
// 원칙 - 대칭이 깨지면 어느 한쪽에서만 되는 동작이 생긴다). CLI와 마찬가지로
// core/를 직접 호출하지 않고 REST API만 호출하는 순수 클라이언트다 -
// 개인 PC/서버/클라우드 배포 형태를 API 계층 하나로 통일하기 위해서다.
// auth register/login/logout은 도구로 노출하지 않는다(비밀번호가 대화
// 컨텍스트에 남는 걸 피하기 위해 - CLI로 미리 `docs auth login`을 한 번
// 해두는 걸 전제로 한다). 진단용으로 auth_whoami만 예외로 둔다.
// message_wait만 이 "REST만 호출" 원칙의 의도적 예외다(설계자 지시 -
// #message-wait-mqtt-direct) - 자격증명은 여전히 REST(GET /api/auth/me/
// mqtt-credentials)로만 받아오지만, 실제 대기는 EMQX에 직접 구독해서
// 한다(cli/apiclient.ts의 waitForMessageDirect() 참고) - 백엔드가 그
// 구독을 대신 떠맡아 오래 블로킹하지 않기 위해서다.

// AI 안내(prologue) - 응답 객체에 notices: string[]가 있으면 JSON
// 블록 앞에 별도 text content 블록을 하나 더 붙인다(MCP가 다중 content
// 블록을 지원 - "prologue"라는 표현 그대로 본문 앞에 별개 블록).
function textResult(value: unknown) {
  const blocks: { type: "text"; text: string }[] = [];
  if (value && typeof value === "object" && Array.isArray((value as { notices?: unknown }).notices)) {
    for (const notice of (value as { notices: string[] }).notices) {
      blocks.push({ type: "text", text: `⚠ ${notice}` });
    }
  }
  blocks.push({ type: "text", text: JSON.stringify(value, null, 2) });
  return { content: blocks };
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

  tool("auth_whoami", "로그인 상태 확인", "현재 로그인된 사용자 정보를 반환한다(로그인 자체는 CLI에서 `docs auth login`으로).", {}, async () => {
    const creds = loadCredentials();
    if (!creds) return { logged_in: false };
    return { logged_in: true, ...(await call<Record<string, unknown>>("/api/auth/me")) };
  });

  // ---------------------------------------------------------------- 프로필/사용자

  tool(
    "profile_set",
    "내 프로필 수정",
    "이메일/전화번호와 타인 공개 여부를 설정한다.",
    { email: z.string().optional(), phone: z.string().optional(), emailVisible: z.boolean().optional(), phoneVisible: z.boolean().optional() },
    async (a) => call("/api/auth/me", { method: "PUT", body: JSON.stringify(a) }),
  );
  tool("user_get", "다른 설계자 프로필 조회", "userId의 공개 프로필을 조회한다(비공개 필드는 가려짐).", { userId: z.string() }, async (a) =>
    call(`/api/users/${a.userId}`),
  );
  tool(
    "user_activity",
    "설계자 최근 활동 이력",
    "그 설계자의 최근 작업 이력(문서 작성/수정, 질의/답변, 코멘트, 메시지) - 숨겨진 프로젝트의 활동은 조회자가 그 프로젝트 멤버이거나 팀장일 때만 포함된다.",
    { userId: z.string(), limit: z.number().optional() },
    async (a) => {
      const qs = a.limit ? `?limit=${encodeURIComponent(String(a.limit))}` : "";
      return call(`/api/users/${a.userId}/activity${qs}`);
    },
  );

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

  // ---------------------------------------------------------------- 팀/그룹/프로젝트

  tool(
    "team_create",
    "팀 생성",
    "새 팀을 만든다(기본 비공개 - 소속되지 않은 설계자에겐 목록에 안 보임).",
    { name: z.string(), isPublic: z.boolean().optional() },
    async (a) => call("/api/teams", { method: "POST", body: JSON.stringify(a) }),
  );
  tool("team_list", "팀 목록", "전체 팀 목록.", {}, async () => call("/api/teams"));
  tool("team_admin_add", "팀장 등록", "그 팀의 팀장으로 사용자를 등록한다(숨겨진 프로젝트를 보고 해제할 수 있게 됨).", { teamId: z.string(), userId: z.string() }, async (a) =>
    call(`/api/teams/${a.teamId}/admins`, { method: "POST", body: JSON.stringify({ userId: a.userId }) }),
  );
  tool("team_admin_remove", "팀장 해제", "그 팀의 팀장에서 사용자를 제외한다.", { teamId: z.string(), userId: z.string() }, async (a) =>
    call(`/api/teams/${a.teamId}/admins/${a.userId}`, { method: "DELETE" }),
  );
  tool("team_admin_list", "팀장 목록", "그 팀의 팀장 목록.", { teamId: z.string() }, async (a) => call(`/api/teams/${a.teamId}/admins`));
  tool(
    "team_update",
    "팀 수정",
    "팀 이름/활성 여부/공개 여부를 수정한다 - 그 팀의 관리자만 가능.",
    { teamId: z.string(), name: z.string().optional(), enabled: z.boolean().optional(), isPublic: z.boolean().optional() },
    async (a) =>
      call(`/api/teams/${a.teamId}`, {
        method: "PUT",
        body: JSON.stringify({ name: a.name, enabled: a.enabled, isPublic: a.isPublic }),
      }),
  );
  tool(
    "team_delete",
    "팀 삭제",
    "팀을 삭제한다 - 소속 프로젝트 그룹이 하나라도 있으면 거부됨, 그 팀의 관리자만 가능.",
    { teamId: z.string() },
    async (a) => call(`/api/teams/${a.teamId}`, { method: "DELETE" }),
  );
  tool(
    "team_members",
    "팀 멤버 조회",
    "그 팀 산하 모든 프로젝트 그룹·프로젝트의 멤버를 모아 보여준다 - 그 팀의 관리자만 가능(보안 요구사항).",
    { teamId: z.string() },
    async (a) => call(`/api/teams/${a.teamId}/members`),
  );
  tool(
    "group_create",
    "프로젝트 그룹 생성",
    "새 프로젝트 그룹을 만든다(기본 비공개 - 소속되지 않은 설계자에겐 목록에 안 보임).",
    { name: z.string(), teamId: z.string().optional(), isPublic: z.boolean().optional() },
    async (a) => call("/api/project-groups", { method: "POST", body: JSON.stringify(a) }),
  );
  tool("group_list", "프로젝트 그룹 목록", "프로젝트 그룹 목록(teamId로 필터 가능).", { teamId: z.string().optional() }, async (a) => {
    const qs = a.teamId ? `?teamId=${encodeURIComponent(String(a.teamId))}` : "";
    return call(`/api/project-groups${qs}`);
  });
  tool(
    "group_update",
    "프로젝트 그룹 수정",
    "그룹 이름/공개 여부를 수정하거나 다른 팀으로 재소속한다(name/teamId/isPublic 중 하나 이상) - 이름·공개 여부 수정은 그 그룹의 관리자만, 팀 재소속은 목적지 팀의 팀장도 함께 필요(빈 문자열이면 팀 없음으로 뗌).",
    { groupId: z.string(), name: z.string().optional(), teamId: z.string().optional(), isPublic: z.boolean().optional() },
    async (a) =>
      call(`/api/project-groups/${a.groupId}`, {
        method: "PUT",
        body: JSON.stringify({ name: a.name, teamId: a.teamId, isPublic: a.isPublic }),
      }),
  );
  tool(
    "group_delete",
    "프로젝트 그룹 삭제",
    "그룹을 삭제한다 - 소속 프로젝트가 하나라도 있으면 거부됨, 그 그룹의 관리자만 가능.",
    { groupId: z.string() },
    async (a) => call(`/api/project-groups/${a.groupId}`, { method: "DELETE" }),
  );
  tool(
    "group_members",
    "프로젝트 그룹 멤버 조회",
    "그 그룹 산하 모든 프로젝트의 멤버를 모아 보여준다 - 그 그룹의 관리자만 가능(보안 요구사항).",
    { groupId: z.string() },
    async (a) => call(`/api/project-groups/${a.groupId}/members`),
  );
  tool(
    "group_admin_add",
    "그룹 관리자 등록",
    "그 프로젝트 그룹의 관리자로 사용자를 등록한다.",
    { groupId: z.string(), userId: z.string() },
    async (a) => call(`/api/project-groups/${a.groupId}/admins`, { method: "POST", body: JSON.stringify({ userId: a.userId }) }),
  );
  tool(
    "group_admin_remove",
    "그룹 관리자 해제",
    "그 프로젝트 그룹의 관리자에서 사용자를 제외한다.",
    { groupId: z.string(), userId: z.string() },
    async (a) => call(`/api/project-groups/${a.groupId}/admins/${a.userId}`, { method: "DELETE" }),
  );
  tool("group_admin_list", "그룹 관리자 목록", "그 프로젝트 그룹의 관리자 목록.", { groupId: z.string() }, async (a) =>
    call(`/api/project-groups/${a.groupId}/admins`),
  );
  tool(
    "project_create",
    "프로젝트 생성",
    "새 프로젝트를 만든다(그룹 생략 시 기본 그룹 사용, 기본 비공개 - isPublic이어도 그 그룹에 실제 멤버십이 있는 설계자에게만 보임).",
    { name: z.string(), projectGroupId: z.string().optional(), isPublic: z.boolean().optional() },
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
    "project_hide",
    "프로젝트 숨김 설정",
    "프로젝트를 숨기거나(hidden=true) 해제한다(hidden=false) - 프로젝트 owner, 소속 팀의 팀장, 소속 그룹의 관리자만 가능.",
    { projectId: z.string(), hidden: z.boolean() },
    async (a) => call(`/api/projects/${a.projectId}/hidden`, { method: "PUT", body: JSON.stringify({ hidden: a.hidden }) }),
  );
  tool(
    "project_public",
    "프로젝트 공개 설정",
    "프로젝트를 공개(isPublic=true) 또는 비공개(isPublic=false)로 바꾼다 - 프로젝트 owner, 소속 팀의 팀장, 소속 그룹의 관리자만 가능. 공개여도 그 그룹에 실제 멤버십이 있는 설계자에게만 보인다.",
    { projectId: z.string(), isPublic: z.boolean() },
    async (a) => call(`/api/projects/${a.projectId}/public`, { method: "PUT", body: JSON.stringify({ isPublic: a.isPublic }) }),
  );
  tool(
    "project_delete",
    "프로젝트 삭제",
    "프로젝트를 완전히 삭제한다(문서/코멘트/칸반/Q&A/연결된 Gitea 저장소까지 전부 - 되돌릴 수 없음, owner 전용).",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}`, { method: "DELETE" }),
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
  tool(
    "member_set_role",
    "프로젝트 멤버 역할 변경",
    "프로젝트 멤버의 role을 바꾼다(owner|editor|viewer).",
    { projectId: z.string(), userId: z.string(), role: z.enum(["owner", "editor", "viewer"]) },
    async (a) => call(`/api/projects/${a.projectId}/members/${a.userId}`, { method: "PUT", body: JSON.stringify({ role: a.role }) }),
  );
  tool(
    "member_remove",
    "프로젝트 멤버 제거",
    "프로젝트에서 멤버를 제거한다.",
    { projectId: z.string(), userId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/members/${a.userId}`, { method: "DELETE" }),
  );

  // ---------------------------------------------------------------- 문서 타입 체계

  tool(
    "doctype_create",
    "문서 타입 생성",
    "프로젝트 스코프로 새 문서 타입을 정의한다(code는 영문 2글자).",
    { projectId: z.string(), code: z.string(), label: z.string(), guideline: z.string().optional() },
    async (a) => call(`/api/projects/${a.projectId}/doc-types`, { method: "POST", body: JSON.stringify({ code: a.code, label: a.label, guideline: a.guideline }) }),
  );
  tool("doctype_list", "문서 타입 목록", "그 프로젝트에 정의된 문서 타입 목록(팀/그룹 단위로 획일화해 정하는 기능은 없음 - 항상 프로젝트 자신에게만 정의됨. 각 항목의 isDefault로 기본 시드 타입인지 구분 가능).", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/doc-types`),
  );
  tool(
    "doctype_update",
    "문서 타입 이름 수정",
    "code/label을 수정한다 - 프로젝트 생성 시 자동으로 심어진 기본 타입(isDefault: true)은 거부됨(삭제만 가능).",
    { projectId: z.string(), docTypeId: z.string(), code: z.string().optional(), label: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/doc-types/${a.docTypeId}`, {
        method: "PUT",
        body: JSON.stringify({ code: a.code, label: a.label }),
      }),
  );
  tool(
    "doctype_delete",
    "문서 타입 삭제",
    "문서 타입을 삭제한다 - 이 타입으로 만든 문서가 하나라도 남아있으면 거부됨(기본/커스텀 타입 구분 없이 동일하게 적용).",
    { projectId: z.string(), docTypeId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/doc-types/${a.docTypeId}`, { method: "DELETE" }),
  );
  tool(
    "doctype_guideline_set",
    "문서 타입 지침 설정",
    "그 문서 타입이 무엇을 하기 위한 것인지 자연어 설명을 쓰거나 수정한다(빈 문자열이면 지움).",
    { projectId: z.string(), docTypeId: z.string(), guideline: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/doc-types/${a.docTypeId}/guideline`, { method: "PUT", body: JSON.stringify({ guideline: a.guideline }) }),
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
    "document_transition_bulk",
    "문서 상태 일괄 전이",
    "여러 문서를 한 번에 같은 상태로 전이한다 - 항목별 결과({trackingCode, ok, error?})를 반환하며 일부만 실패해도 나머지는 계속 진행된다.",
    { trackingCodes: z.array(z.string()), toStatusCode: z.string() },
    async (a) => call(`/api/documents/bulk-transition`, { method: "POST", body: JSON.stringify({ trackingCodes: a.trackingCodes, toStatusCode: a.toStatusCode }) }),
  );
  tool(
    "document_priority_set",
    "문서 우선순위 설정",
    "문서 우선순위(정수)를 설정/갱신한다 - 문서 상태가 review 또는 pending일 때만 가능(Q&A의 별개 pending 개념과는 무관).",
    { trackingCode: z.string(), priority: z.number().int() },
    async (a) => call(`/api/documents/${a.trackingCode}/priority`, { method: "PUT", body: JSON.stringify({ priority: a.priority }) }),
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

  tool(
    "document_revisions",
    "버전 이력 조회",
    "문서의 수정 이력(리비전) 목록 - 각 항목은 그 시점까지의 본문 스냅샷.",
    { trackingCode: z.string() },
    async (a) => call(`/api/documents/${a.trackingCode}/revisions`),
  );
  tool(
    "document_next_statuses",
    "다음 선택 가능 상태 목록",
    "이 문서에서 지금 전이 가능한 다음 상태 목록(코드/라벨/지침).",
    { trackingCode: z.string() },
    async (a) => call(`/api/documents/${a.trackingCode}/next-statuses`),
  );
  tool(
    "document_delete",
    "문서 삭제",
    "문서를 삭제한다(리비전/링크/코멘트/질문+답변까지 함께 정리) - delete 권한이 필요하다.",
    { trackingCode: z.string() },
    async (a) => call(`/api/documents/${a.trackingCode}`, { method: "DELETE" }),
  );

  // ---------------------------------------------------------------- 연관된 소스코드

  tool(
    "document_link_source",
    "소스코드 링크 추가",
    "이 문서와 연관된 소스코드 파일 경로를 연결한다(git 저장소 루트 기준 상대 경로).",
    { trackingCode: z.string(), filePath: z.string() },
    async (a) =>
      call(`/api/documents/${a.trackingCode}/source-links`, {
        method: "POST",
        body: JSON.stringify({ filePath: a.filePath }),
      }),
  );
  tool(
    "document_unlink_source",
    "소스코드 링크 제거",
    "연결된 소스코드 링크를 제거한다.",
    { trackingCode: z.string(), linkId: z.string() },
    async (a) =>
      call(`/api/document-source-links/${a.linkId}?trackingCode=${encodeURIComponent(a.trackingCode as string)}`, {
        method: "DELETE",
      }),
  );
  tool(
    "document_source_links",
    "연관된 소스코드 목록",
    "이 문서와 연관된 소스코드 파일 경로 목록.",
    { trackingCode: z.string() },
    async (a) => call(`/api/documents/${a.trackingCode}/source-links`),
  );

  // ---------------------------------------------------------------- 세부 접근 권한

  tool(
    "access_set",
    "세부 접근 권한 설정",
    "프로젝트 공통/문서타입/개별문서 스코프 중 하나(docTypeId나 documentId를 주면 그 스코프, 둘 다 안 주면 프로젝트 공통)로 특정 사용자의 읽기/쓰기/삭제 권한을 설정한다 - owner 전용.",
    {
      projectId: z.string(),
      userId: z.string(),
      docTypeId: z.string().optional(),
      documentId: z.string().optional(),
      canRead: z.boolean().optional(),
      canWrite: z.boolean().optional(),
      canDelete: z.boolean().optional(),
    },
    async (a) => {
      const patch = { userId: a.userId, canRead: a.canRead, canWrite: a.canWrite, canDelete: a.canDelete };
      if (a.documentId) return call(`/api/documents/${a.documentId}/access`, { method: "PUT", body: JSON.stringify(patch) });
      if (a.docTypeId) return call(`/api/projects/${a.projectId}/doc-types/${a.docTypeId}/access`, { method: "PUT", body: JSON.stringify(patch) });
      return call(`/api/projects/${a.projectId}/access`, { method: "PUT", body: JSON.stringify(patch) });
    },
  );
  tool("access_list", "세부 접근 권한 목록", "프로젝트에 설정된 모든 오버라이드 목록.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/access`),
  );
  tool(
    "access_overview",
    "내 접근 제한 전체 조회",
    "이 설계자가 전체 설치에서 어떤 접근 제한을 받고 있는지 프로젝트를 가로질러 한 번에 조회한다.",
    {},
    async () => call("/api/auth/me/access-overview"),
  );

  // ---------------------------------------------------------------- 칸반 보드
  // 코멘트/폴더와 달리 이 기능은 AI에게 완전히 노출된다 - 컬럼 순서/숨김
  // 변경과 카드 코멘트만 예외(개인 UI 설정이거나 설계자간 채널)로 없음.

  tool(
    "kanban_columns",
    "칸반 분류 목록",
    "이 프로젝트의 칸반 분류(컬럼) 목록 - 순서/숨김은 이 신원 기준.",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/kanban/columns`),
  );
  tool(
    "kanban_card_new",
    "칸반 카드 생성",
    "칸반 카드를 만들어 분류에 추가한다(AI가 만든 카드로 기록됨 - 설계자가 만든 카드와 달리 메시지 알림이 안 감).",
    {
      projectId: z.string(),
      columnId: z.string(),
      title: z.string(),
      body: z.string().optional(),
      refs: z.array(z.string()).optional(),
    },
    async (a) =>
      call(`/api/projects/${a.projectId}/kanban/cards`, {
        method: "POST",
        body: JSON.stringify({ columnId: a.columnId, title: a.title, body: a.body, refs: a.refs, origin: "ai" }),
      }),
  );
  tool(
    "kanban_cards",
    "칸반 카드 목록",
    "칸반 카드 목록(숨긴 카드 제외) - columnId를 주면 그 분류로 제한.",
    { projectId: z.string(), columnId: z.string().optional() },
    async (a) => call(`/api/projects/${a.projectId}/kanban/cards${a.columnId ? `?columnId=${a.columnId}` : ""}`),
  );
  tool(
    "kanban_card_get",
    "칸반 카드 상세",
    "칸반 카드 상세(근거 문서 포함).",
    { trackingCode: z.string() },
    async (a) => call(`/api/kanban/cards/${a.trackingCode}`),
  );
  tool(
    "kanban_card_move",
    "칸반 카드 이동",
    "칸반 카드를 다른 분류로(또는 같은 분류 안 다른 위치로) 옮긴다.",
    { trackingCode: z.string(), toColumnId: z.string(), toIndex: z.number().optional() },
    async (a) =>
      call(`/api/kanban/cards/${a.trackingCode}/move`, {
        method: "PUT",
        body: JSON.stringify({ toColumnId: a.toColumnId, toIndex: a.toIndex }),
      }),
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
  // targetType/targetKey로 다형화됨(document/source/kanbanCard) - document/
  // kanbanCard 대상은 그 자신의 트래킹 코드만으로 서버가 대상 종류를
  // 자동 판별한다(resolveTargetByTrackingCode). source 대상은 트래킹
  // 코드가 없어 별도 도구가 필요하다.

  tool(
    "question_add",
    "질의 등록",
    "문서/칸반 카드에 대한 질의를 등록하고 추적 코드를 발급받는다(질의는 AI가 등록, 설계자가 답변) - kind로 승인 요청(approval)/답변 요청(answer, 기본값)을 구분하고, refs로 판단에 참고한 문서를 태깅할 수 있다. options로 설계자가 고를 수 있는 제안 선택지(라벨+부가정보)를 같이 제시할 수 있다 - 클릭하면 답변 입력칸에 라벨이 채워질 뿐 자동 제출은 안 됨.",
    {
      trackingCode: z.string(),
      text: z.string(),
      kind: z.enum(["approval", "answer"]).optional(),
      refs: z.array(z.string()).optional(),
      options: z.array(z.object({ label: z.string(), detail: z.string().optional() })).optional(),
    },
    async (a) =>
      call(`/api/questions`, {
        method: "POST",
        body: JSON.stringify({ trackingCode: a.trackingCode, kind: a.kind ?? "answer", text: a.text, refs: a.refs, options: a.options }),
      }),
  );
  tool(
    "question_add_source",
    "소스 코드 파일에 질의 등록",
    "문서/칸반 카드가 아닌 소스 코드 파일에 AI 질의를 등록한다 - kind/refs/options는 question_add와 동일.",
    {
      projectId: z.string(),
      path: z.string(),
      text: z.string(),
      kind: z.enum(["approval", "answer"]).optional(),
      refs: z.array(z.string()).optional(),
      options: z.array(z.object({ label: z.string(), detail: z.string().optional() })).optional(),
    },
    async (a) =>
      call(`/api/projects/${a.projectId}/questions/source`, {
        method: "POST",
        body: JSON.stringify({ path: a.path, kind: a.kind ?? "answer", text: a.text, refs: a.refs, options: a.options }),
      }),
  );
  tool("question_list", "문서/칸반 카드의 전체 질의/답변 조회", "한 대상의 질의 전체(open+pending+resolved)를 답변과 함께 순서대로 조회한다.", { trackingCode: z.string() }, async (a) =>
    call(`/api/questions?trackingCode=${a.trackingCode}`),
  );
  tool(
    "question_list_source",
    "소스 코드 파일의 전체 질의/답변 조회",
    "소스 코드 파일에 달린 질의 전체를 조회한다.",
    { projectId: z.string(), path: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/questions/source?path=${encodeURIComponent(String(a.path))}`),
  );
  tool("pending_list", "미해결 질의 목록", "프로젝트의 미해결(open+pending) 질의 목록 - pending은 설계자가 답변했지만 AI가 아직 확인 안 한 것.", { projectId: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/pending`),
  );
  tool(
    "question_reply",
    "질의에 답변",
    "질의에 답변하면 상태가 pending으로 바뀌고(종결 아님 - AI 확인 대기), 문서 대상의 모든 질의가 open을 벗어나면 문서 상태도 자동 전이될 수 있다. kind=answer면 body, kind=approval이면 decision(+선택 body 메모)을 쓴다.",
    { questionTrackingCode: z.string(), body: z.string().optional(), decision: z.enum(["approved", "rejected"]).optional() },
    async (a) => call(`/api/questions/${a.questionTrackingCode}/answer`, { method: "POST", body: JSON.stringify({ body: a.body, decision: a.decision }) }),
  );
  tool(
    "question_ack",
    "질의 확인 완료 표시",
    "설계자가 답변한(pending) 질의를 확인 완료(resolved)로 표시한다 - pending 목록에 쌓인 것을 처리할 때 씀.",
    { questionTrackingCode: z.string() },
    async (a) => call(`/api/questions/${a.questionTrackingCode}/ack`, { method: "POST" }),
  );
  tool(
    "question_ack_bulk",
    "질의 일괄 확인 완료 표시",
    "여러 pending 질의를 한 번에 확인 완료로 표시한다 - 항목별 결과({trackingCode, ok, error?})를 반환하며 일부만 실패해도 나머지는 계속 진행된다. 마이그레이션 직후처럼 pending이 몰려 있을 때 씀.",
    { trackingCodes: z.array(z.string()) },
    async (a) => call(`/api/questions/bulk-ack`, { method: "POST", body: JSON.stringify({ trackingCodes: a.trackingCodes }) }),
  );
  tool(
    "question_withdraw",
    "질의 철회",
    "본인이 등록한 질문 중 아직 답변되지 않은(open) 것을 철회한다 - 더 이상 유효하지 않게 된 질문을 정리할 때 씀.",
    { questionTrackingCode: z.string() },
    async (a) => call(`/api/questions/${a.questionTrackingCode}/withdraw`, { method: "POST" }),
  );

  // 코멘트는 설계자들끼리만 쓰는 채널이다(웹 UI 전용) - AI의 참고
  // 지표가 될 수 없어 의도적으로 도구를 두지 않는다("CLI/MCP 명령어
  // 완전성" 원칙의 의도적 예외 - 소스 코드/칸반 카드 코멘트도 동일).

  // ---------------------------------------------------------------- 템플릿 (CLAUDE.md, SKILL.md 등)

  tool(
    "template_get",
    "템플릿 조회",
    "CLAUDE.md/SKILL.md 등 템플릿 파일의 실제 적용될 내용을 조회한다(project → group → team → 전역 기본값 순).",
    { filename: z.string(), projectId: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ filename: String(a.filename), ...(a.projectId ? { projectId: String(a.projectId) } : {}) });
      return call(`/api/templates?${qs}`);
    },
  );
  tool(
    "template_set",
    "템플릿 override 설정",
    "특정 스코프(팀/그룹/프로젝트, 생략하면 전역 기본값)에 템플릿 내용을 설정한다.",
    { filename: z.string(), content: z.string(), teamId: z.string().optional(), projectGroupId: z.string().optional(), projectId: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ filename: String(a.filename) });
      return call(`/api/templates?${qs}`, {
        method: "PUT",
        body: JSON.stringify({ content: a.content, teamId: a.teamId, projectGroupId: a.projectGroupId, projectId: a.projectId }),
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
  tool(
    "template_revisions",
    "템플릿 변경 이력 조회",
    "특정 스코프(팀/그룹/프로젝트, 생략하면 전역 기본값)에서 그 템플릿 파일이 덮어써지기 전 과거 내용들을 시간순으로 조회한다 - 실수로 잘못된 내용을 덮어썼을 때 이전 버전을 확인하고 template_set으로 그 content를 다시 넘겨 복원하는 데 쓴다.",
    { filename: z.string(), teamId: z.string().optional(), projectGroupId: z.string().optional(), projectId: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({
        filename: String(a.filename),
        ...(a.teamId ? { teamId: String(a.teamId) } : {}),
        ...(a.projectGroupId ? { projectGroupId: String(a.projectGroupId) } : {}),
        ...(a.projectId ? { projectId: String(a.projectId) } : {}),
      });
      return call(`/api/templates/revisions?${qs}`);
    },
  );

  // ---------------------------------------------------------------- git 저장소 연결 + 이력 조회 (Phase 2)

  tool(
    "git_link",
    "git 저장소 연결(자체 호스팅)",
    "Gitea에 저장소를 만들고 프로젝트에 연결한다 - importFromUrl을 주면 그 저장소의 히스토리를 통째로 가져와 시작한다(완전 이주).",
    { projectId: z.string(), importFromUrl: z.string().optional(), gitCredentialId: z.string().optional() },
    async (a) =>
      call(`/api/projects/${a.projectId}/git/link`, {
        method: "POST",
        body: JSON.stringify(a.importFromUrl ? { importFrom: { repoUrl: a.importFromUrl, gitCredentialId: a.gitCredentialId } } : {}),
      }),
  );
  tool(
    "git_link_external",
    "git 저장소 연동(외부를 주된 저장소로)",
    "외부 GitHub/GitLab 저장소를 주된(authoritative) 저장소로 연동한다 - 관리 편의를 위해 Gitea에 미러(읽기 전용)와 작업 저장소(이 시스템이 커밋하는 곳)를 같이 만든다.",
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
  tool(
    "git_unlink",
    "외부 연동 해제(자체 호스팅으로 전환)",
    "외부 연동(git_link_external)의 권위 저장소 관계만 끊는다 - Gitea 작업 저장소는 그대로 남아 self_hosted로 전환된다(자체 호스팅 저장소는 해제할 수 없다 - 프로젝트 삭제만 가능).",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/repo`, { method: "DELETE" }),
  );
  tool(
    "git_sync_status",
    "동기화 상태 확인",
    "외부 연동(git_link_external) 프로젝트의 미러 대비 작업 저장소 변경 현황(added/changed/removedFromWork)을 확인한다 - Gitea의 미러 동기화가 비동기라 요청 후 완료될 때까지 기다렸다가 결과를 반환한다(이미 다른 요청이 진행 중이면 그 결과를 그대로 기다림).",
    { projectId: z.string() },
    async (a) => {
      await call(`/api/projects/${a.projectId}/git/sync-status`, { method: "POST" });
      for (;;) {
        const state = await call<{ status: string }>(`/api/projects/${a.projectId}/git/sync-status`);
        if (state.status === "ready") return state;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    },
  );
  tool(
    "git_sync_proposal",
    "동기화 제안 내용 조회",
    "외부 연동 프로젝트에서 달라진 파일들의 실제 내용을 가져온다 - 외부(권위) 저장소로 반영하는 건 설계자 몫.",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/sync-proposal`),
  );
  tool(
    "git_publish",
    "외부 저장소로 동기화(발행)",
    "외부(권위) 저장소로 실제 동기화(push)를 시도한다 - 즉시 반영되면 status:synced, fast-forward 불가/권한 부족이면 status:queued로 AI 대기열에 올라간다(이 프로젝트에 메시지로도 안내됨).",
    { projectId: z.string(), gitCredentialId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/publish`, { method: "POST", body: JSON.stringify({ gitCredentialId: a.gitCredentialId }) }),
  );
  tool(
    "git_publish_queue",
    "발행 대기열 조회",
    "이 프로젝트의 처리 대기 중인 발행 큐 항목(없으면 null) - 세션 시작 시 확인 권장(pending이면 처리 후 git_publish_queue_done으로 보고).",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/publish-queue`),
  );
  tool(
    "git_publish_queue_done",
    "발행 대기열 처리 완료 보고",
    "발행 큐 항목 처리를 완료로 보고한다 - 그래야 웹 UI의 동기화 버튼이 다시 활성화된다.",
    { projectId: z.string(), id: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/git/publish-queue/${a.id}/done`, { method: "POST" }),
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

  tool(
    "git_tree",
    "git 디렉터리 조회",
    "저장소의 디렉터리 목록을 조회한다(path 생략하면 루트).",
    { projectId: z.string(), path: z.string().optional(), ref: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ path: String(a.path ?? ""), ...(a.ref ? { ref: String(a.ref) } : {}) });
      return call(`/api/projects/${a.projectId}/git/tree?${qs}`);
    },
  );
  tool(
    "git_cat",
    "git 파일 조회",
    "저장소의 파일 1건 내용을 조회한다.",
    { projectId: z.string(), path: z.string(), ref: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ path: String(a.path), ...(a.ref ? { ref: String(a.ref) } : {}) });
      return call(`/api/projects/${a.projectId}/git/file?${qs}`);
    },
  );
  tool(
    "git_put",
    "git 파일 저장",
    "저장소에 파일을 커밋한다(있으면 갱신, 없으면 생성).",
    { projectId: z.string(), path: z.string(), content: z.string(), message: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ path: String(a.path) });
      return call(`/api/projects/${a.projectId}/git/file?${qs}`, {
        method: "PUT",
        body: JSON.stringify({ content: a.content, message: a.message }),
      });
    },
  );

  // ---------------------------------------------------------------- git push 훅 프롬프트 자동화 (Phase 3 - 대기열 방식)

  tool(
    "hook_create",
    "push 훅 프롬프트 생성",
    '지정한 브랜치(생략하면 전체)로 push될 때 대기열에 쌓일 프롬프트를 등록한다 - "release/*"처럼 *로 브랜치 그룹을 묶을 수 있다(세그먼트 안에서만, /는 안 넘음).',
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
  tool(
    "hook_update",
    "push 훅 프롬프트 수정",
    '트리거 브랜치나 프롬프트 내용을 바꾼다 - triggerBranch에 "release/*"처럼 *를 쓰면 브랜치 그룹을 묶을 수 있고, 빈 문자열을 주면 브랜치 제한을 해제한다(모든 브랜치 매칭), 생략하면 기존 값 유지.',
    { projectId: z.string(), id: z.string(), promptTemplate: z.string().optional(), triggerBranch: z.string().optional() },
    async (a) => {
      const body: Record<string, unknown> = {};
      if (a.promptTemplate !== undefined) body.promptTemplate = a.promptTemplate;
      if (a.triggerBranch !== undefined) body.triggerBranch = a.triggerBranch;
      return call(`/api/projects/${a.projectId}/push-hook-prompts/${a.id}`, { method: "PUT", body: JSON.stringify(body) });
    },
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

  tool(
    "message_list",
    "인스턴스 메시지 목록",
    "그 프로젝트의 메시지 기록을 조회한다 - 조회 자체는 상태(대기/처리중/기록)를 안 바꾼다(읽음은 message_ack와 별개 축). status로 pending(대기)/processing(처리중)/delivered(기록)/all 필터 가능(기본 all).",
    { projectId: z.string(), status: z.enum(["pending", "processing", "delivered", "all"]).optional() },
    async (a) => {
      const qs = new URLSearchParams({ markDelivered: "true", ...(a.status ? { status: String(a.status) } : {}) });
      return call(`/api/projects/${a.projectId}/messages?${qs}`);
    },
  );
  tool("message_send", "인스턴스 메시지 전송", "같은 프로젝트의 다른 세션/설계자에게 메시지를 남긴다.", { projectId: z.string(), body: z.string() }, async (a) =>
    call(`/api/projects/${a.projectId}/messages`, { method: "POST", body: JSON.stringify({ body: a.body }) }),
  );
  tool(
    "message_wait",
    "새 메시지 대기",
    "새 메시지가 오거나 timeoutSec(전체 대기 시간)이 다 될 때까지 기다린다 - EMQX에 직접 구독해 대기하므로(서버는 블로킹하지 않음) 메시지가 오면 즉시 잡히고, 이 경로를 못 쓰는 환경에서는 10초 단위 HTTP 폴링으로 자동 폴백한다. 받은 메시지는 자동으로 기록(delivered) 처리된다.",
    { projectId: z.string(), timeoutSec: z.number().optional() },
    async (a) => waitForMessageDirect(a.projectId as string, (a.timeoutSec as number | undefined) ?? 60),
  );
  tool(
    "message_recent",
    "최근 메시지 조회(장애 복구용)",
    "상태를 전혀 바꾸지 않는 순수 조회 - 시스템 다운 등으로 세션이 비정상 종료됐다가 복구됐을 때 마지막 기록을 확인하는 용도라 반복 호출해도 안전하다. 대기/기록 구분 없이 최신순.",
    { projectId: z.string(), limit: z.number().optional() },
    async (a) => {
      const qs = a.limit ? `?limit=${encodeURIComponent(String(a.limit))}` : "";
      return call(`/api/projects/${a.projectId}/messages/recent${qs}`);
    },
  );
  tool(
    "message_edit",
    "메시지 수정",
    "본인이 보낸 메시지만 수정할 수 있다.",
    { id: z.string(), body: z.string() },
    async (a) => call(`/api/messages/${a.id}`, { method: "PUT", body: JSON.stringify({ body: a.body }) }),
  );
  tool(
    "message_delete",
    "메시지 삭제",
    "본인이 보낸 메시지만 삭제할 수 있다.",
    { id: z.string() },
    async (a) => call(`/api/messages/${a.id}`, { method: "DELETE" }),
  );
  tool(
    "message_ack",
    "메시지 처리 시작 표시",
    "대기 → 처리중으로 옮긴다(프로젝트 멤버 누구나 가능 - 보낸 사람이 아니어도 됨). 이미 처리중이거나 기록 상태면 그대로 반환.",
    { id: z.string() },
    async (a) => call(`/api/messages/${a.id}/ack`, { method: "PUT" }),
  );
  tool(
    "message_complete",
    "메시지 처리 완료 표시",
    "처리중 → 기록으로 옮긴다. ack 없이 바로 불러도 ackedAt까지 자동으로 채워진다. 이미 기록 상태면 그대로 반환.",
    { id: z.string() },
    async (a) => call(`/api/messages/${a.id}/complete`, { method: "PUT" }),
  );

  // ---------------------------------------------------------------- 검색 엔진 장애 대응 큐(관리자 전용)

  tool(
    "search_queue_status",
    "검색 동기화 큐 상태",
    "Meilisearch 장애 중 밀린 색인 쓰기 큐의 현재 상태를 조회한다(관리자 전용) - 30초 주기 워커가 자동으로 비우지만, 장애가 실제로 해소됐는지 확인하는 용도.",
    {},
    async () => call("/api/admin/search-queue"),
  );
  tool(
    "search_queue_drain",
    "검색 동기화 큐 수동 드레인",
    "밀린 색인 쓰기 큐를 즉시 일괄 재처리한다(관리자 전용) - 장애 해소를 확인한 뒤 30초 워커 주기를 기다리지 않고 바로 비우고 싶을 때.",
    {},
    async () => call("/api/admin/search-queue/drain", { method: "POST" }),
  );

  // ---------------------------------------------------------------- 가이디드 마이그레이션 (Phase 6)

  tool(
    "migrate_scan",
    "마이그레이션 후보 스캔",
    "concept 스타일 파일 기반 프로젝트(YAML frontmatter+마크다운)를 로컬 sourceDir에서 스캔해 후보 목록을 반환한다 - 흔한 옛 상태 어휘(active/wip 등)를 표준 코드로 자동 제안한다(applyStatusPreset:false로 끌 수 있음, 바뀐 항목은 originalStatusCode에 원본이 남음). 순수 로컬 동작, 이 결과를 검토·수정한 뒤 로컬 매니페스트 파일로 저장해 migrate_apply에 넘긴다.",
    { sourceDir: z.string(), applyStatusPreset: z.boolean().optional() },
    async (a) => scanDirectory(String(a.sourceDir), { applyStatusPreset: a.applyStatusPreset as boolean | undefined }),
  );
  tool(
    "migrate_apply",
    "마이그레이션 반영",
    "검토·수정을 마친 로컬 매니페스트 파일(manifestFile)을 읽어 문서/링크를 실제로 생성한다.",
    { projectId: z.string(), manifestFile: z.string() },
    async (a) => applyManifest(String(a.projectId), String(a.manifestFile)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
