// 배치 2h(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 문서
// + 챕터(헤딩 섹션) CRUD + 연관된 소스코드 + 연관된 브랜치.
// mcp/server.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜.
// (monitoring_stats/monitoring_stats_all은 원래 이 섹션 한가운데
// 물리적으로 끼어 있었지만 실제로는 모니터링 도메인이라
// monitoringTools.ts로 따로 뺐다 - 헤더/내용 불일치, #58에서 반복
// 발견된 패턴과 동일.)
import { z } from "zod";
import { call, type ToolRegistrar } from "../shared.js";

export function registerDocumentTools(tool: ToolRegistrar): void {
  tool(
    "document_new",
    "문서 생성",
    "새 문서를 만들고 추적 코드를 발급받는다. 응답에 본문은 없음(호출자가 이미 보낸 내용), updatedAt으로 생성 시각 확인 - 본문이 필요하면 document_get/document_read/document_grep으로 이어서 조회.",
    { projectId: z.string(), docTypeCode: z.string(), title: z.string(), body: z.string() },
    async (a) =>
      call(`/api/projects/${a.projectId}/documents`, {
        method: "POST",
        body: JSON.stringify({ docTypeCode: a.docTypeCode, title: a.title, body: a.body }),
      }),
  );
  tool(
    "document_get",
    "문서 조회",
    "추적 코드로 문서 1건을 조회한다. 응답에 linksOut(이 문서가 링크한 문서, order 포함)/backlinks(이 문서를 링크한 문서) 배열로 연관 문서 추적코드가 함께 온다 - 별도로 document_links_out/document_backlinks를 호출하지 않아도 됨.",
    { trackingCode: z.string() },
    async (a) => call(`/api/documents/${a.trackingCode}`),
  );
  tool(
    "document_list",
    "문서 목록",
    "프로젝트의 문서 색인 조회(본문 제외 - trackingCode/title/docTypeId/statusCode 등 요약만, 본문이 필요하면 document_get/document_read/document_grep으로 이어서 조회). docTypeId/status로 필터 가능 - status는 draft/review/pending/approved/deprecated/archived 중 하나, 예: 검토 대기 목록은 status=review. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열(최대 1000건).",
    {
      projectId: z.string(),
      docTypeId: z.string().optional(),
      status: z.string().optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        ...(a.docTypeId ? { docTypeId: String(a.docTypeId) } : {}),
        ...(a.status ? { statusCode: String(a.status) } : {}),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
      });
      const suffix = paged ? "/page" : "";
      return call(`/api/projects/${a.projectId}/documents${suffix}${qs.toString() ? `?${qs}` : ""}`);
    },
  );
  tool(
    "document_search",
    "문서 검색",
    "Meilisearch 기반 전문 검색. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 관련도 상위 50건. lines를 주면 각 히트의 본문을 앞 n줄까지만 잘라 응답 크기를 줄인다(실제로 잘렸으면 bodyTruncated:true). codesOnly를 true로 주면 본문/메타 없이 trackingCode 배열만 반환(lines보다 더 가벼움 - 코드만 필요할 때).",
    {
      projectId: z.string(),
      query: z.string(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
      lines: z.number().optional(),
      codesOnly: z.boolean().optional(),
    },
    async (a) => {
      const paged = a.page !== undefined || a.pageSize !== undefined;
      const qs = new URLSearchParams({
        q: String(a.query),
        ...(paged ? { page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) } : {}),
        ...(a.lines !== undefined ? { lines: String(a.lines) } : {}),
        ...(a.codesOnly ? { codesOnly: "true" } : {}),
      });
      return call(`/api/projects/${a.projectId}/search?${qs}`);
    },
  );
  tool(
    "search_all",
    "문서+계획 통합 검색",
    "문서(Meilisearch 전문 검색)와 계획(부분 일치)을 한 번에 훑는다 - 각 항목 kind(document|plan)/trackingCode/title/statusCode만 반환(본문 없음, 필요하면 document_get/plan_get으로 이어서 조회). 특정 키워드/추적코드를 언급하는 곳을 문서/계획 양쪽에서 찾을 때 document_search+plan_list를 따로 두 번 안 불러도 된다.",
    { projectId: z.string(), query: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/search-all?${new URLSearchParams({ q: a.query as string })}`),
  );
  tool(
    "refs_status",
    "참조 추적 코드 상태 요약",
    "이 문서/계획/칸반 카드 본문에 언급된 모든 추적 코드의 현재 title/status를 한 번에 모아 본다(\"완료된 계획이 아직 미구현으로 언급됨\" 같은 불일치를 매번 하나씩 다시 조회하지 않고 찾을 때) - 대상을 못 찾은 코드는 title/status가 null.",
    { trackingCode: z.string() },
    async (a) => call(`/api/refs-status/${a.trackingCode}`),
  );
  tool("document_save", "문서 본문 갱신", "문서 본문을 덮어쓰고 버전 이력을 남긴다. 응답에 본문은 없음(호출자가 이미 보낸 내용), updatedAt으로 저장 여부만 확인 - 본문이 필요하면 document_get/document_read/document_grep으로 이어서 조회.", { trackingCode: z.string(), body: z.string() }, async (a) =>
    call(`/api/documents/${a.trackingCode}`, { method: "PUT", body: JSON.stringify({ body: a.body }) }),
  );
  tool(
    "document_patch",
    "문서 본문 부분 치환",
    "문서 본문의 일부만 바꾼다(str_replace 방식) - oldStr이 본문에 정확히 한 번만 있을 때만 적용하고, 없거나 여러 번 있으면 아무것도 바꾸지 않고 실패한다(replaceAll:true면 일치하는 곳 전부 교체). 본문 전체를 다시 안 보내도 되므로 큰 문서에 짧은 내용만 끼워 넣을 때 document_save보다 적합. 응답에 본문은 없음.",
    { trackingCode: z.string(), oldStr: z.string(), newStr: z.string(), replaceAll: z.boolean().optional() },
    async (a) =>
      call(`/api/documents/${a.trackingCode}/patch`, {
        method: "PUT",
        body: JSON.stringify({ oldStr: a.oldStr, newStr: a.newStr, replaceAll: a.replaceAll }),
      }),
  );
  const documentPatchItemObject = z.object({
    trackingCode: z.string(),
    oldStr: z.string(),
    newStr: z.string(),
    replaceAll: z.boolean().optional(),
  });
  tool(
    "document_patch_batch",
    "문서 본문 일괄 부분 치환",
    "여러 문서에 각자 다른 oldStr/newStr로 document_patch를 한 번에 적용한다(예: 여러 문서에 각각 다른 교차 참조 태그 삽입). 항목별 성공/실패 결과 배열을 반환(부분 성공 허용).",
    { items: z.array(documentPatchItemObject) },
    async (a) => call(`/api/documents/patch-batch`, { method: "POST", body: JSON.stringify({ items: a.items }) }),
  );
  tool(
    "document_transition",
    "문서 상태 전이",
    "정의된 전이 규칙에 따라 문서 상태를 바꾼다. 응답에 본문은 없음(전이는 본문을 안 건드림), updatedAt으로 변경 여부만 확인 - 본문이 필요하면 document_get/document_read/document_grep으로 이어서 조회.",
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
    "문서 우선순위(정수)를 설정/갱신한다 - 문서 상태가 review 또는 pending일 때만 가능(Q&A의 별개 pending 개념과는 무관). 응답에 본문은 없음(우선순위 설정은 본문을 안 건드림), updatedAt으로 변경 여부만 확인 - 본문이 필요하면 document_get/document_read/document_grep으로 이어서 조회.",
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
  tool(
    "document_backlinks",
    "역참조 조회",
    "이 문서를 링크한 다른 문서 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { trackingCode: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/documents/${a.trackingCode}/backlinks`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/documents/${a.trackingCode}/backlinks/page?${qs}`);
    },
  );

  tool(
    "document_links_out",
    "정방향 링크 조회",
    "이 문서가 링크한 문서들을 순서대로 조회한다(report/여러 문서를 엮은 챕터 구조 확인용) - document_backlinks(역참조)의 정방향 짝.",
    { trackingCode: z.string() },
    async (a) => call(`/api/documents/${a.trackingCode}/links`),
  );
  tool(
    "document_unlink",
    "문서 링크 제거",
    "한 문서에서 다른 문서로의 링크를 제거한다. 같은 대상으로의 링크가 여러 개(서로 다른 linkType)면 linkType으로 특정해야 한다.",
    { fromTrackingCode: z.string(), toTrackingCode: z.string(), linkType: z.string().optional() },
    async (a) => {
      const qs = a.linkType ? `?linkType=${encodeURIComponent(String(a.linkType))}` : "";
      return call(`/api/documents/${a.fromTrackingCode}/links/${a.toTrackingCode}${qs}`, { method: "DELETE" });
    },
  );
  tool(
    "document_links_reorder",
    "문서 링크 순서 변경",
    "이 문서가 링크한 문서들의 순서를 바꾼다 - orderedTrackingCodes는 현재 링크 대상 집합과 정확히 같은 순열이어야 한다(누락/추가 불가).",
    { trackingCode: z.string(), orderedTrackingCodes: z.array(z.string()) },
    async (a) =>
      call(`/api/documents/${a.trackingCode}/links/reorder`, {
        method: "PUT",
        body: JSON.stringify({ orderedTrackingCodes: a.orderedTrackingCodes }),
      }),
  );
  tool(
    "document_graph",
    "프로젝트 문서 관계 그래프",
    "이 프로젝트의 문서 간 링크(DocumentLink) 전체를 그래프(nodes/edges)로 반환한다 - 웹 UI '문서' 탭의 '문서간 관계' 서브탭이 쓰는 것과 같은 데이터.",
    { projectId: z.string() },
    async (a) => call(`/api/projects/${a.projectId}/document-graph`),
  );
  tool(
    "document_revisions",
    "버전 이력 조회",
    "문서의 수정 이력(리비전) 목록 - 각 항목은 그 시점까지의 본문 스냅샷. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { trackingCode: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/documents/${a.trackingCode}/revisions`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/documents/${a.trackingCode}/revisions/page?${qs}`);
    },
  );
  tool(
    "document_read",
    "문서 부분 읽기",
    "문서 본문을 줄 단위로 부분 읽기(큰 문서를 전체로 안 올리고 필요한 범위만) - 둘 다 생략하면 처음 2000줄.",
    { trackingCode: z.string(), offset: z.number().int().optional(), limit: z.number().int().optional() },
    async (a) => {
      const qs = new URLSearchParams();
      if (a.offset !== undefined) qs.set("offset", String(a.offset));
      if (a.limit !== undefined) qs.set("limit", String(a.limit));
      return call(`/api/documents/${a.trackingCode}/lines${qs.toString() ? `?${qs}` : ""}`);
    },
  );
  tool(
    "document_grep",
    "문서 본문 검색",
    "문서 본문을 정규식(POSIX ERE)으로 줄 단위 검색 - 매치된 줄 번호+텍스트 배열, 패턴이 잘못되면 에러.",
    {
      trackingCode: z.string(),
      pattern: z.string(),
      caseInsensitive: z.boolean().optional(),
      context: z.number().int().optional(),
    },
    async (a) => {
      const qs = new URLSearchParams({ q: String(a.pattern) });
      if (a.caseInsensitive) qs.set("caseInsensitive", "true");
      if (a.context !== undefined) qs.set("context", String(a.context));
      return call(`/api/documents/${a.trackingCode}/grep?${qs}`);
    },
  );
  tool(
    "document_diff",
    "문서 버전 비교",
    "두 시점의 본문을 줄 단위로 비교한다 - from/to는 document_revisions의 리비전 id 또는 리터럴 \"current\"(지금 본문). to 생략 시 current.",
    { trackingCode: z.string(), from: z.string(), to: z.string().optional() },
    async (a) => {
      const qs = new URLSearchParams({ from: String(a.from), ...(a.to ? { to: String(a.to) } : {}) });
      return call(`/api/documents/${a.trackingCode}/diff?${qs}`);
    },
  );
  tool(
    "chapter_list",
    "문서 챕터 목록",
    "문서 본문을 마크다운 헤딩(#~######) 단위 챕터로 분해한 목록(번호/레벨/제목/줄 범위) - 본문 없이 목차만. 긴 문서를 전체로 안 읽고/안 덮어써도 되게 하는 챕터 CRUD 툴킷의 조회 진입점.",
    { trackingCode: z.string() },
    async (a) => call(`/api/documents/${a.trackingCode}/chapters`),
  );
  tool(
    "chapter_get",
    "문서 챕터 조회",
    "특정 챕터의 내용만 조회한다(하위 헤딩 포함) - ordinal은 chapter_list가 돌려준 1-based 번호.",
    { trackingCode: z.string(), ordinal: z.number().int() },
    async (a) => call(`/api/documents/${a.trackingCode}/chapters/${a.ordinal}`),
  );
  tool(
    "chapter_set",
    "문서 챕터 교체",
    "특정 챕터의 내용을 통째로 교체한다(content는 헤딩 줄 자체를 포함해야 함) - 응답에 본문 없음, 갱신된 챕터 목록만.",
    { trackingCode: z.string(), ordinal: z.number().int(), content: z.string() },
    async (a) =>
      call(`/api/documents/${a.trackingCode}/chapters/${a.ordinal}`, { method: "PUT", body: JSON.stringify({ content: a.content }) }),
  );
  tool(
    "chapter_add",
    "문서 챕터 삽입",
    "새 챕터를 삽입한다(content는 헤딩 줄 자체를 포함해야 함) - after/before/atStart/atEnd 중 정확히 하나 필요.",
    {
      trackingCode: z.string(),
      content: z.string(),
      after: z.number().int().optional(),
      before: z.number().int().optional(),
      atStart: z.boolean().optional(),
      atEnd: z.boolean().optional(),
    },
    async (a) => {
      const body: Record<string, unknown> = { content: a.content };
      if (a.after !== undefined) body.after = a.after;
      else if (a.before !== undefined) body.before = a.before;
      else if (a.atStart) body.atStart = true;
      else if (a.atEnd) body.atEnd = true;
      else throw new Error("after|before|atStart|atEnd 중 하나가 필요합니다");
      return call(`/api/documents/${a.trackingCode}/chapters`, { method: "POST", body: JSON.stringify(body) });
    },
  );
  tool(
    "chapter_delete",
    "문서 챕터 삭제",
    "챕터를 삭제한다(문서에 챕터가 하나뿐이면 거부).",
    { trackingCode: z.string(), ordinal: z.number().int() },
    async (a) => call(`/api/documents/${a.trackingCode}/chapters/${a.ordinal}`, { method: "DELETE" }),
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

  // 연관된 소스코드

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
    "이 문서와 연관된 소스코드 파일 경로 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { trackingCode: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/documents/${a.trackingCode}/source-links`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/documents/${a.trackingCode}/source-links/page?${qs}`);
    },
  );

  tool(
    "document_link_branch",
    "브랜치 링크 추가",
    "이 문서와 연관된 git 브랜치를 연결한다(브랜치가 나중에 삭제돼도 이 연결은 유지된다 - 역사적 기록).",
    { trackingCode: z.string(), branchName: z.string() },
    async (a) =>
      call(`/api/documents/${a.trackingCode}/branch-links`, {
        method: "POST",
        body: JSON.stringify({ branchName: a.branchName }),
      }),
  );
  tool(
    "document_unlink_branch",
    "브랜치 링크 제거",
    "연결된 브랜치 링크를 제거한다.",
    { trackingCode: z.string(), linkId: z.string() },
    async (a) =>
      call(`/api/document-branch-links/${a.linkId}?trackingCode=${encodeURIComponent(a.trackingCode as string)}`, {
        method: "DELETE",
      }),
  );
  tool(
    "document_branch_links",
    "연관된 브랜치 목록",
    "이 문서와 연관된 브랜치 목록. page/pageSize를 주면 페이지네이션 응답(total 포함), 생략하면 전체 배열.",
    { trackingCode: z.string(), page: z.number().optional(), pageSize: z.number().optional() },
    async (a) => {
      if (a.page === undefined && a.pageSize === undefined) return call(`/api/documents/${a.trackingCode}/branch-links`);
      const qs = new URLSearchParams({ page: String(a.page ?? 1), pageSize: String(a.pageSize ?? 20) });
      return call(`/api/documents/${a.trackingCode}/branch-links/page?${qs}`);
    },
  );
}
