// 배치 2a(#cli-mcp-domain-split, BL-57F8DF17 #63, PN-284C73F0) -
// 인증(진단용)/프로필/사용자. mcp/server.ts에서 그대로 잘라낸 것 -
// 로직은 전혀 안 바뀜. auth register/login/logout은 CLI 전용이라
// 도구로 없음(비밀번호가 대화 컨텍스트에 남는 걸 피하려는 의도적
// 예외 - server.ts 상단 주석 참고).
import { z } from "zod";
import { loadCredentials } from "../../cli/apiclient.js";
import { call, type ToolRegistrar } from "../shared.js";

export function registerAuthTools(tool: ToolRegistrar): void {
  tool("auth_whoami", "로그인 상태 확인", "현재 로그인된 사용자 정보를 반환한다(로그인 자체는 CLI에서 `docs auth login`으로).", {}, async () => {
    const creds = loadCredentials();
    if (!creds) return { logged_in: false };
    return { logged_in: true, ...(await call<Record<string, unknown>>("/api/auth/me")) };
  });

  tool(
    "profile_set",
    "내 프로필 수정",
    "이메일/전화번호와 타인 공개 여부, 닉네임을 설정한다. 닉네임은 최근 변경 후 7일간 다시 바꿀 수 없다(값을 안 바꾸면 그대로 재저장 가능), 비우면 공통 라벨 '설계자'로 표시된다.",
    {
      email: z.string().optional(),
      phone: z.string().optional(),
      emailVisible: z.boolean().optional(),
      phoneVisible: z.boolean().optional(),
      nickname: z.string().optional(),
    },
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
}
