// 배치 2k(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 질의/
// 답변(pending/reply) + 대시보드/활동 이력. cli/index.ts에서 그대로
// 잘라낸 것 - 로직은 전혀 안 바뀜. dashboard/activity는 물리적으로
// "질의/답변" 헤더 아래 있었지만 실제로는 프로젝트 요약 명령(헤더/
// 내용 불일치 - #58에서 반복 발견된 패턴과 동일) - 그대로 같은
// 파일에 유지(굳이 분리할 만큼 크지 않음).
//
// targetType/targetKey로 다형화됨(document/source/kanbanCard) - document/
// kanbanCard 대상은 그 자신의 트래킹 코드만으로 서버가 대상 종류를
// 자동 판별하므로(resolveTargetByTrackingCode) 기존 2-인자 시그니처를
// 그대로 쓴다. source 대상은 트래킹 코드가 없어 별도 명령이 필요하다.
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run, parseChoices } from "../shared.js";

export function registerQuestionCommands(program: Command): void {
  program
    .command("question <trackingCode> <text...>")
    .option("--kind <approval|answer>", "승인 요청 또는 답변 요청(기본: answer)")
    .option("--refs <codes>", "판단에 참고한 문서 trackingCode 목록(쉼표로 구분)")
    .option(
      "--choices <options>",
      "제안 선택지 목록 - 선택지끼리는 ;;로, 한 선택지 안 라벨/부가정보는 :::로 구분(예: \"A:::설명A;;B:::설명B\")",
    )
    .action((trackingCode, textParts, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/questions`, {
            method: "POST",
            body: JSON.stringify({
              trackingCode,
              kind: opts.kind ?? "answer",
              text: textParts.join(" "),
              refs: opts.refs ? String(opts.refs).split(",").map((s: string) => s.trim()) : undefined,
              options: parseChoices(opts.choices),
            }),
          }),
        ),
      ),
    );

  program
    .command("question-source <projectId> <path> <text...>")
    .description("소스 코드 파일에 AI 질문을 남긴다(문서/칸반 카드가 아닌 대상)")
    .option("--kind <approval|answer>", "승인 요청 또는 답변 요청(기본: answer)")
    .option("--refs <codes>", "판단에 참고한 문서 trackingCode 목록(쉼표로 구분)")
    .option(
      "--choices <options>",
      "제안 선택지 목록 - 선택지끼리는 ;;로, 한 선택지 안 라벨/부가정보는 :::로 구분(예: \"A:::설명A;;B:::설명B\")",
    )
    .action((projectId, path, textParts, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/questions/source`, {
            method: "POST",
            body: JSON.stringify({
              path,
              kind: opts.kind ?? "answer",
              text: textParts.join(" "),
              refs: opts.refs ? String(opts.refs).split(",").map((s: string) => s.trim()) : undefined,
              options: parseChoices(opts.choices),
            }),
          }),
        ),
      ),
    );

  program
    .command("questions <trackingCode>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .option("--status <s>", "open|pending|resolved|withdrawn|active|all(기본 active - 이미 처리된(resolved/withdrawn) 질의는 빼고 아직 처리 안 끝난 것만)")
    .action((trackingCode, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        if (paged) {
          const qs = new URLSearchParams({ trackingCode, page: opts.page ?? "1", pageSize: opts.count ?? "20", ...(opts.status ? { status: opts.status } : {}) });
          printJson(await apiCall(`/api/questions/page?${qs}`));
          return;
        }
        const qs = new URLSearchParams({ trackingCode, ...(opts.status ? { status: opts.status } : {}) });
        printJson(await apiCall(`/api/questions?${qs}`));
      }),
    );

  program
    .command("questions-source <projectId> <path>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .option("--status <s>", "open|pending|resolved|withdrawn|active|all(기본 active - 이미 처리된(resolved/withdrawn) 질의는 빼고 아직 처리 안 끝난 것만)")
    .action((projectId, path, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        if (paged) {
          const qs = new URLSearchParams({ path, page: opts.page ?? "1", pageSize: opts.count ?? "20", ...(opts.status ? { status: opts.status } : {}) });
          printJson(await apiCall(`/api/projects/${projectId}/questions/source/page?${qs}`));
          return;
        }
        const qs = new URLSearchParams({ path, ...(opts.status ? { status: opts.status } : {}) });
        printJson(await apiCall(`/api/projects/${projectId}/questions/source?${qs}`));
      }),
    );

  program
    .command("question-ack <trackingCode>")
    .description("설계자가 답변한(pending) 질의를 확인 완료(resolved)로 표시")
    .action((trackingCode) =>
      run(async () => printJson(await apiCall(`/api/questions/${trackingCode}/ack`, { method: "POST" }))),
    );

  program
    .command("question-ack-bulk <trackingCodes...>")
    .description("여러 pending 질의를 한 번에 확인 완료로 표시 - 항목별 결과를 반환(일부만 실패해도 나머지는 계속 진행)")
    .action((trackingCodes) =>
      run(async () =>
        printJson(await apiCall(`/api/questions/bulk-ack`, { method: "POST", body: JSON.stringify({ trackingCodes }) })),
      ),
    );

  program
    .command("question-withdraw <trackingCode>")
    .description("본인이 등록한 질문 중 아직 답변되지 않은(open) 것을 철회한다")
    .action((trackingCode) =>
      run(async () => printJson(await apiCall(`/api/questions/${trackingCode}/withdraw`, { method: "POST" }))),
    );

  program
    .command("pending <projectId>")
    .option("--page <n>", "페이지 번호(1부터) - --count와 함께 줘야 페이지네이션 응답(total 포함)을 받는다, 생략하면 기존처럼 전체 배열")
    .option("--count <n>", "페이지당 개수(--page와 함께)")
    .action((projectId, opts) =>
      run(async () => {
        const paged = opts.page !== undefined || opts.count !== undefined;
        const qs = paged ? `?page=${opts.page ?? "1"}&pageSize=${opts.count ?? "20"}` : "";
        printJson(await apiCall(`/api/projects/${projectId}/pending${paged ? "/page" : ""}${qs}`));
      }),
    );

  program
    .command("dashboard <projectId>")
    .description(
      "프로젝트 진행 상황 요약(문서 상태 분포+정체 문서, 미답변 Q&A, 처리 안 된 메시지, 칸반 컬럼별 카드 수, 최근 활동) - 웹 홈 화면과 같은 데이터",
    )
    .option("--stale-days <n>", "며칠 이상 안 바뀌면 '정체 문서'로 볼지(기본 14)")
    .action((projectId, opts) =>
      run(async () => {
        const qs = opts.staleDays !== undefined ? `?staleDays=${opts.staleDays}` : "";
        printJson(await apiCall(`/api/projects/${projectId}/dashboard${qs}`));
      }),
    );

  program
    .command("activity <projectId>")
    .description("프로젝트 최근 활동 전체 목록(문서 생성/수정, 질의, 답변, 코멘트, 메시지, 칸반 카드 생성) - 대시보드의 최근 활동(20건 고정) 더보기용, 기본 100건")
    .option("--limit <n>", "최대 건수(기본 100)")
    .action((projectId, opts) =>
      run(async () => {
        const qs = opts.limit !== undefined ? `?limit=${opts.limit}` : "";
        printJson(await apiCall(`/api/projects/${projectId}/activity${qs}`));
      }),
    );

  program
    .command("reply <questionTrackingCode> [answer...]")
    .description("답변 요청(kind=answer)은 answer 텍스트로 답한다. 승인 요청(kind=approval)은 --decision으로 승인/거부를 확정하거나(answer 텍스트를 메모로 같이 붙일 수 있음), 아직 결정하기 전이면 --decision 없이 answer 텍스트만으로도 답할 수 있다(둘 중 최소 하나 필요)")
    .option("--decision <approved|rejected>", "승인 요청에 대한 결정")
    .action((questionTrackingCode, answerParts, opts) =>
      run(async () =>
        printJson(
          await apiCall(`/api/questions/${questionTrackingCode}/answer`, {
            method: "POST",
            body: JSON.stringify({
              body: answerParts && answerParts.length > 0 ? answerParts.join(" ") : undefined,
              decision: opts.decision,
            }),
          }),
        ),
      ),
    );

  // 코멘트는 설계자들끼리만 쓰는 채널이다(웹 UI 전용) - AI의 참고 지표가
  // 될 수 없어 CLI/MCP엔 의도적으로 명령/도구를 두지 않는다("CLI/MCP
  // 명령어 완전성" 원칙의 의도적 예외 - REST API/웹 UI는 그대로, 소스
  // 코드/칸반 카드 코멘트도 동일하게 없음).
}
