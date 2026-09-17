// 배치 2h(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 문서
// + 챕터(헤딩 섹션) CRUD + 연관된 소스코드 + 연관된 브랜치.
// cli/index.ts에서 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. 전부
// trackingCode 기준 문서 하위 자원이라 한 파일로 묶었다(#58의
// documentRoutes.ts와 같은 원칙). "delete"/"next-statuses"는 원래
// "챕터" 헤더 아래 물리적으로 위치했지만 실제로는 문서 자체의 동작
// (헤더/내용 불일치 - #58에서 반복 발견된 패턴과 동일).
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerDocumentCommands(program: Command): void {
  program
    .command("new <projectId> <docTypeCode>")
    .description("문서를 생성한다 - 응답에 본문은 없음(호출자가 이미 보낸 내용을 그대로 돌려주지 않음), updatedAt으로 생성 시각 확인, 본문이 필요하면 get/read/grep으로 이어서 조회한다")
    .requiredOption("--title <t>")
    .requiredOption("--body <file>", "본문 마크다운 파일 경로(로컬 스크래치 사본 - git 커밋 대상 아님)")
    .action((projectId, docTypeCode, opts) =>
      run(async () => {
        const body = fs.readFileSync(opts.body, "utf-8");
        printJson(
          await apiCall(`/api/projects/${projectId}/documents`, {
            method: "POST",
            body: JSON.stringify({ docTypeCode, title: opts.title, body }),
          }),
        );
      }),
    );

  program
    .command("get <trackingCode>")
    .description("문서 1건 조회(본문 포함) - 응답에 linksOut(이 문서가 링크한 문서)/backlinks(이 문서를 링크한 문서)로 연관 문서 추적코드도 함께 온다")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}`))));

  program
    .command("list <projectId>")
    .description("문서 색인 조회(본문 제외 - trackingCode/title/docTypeId/statusCode 등 요약만) - 본문이 필요하면 get/read/grep으로 이어서 조회한다")
    .option("--type <docTypeId>")
    .option("--status <code>", "draft/review/pending/approved/deprecated/archived 중 하나로 필터 - 예: 검토 대기 목록은 --status review")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열(최대 1000건)")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = new URLSearchParams({
          ...(opts.type ? { docTypeId: opts.type } : {}),
          ...(opts.status ? { statusCode: opts.status } : {}),
          ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
        });
        const suffix = paged ? "/page" : "";
        printJson(await apiCall(`/api/projects/${projectId}/documents${suffix}${qs.toString() ? `?${qs}` : ""}`));
      }),
    );

  program
    .command("search <projectId> <query>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 관련도 상위 50건")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .option("--lines <n>", "각 히트의 본문을 앞 n줄까지만 자른다(생략하면 전체 본문) - 실제로 잘렸으면 결과의 bodyTruncated:true로 표시")
    .option("--codes-only", "본문/메타 없이 trackingCode 배열만 반환(--lines보다 더 가벼움 - 코드만 필요할 때)")
    .action((projectId, query, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = new URLSearchParams({
          q: query,
          ...(paged ? { page: opts.page ?? "1", pageSize: opts.count ?? "20" } : {}),
          ...(opts.lines !== undefined ? { lines: opts.lines } : {}),
          ...(opts.codesOnly ? { codesOnly: "true" } : {}),
        });
        printJson(await apiCall(`/api/projects/${projectId}/search?${qs}`));
      }),
    );

  program
    .command("search-all <projectId> <query>")
    .description("문서(전문 검색)+계획(부분 일치)을 한 번에 훑는다 - 각 항목 kind(document|plan)/trackingCode/title/statusCode만 반환(본문 없음, 필요하면 get/plan get으로 이어서 조회)")
    .action((projectId, query) =>
      run(async () => printJson(await apiCall(`/api/projects/${projectId}/search-all?${new URLSearchParams({ q: query })}`))),
    );

  program
    .command("refs-status <trackingCode>")
    .description("이 문서/계획/칸반 카드 본문에 언급된 모든 추적 코드의 현재 title/status를 한 번에 모아 본다(\"완료된 계획이 아직 미구현으로 언급됨\" 같은 불일치 탐지용) - 대상을 못 찾은 코드는 title/status가 null로 표시됨")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/refs-status/${trackingCode}`))));

  program
    .command("save <trackingCode> <file>")
    .description("문서 본문을 덮어쓰고 버전 이력을 남긴다 - 응답에 본문은 없음(호출자가 이미 보낸 내용), updatedAt으로 저장 여부만 확인, 본문이 필요하면 get/read/grep으로 이어서 조회한다")
    .action((trackingCode, file) =>
      run(async () => {
        const body = fs.readFileSync(file, "utf-8");
        printJson(await apiCall(`/api/documents/${trackingCode}`, { method: "PUT", body: JSON.stringify({ body }) }));
      }),
    );

  program
    .command("patch <trackingCode> <oldStr> <newStr>")
    .description("문서 본문의 일부만 바꾼다(str_replace 방식) - oldStr이 본문에 정확히 한 번만 있을 때만 적용, 없거나 여러 번 있으면 아무것도 안 바꾸고 실패. 본문 전체를 다시 안 보내도 됨")
    .option("--replace-all", "일치하는 곳 전부를 바꾼다(기본은 정확히 1번만 허용)")
    .action((trackingCode, oldStr, newStr, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/documents/${trackingCode}/patch`, {
            method: "PUT",
            body: JSON.stringify({ oldStr, newStr, replaceAll: !!opts.replaceAll }),
          }),
        ),
      ),
    );

  program
    .command("patch-batch <file>")
    .description("로컬 JSON 파일(항목 배열: trackingCode/oldStr/newStr/replaceAll?)로 여러 문서를 한 번에 patch한다 - 항목별 성공/실패 반환(부분 성공 허용)")
    .action((file) =>
      run(async () => {
        const items = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
        printJson(await apiCall(`/api/documents/patch-batch`, { method: "POST", body: JSON.stringify({ items }) }));
      }),
    );

  program
    .command("transition <trackingCode> <toStatusCode>")
    .description("정의된 전이 규칙에 따라 문서 상태를 바꾼다 - 응답에 본문은 없음(전이는 본문을 안 건드림), updatedAt으로 변경 여부만 확인, 본문이 필요하면 get/read/grep으로 이어서 조회한다")
    .action((trackingCode, toStatusCode) =>
      run(async () =>
        printJson(
          await apiCall(`/api/documents/${trackingCode}/transition`, {
            method: "POST",
            body: JSON.stringify({ toStatusCode }),
          }),
        ),
      ),
    );

  program
    .command("transition-bulk <toStatusCode> <trackingCodes...>")
    .description("여러 문서를 한 번에 같은 상태로 전이한다 - 항목별 결과를 반환(일부만 실패해도 나머지는 계속 진행)")
    .action((toStatusCode, trackingCodes) =>
      run(async () =>
        printJson(
          await apiCall(`/api/documents/bulk-transition`, {
            method: "POST",
            body: JSON.stringify({ trackingCodes, toStatusCode }),
          }),
        ),
      ),
    );

  program
    .command("priority-set <trackingCode> <n>")
    .description("문서 우선순위(정수)를 설정/갱신한다 - 문서 상태가 review 또는 pending일 때만 가능. 응답에 본문은 없음(우선순위 설정은 본문을 안 건드림), updatedAt으로 변경 여부만 확인, 본문이 필요하면 get/read/grep으로 이어서 조회한다")
    .action((trackingCode, n) =>
      run(async () => {
        const priority = Number(n);
        if (!Number.isInteger(priority)) throw new Error("n은 정수여야 합니다");
        printJson(
          await apiCall(`/api/documents/${trackingCode}/priority`, {
            method: "PUT",
            body: JSON.stringify({ priority }),
          }),
        );
      }),
    );

  program
    .command("link <fromTrackingCode> <toTrackingCode>")
    .option("--type <linkType>")
    .action((from, to, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/documents/${from}/links`, {
            method: "POST",
            body: JSON.stringify({ toTrackingCode: to, linkType: opts.type }),
          }),
        ),
      ),
    );

  program
    .command("backlinks <trackingCode>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((trackingCode, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/documents/${trackingCode}/backlinks${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("links-out <trackingCode>")
    .description("이 문서가 링크한 문서들을 순서대로 조회한다(report/여러 문서를 엮은 챕터 구조 확인용) - backlinks(역참조)의 정방향 짝")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/links`))));

  program
    .command("unlink <fromTrackingCode> <toTrackingCode>")
    .option("--type <linkType>", "같은 대상으로의 링크가 여러 개(서로 다른 linkType)일 때만 필요")
    .action((from, to, opts) =>
      run(async () => {
        const qs = opts.type ? `?linkType=${encodeURIComponent(opts.type)}` : "";
        printJson(await apiCall(`/api/documents/${from}/links/${to}${qs}`, { method: "DELETE" }));
      }),
    );

  program
    .command("links-reorder <trackingCode> <orderedTrackingCodes...>")
    .description("이 문서가 링크한 문서들의 순서를 바꾼다 - 현재 링크 대상 집합과 정확히 같은 순열이어야 한다(누락/추가 불가)")
    .action((trackingCode, orderedTrackingCodes) =>
      run(async () =>
        printJson(
          await apiCall(`/api/documents/${trackingCode}/links/reorder`, {
            method: "PUT",
            body: JSON.stringify({ orderedTrackingCodes }),
          }),
        ),
      ),
    );

  program
    .command("doc-graph <projectId>")
    .description("이 프로젝트의 문서 간 링크(DocumentLink) 전체를 그래프(nodes/edges)로 조회한다 - 웹 UI '문서간 관계' 서브탭이 쓰는 것과 같은 데이터")
    .action((projectId) => run(async () => printJson(await apiCall(`/api/projects/${projectId}/document-graph`))));

  program
    .command("revisions <trackingCode>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((trackingCode, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/documents/${trackingCode}/revisions${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("read <trackingCode>")
    .description("문서 본문을 줄 단위로 부분 읽기(큰 문서를 전체로 안 올리고 필요한 범위만) - 둘 다 생략하면 처음 2000줄")
    .option("--offset <n>", "시작 줄 번호(1부터)")
    .option("--limit <n>", "최대 줄 수")
    .action((trackingCode, opts) =>
      run(async () => {
        const qs = new URLSearchParams();
        if (opts.offset !== undefined) qs.set("offset", opts.offset);
        if (opts.limit !== undefined) qs.set("limit", opts.limit);
        printJson(await apiCall(`/api/documents/${trackingCode}/lines${qs.toString() ? `?${qs}` : ""}`));
      }),
    );

  program
    .command("grep <trackingCode> <pattern>")
    .description("문서 본문을 정규식(POSIX ERE)으로 줄 단위 검색 - 매치된 줄 번호+텍스트 배열, 패턴이 잘못되면 에러")
    .option("--case-insensitive", "대소문자 구분 안 함")
    .option("--context <n>", "매치된 줄 앞뒤로 n줄씩 더 포함(grep -C와 동일)")
    .action((trackingCode, pattern, opts) =>
      run(async () => {
        const qs = new URLSearchParams({ q: pattern });
        if (opts.caseInsensitive) qs.set("caseInsensitive", "true");
        if (opts.context !== undefined) qs.set("context", opts.context);
        printJson(await apiCall(`/api/documents/${trackingCode}/grep?${qs}`));
      }),
    );

  program
    .command("diff <trackingCode> <from> [to]")
    .description("두 시점의 본문을 줄 단위로 비교 - from/to는 `docs revisions`의 리비전 id 또는 리터럴 \"current\"(지금 본문). to 생략 시 current")
    .action((trackingCode, from, to) =>
      run(async () => {
        const qs = new URLSearchParams({ from, ...(to ? { to } : {}) });
        printJson(await apiCall(`/api/documents/${trackingCode}/diff?${qs}`));
      }),
    );

  // 챕터(헤딩 섹션) CRUD - 긴 문서를 매번 전체 본문으로 안 읽고/안
  // 덮어써도 되도록 - 챕터는 마크다운 헤딩(#~######) 하나 + 그 하위
  // 헤딩들의 내용까지를 가리키고, 번호(ordinal)는 매번 본문에서 새로
  // 계산되는 1-based 순번이다(제목 텍스트가 아님 - 중복 제목이 있어도
  // 항상 명확).
  const chapterCmd = program.command("chapter").description("문서 본문의 섹션(헤딩) 단위 CRUD - 긴 문서를 전체로 안 읽고/안 덮어써도 되게");

  chapterCmd
    .command("list <trackingCode>")
    .description("챕터 목록(번호/레벨/제목/줄 범위) - 본문 없이 목차만")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/chapters`))));

  chapterCmd
    .command("get <trackingCode> <ordinal>")
    .description("특정 챕터의 내용만 조회(하위 헤딩 포함)")
    .action((trackingCode, ordinal) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/chapters/${ordinal}`))));

  chapterCmd
    .command("set <trackingCode> <ordinal> <file>")
    .description("특정 챕터의 내용을 로컬 파일 내용으로 통째로 교체(파일은 헤딩 줄 자체를 포함해야 함) - 응답에 본문 없음, 갱신된 챕터 목록만")
    .action((trackingCode, ordinal, file) =>
      run(async () => {
        const content = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
        printJson(
          await apiCall(`/api/documents/${trackingCode}/chapters/${ordinal}`, { method: "PUT", body: JSON.stringify({ content }) }),
        );
      }),
    );

  chapterCmd
    .command("add <trackingCode> <file>")
    .description("새 챕터를 삽입(파일은 헤딩 줄 자체를 포함해야 함) - after/before/at-start/at-end 중 정확히 하나 필요")
    .option("--after <ordinal>", "이 챕터 번호 바로 뒤에 삽입")
    .option("--before <ordinal>", "이 챕터 번호 바로 앞에 삽입")
    .option("--at-start", "문서 맨 앞에 삽입")
    .option("--at-end", "문서 맨 끝에 삽입")
    .action((trackingCode, file, opts) =>
      run(async () => {
        const content = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
        const body: Record<string, unknown> = { content };
        if (opts.after !== undefined) body.after = Number(opts.after);
        else if (opts.before !== undefined) body.before = Number(opts.before);
        else if (opts.atStart) body.atStart = true;
        else if (opts.atEnd) body.atEnd = true;
        else throw new Error("--after|--before|--at-start|--at-end 중 하나가 필요합니다");
        printJson(await apiCall(`/api/documents/${trackingCode}/chapters`, { method: "POST", body: JSON.stringify(body) }));
      }),
    );

  chapterCmd
    .command("delete <trackingCode> <ordinal>")
    .description("챕터를 삭제한다(문서에 챕터가 하나뿐이면 거부)")
    .action((trackingCode, ordinal) =>
      run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/chapters/${ordinal}`, { method: "DELETE" }))),
    );

  program
    .command("delete <trackingCode>")
    .description("문서를 삭제한다(리비전/링크/코멘트/질문+답변까지 함께 정리)")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}`, { method: "DELETE" }))));

  program
    .command("next-statuses <trackingCode>")
    .description("이 문서에서 지금 선택 가능한 다음 상태 목록(코드/라벨/지침)")
    .action((trackingCode) => run(async () => printJson(await apiCall(`/api/documents/${trackingCode}/next-statuses`))));

  // 연관된 소스코드

  program
    .command("link-source <trackingCode> <path>")
    .description("이 문서와 연관된 소스코드 파일 경로를 연결한다(git 저장소 루트 기준 상대 경로)")
    .action((trackingCode, path) =>
      run(async () =>
        printJson(
          await apiCall(`/api/documents/${trackingCode}/source-links`, {
            method: "POST",
            body: JSON.stringify({ filePath: path }),
          }),
        ),
      ),
    );

  program
    .command("unlink-source <trackingCode> <linkId>")
    .description("연결된 소스코드 링크를 제거한다")
    .action((trackingCode, linkId) =>
      run(async () =>
        printJson(
          await apiCall(`/api/document-source-links/${linkId}?trackingCode=${encodeURIComponent(trackingCode)}`, {
            method: "DELETE",
          }),
        ),
      ),
    );

  program
    .command("source-links <trackingCode>")
    .description("이 문서와 연관된 소스코드 파일 경로 목록")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((trackingCode, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/documents/${trackingCode}/source-links${paged ? "/page" : ""}${qs}`));
      }),
    );

  // 연관된 브랜치

  program
    .command("link-branch <trackingCode> <branchName>")
    .description("이 문서와 연관된 git 브랜치를 연결한다(브랜치가 나중에 삭제돼도 이 연결은 유지됨)")
    .action((trackingCode, branchName) =>
      run(async () =>
        printJson(
          await apiCall(`/api/documents/${trackingCode}/branch-links`, {
            method: "POST",
            body: JSON.stringify({ branchName }),
          }),
        ),
      ),
    );

  program
    .command("unlink-branch <trackingCode> <linkId>")
    .description("연결된 브랜치 링크를 제거한다")
    .action((trackingCode, linkId) =>
      run(async () =>
        printJson(
          await apiCall(`/api/document-branch-links/${linkId}?trackingCode=${encodeURIComponent(trackingCode)}`, {
            method: "DELETE",
          }),
        ),
      ),
    );

  program
    .command("branch-links <trackingCode>")
    .description("이 문서와 연관된 브랜치 목록")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((trackingCode, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/documents/${trackingCode}/branch-links${paged ? "/page" : ""}${qs}`));
      }),
    );
}
