// 배치 2n(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) - 세션/동시
// 작업 등록(SP-976DD4ED, #multi-session-workclaim). cli/index.ts에서
// 그대로 잘라낸 것 - 로직은 전혀 안 바뀜. 계정 전체 스코프 - 같은
// 계정으로 여러 Claude 세션을 동시에 띄울 때 서로를 구분하고
// (X-Session-Id 헤더는 apiFetch()가 이미 자동으로 붙임, 이 명령들은
// 새 인자를 요구하지 않음) "지금 뭘 작업 중인지"를 광고판처럼 등록해
// 다른 세션에 알린다 - 락이 아니라 경고용(WorkClaim이 있어도 실제
// 저장/전이는 그대로 진행되고, 관련 mutation 응답의 notices에 경고만
// 뜬다). session(세션 자체)과 work(WorkClaim)는 밀접히 연관돼 한
// 파일에 같이 둔다.
import type { Command } from "commander";
import { apiCall } from "../apiclient.js";
import { printJson, run } from "../shared.js";

export function registerSessionCommands(program: Command): void {
  const sessionCmd = program.command("session").description("같은 계정의 다른 Claude 세션 목록/이름(SP-976DD4ED)");
  sessionCmd
    .command("list")
    .option("--minutes <n>", "최근 이 분(minute) 안에 활동한 세션만(생략하면 전체)")
    .description("내 계정의 세션 목록 - 이름/클라이언트 종류/마지막 활동 시각")
    .action((opts) => {
      const qs = opts.minutes ? `?minutes=${encodeURIComponent(opts.minutes)}` : "";
      return run(async () => printJson(await apiCall(`/api/sessions${qs}`)));
    });
  sessionCmd
    .command("rename <sessionId> <name>")
    .description("내 세션(본인 소유만) 이름을 바꾼다 - 다른 세션 이름은 못 바꿈")
    .action((sessionId, name) =>
      run(async () => printJson(await apiCall(`/api/sessions/${sessionId}/name`, { method: "PUT", body: JSON.stringify({ name }) }))),
    );
  sessionCmd
    .command("project <projectId>")
    .option("--page <n>", "페이지 번호(1부터, 기본 1)")
    .option("--count <n>", "페이지당 개수(기본 20)")
    .description("이 프로젝트에서 활동한 적 있는 세션들 - 어떤 설계자의 어떤 세션인지, 최근 활동순")
    .action((projectId, opts) => {
      const qs = new URLSearchParams({ page: opts.page ?? "1", pageSize: opts.count ?? "20" });
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/sessions/page?${qs}`)));
    });

  const workCmd = program.command("work").description("현재 작업 중인 대상 등록(WorkClaim) - 락 아님, 경고용(SP-976DD4ED)");
  workCmd
    .command("claim <projectId> <targetType> <targetKey>")
    .description("targetType: document|plan|sourceFile - 이 대상을 지금 작업 중이라고 등록(명시적으로 부를 때만 생김)")
    .action((projectId, targetType, targetKey) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/work-claims`, { method: "POST", body: JSON.stringify({ targetType, targetKey }) }),
        ),
      ),
    );
  workCmd
    .command("release <projectId> <targetType> <targetKey>")
    .description("claim 해제(작업이 끝났거나 더 이상 유효하지 않을 때)")
    .action((projectId, targetType, targetKey) =>
      run(async () =>
        printJson(
          await apiCall(`/api/projects/${projectId}/work-claims`, { method: "DELETE", body: JSON.stringify({ targetType, targetKey }) }),
        ),
      ),
    );
  workCmd
    .command("list <projectId>")
    .option("--minutes <n>", "이 분(minute) 안에 활동한 세션의 클레임만(기본 30분)")
    .description("이 프로젝트에서 지금 살아있는 세션들이 뭘 작업 중인지")
    .action((projectId, opts) => {
      const qs = opts.minutes ? `?minutes=${encodeURIComponent(opts.minutes)}` : "";
      return run(async () => printJson(await apiCall(`/api/projects/${projectId}/work-claims${qs}`)));
    });
}
