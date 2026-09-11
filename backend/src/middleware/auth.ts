import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, isSuperAdmin } from "../core/auth.js";
import { getMemberRole, roleSatisfies } from "../core/members.js";
import { verifyApiKeySecret, API_KEY_PREFIX } from "../core/apiKeys.js";
import { runWithKeyScope, getActiveKeyScope, type KeyScope } from "../core/requestScope.js";

export interface AuthedRequest extends Request {
  userId?: string;
  username?: string;
}

/** Bearer 토큰이 API 키 포맷(cnwk_...)이면 해시 조회로 검증하고, 그
 * 요청 전체를 그 키의 스코프(core/requestScope.ts) 안에서 실행한다 -
 * 아니면 지금까지처럼 JWT로 검증하고 스코프는 항상 unrestricted.
 * 이 한 곳만 바뀌면 이후 요청 안에서 실행되는 모든 권한 판정 함수가
 * req를 안 받고도 스코프를 자동으로 적용받는다(core/members.ts의
 * isProjectAllowedByActiveScope 등이 그 스코프를 읽음). */
export async function authenticate(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization 헤더(Bearer 토큰)가 필요합니다" });
    return;
  }
  const token = header.slice("Bearer ".length);

  if (token.startsWith(API_KEY_PREFIX)) {
    try {
      const result = await verifyApiKeySecret(token);
      if (!result) {
        res.status(401).json({ error: "유효하지 않거나 배제·만료된 API 키입니다" });
        return;
      }
      req.userId = result.userId;
      // admin 계정은 스코프가 좁혀진 API 키를 쓰더라도 그 스코프를
      // 무시하고 전체 접근을 허용한다(설계자 확정 - 최고 관리자는
      // 완전 우회). unrestricted로 치환하는 것만으로 이 요청 안에서
      // 실행되는 모든 스코프 판정 함수가 자동으로 통과한다.
      const scope: KeyScope = (await isSuperAdmin(result.userId)) ? { type: "unrestricted" } : result.scope;
      runWithKeyScope(scope, next);
    } catch {
      res.status(401).json({ error: "유효하지 않거나 배제·만료된 API 키입니다" });
    }
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    req.username = payload.username;
    runWithKeyScope({ type: "unrestricted" }, next);
  } catch {
    res.status(401).json({ error: "유효하지 않거나 만료된 토큰입니다" });
  }
}

/** 프로젝트 라우트에 건다 - :projectId 경로 파라미터 기준으로 role을
 * 검사한다(옛 concept tier3의 requireProjectRole()과 같은 패턴).
 * getMemberRole() 자신이 이미 활성 API 키 스코프를 확인하므로, 이
 * 미들웨어는 스코프를 따로 신경 쓸 필요가 없다(자동으로 적용됨). */
export function requireProjectRole(minRole: "viewer" | "editor" | "owner") {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const projectId = req.params.projectId;
    if (!projectId) {
      res.status(400).json({ error: "projectId 경로 파라미터가 필요합니다" });
      return;
    }
    const role = await getMemberRole(projectId, req.userId!);
    if (!roleSatisfies(role, minRole)) {
      res.status(403).json({ error: `이 작업은 최소 ${minRole} 권한이 필요합니다` });
      return;
    }
    next();
  };
}

/** 프로젝트/팀에 매이지 않는 "신원 자체"를 다루는 라우트(본인 프로필
 * 수정, git 자격증명, 팀/그룹/프로젝트 생성, API 키 관리 자체)에 건다 -
 * "project"/"team" 스코프로 좁혀진 키로는 이 동작들을 할 수 없다(좁은
 * 키가 유출돼도 그걸로 더 넓은 키를 새로 만들거나 신원 정보를 바꿀 수
 * 없어야 하는 방어적 설계 - 반드시 로그인 또는 "개인 키"여야 한다). */
export function requireUnrestrictedScope(req: AuthedRequest, res: Response, next: NextFunction): void {
  const scope = getActiveKeyScope();
  if (scope.type !== "unrestricted") {
    res.status(403).json({ error: "이 작업은 범위가 제한된 API 키로는 할 수 없습니다 - 로그인 또는 개인 키로 시도하세요" });
    return;
  }
  next();
}
