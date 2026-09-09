import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../core/auth.js";
import { getMembership, roleAtLeast, type Role } from "../core/projects.js";
import { runWithProjectRoot } from "@claude-native-workflow/tier2-backend/dist/core/paths.js";
import { projectDir } from "../core/workspace.js";

export interface AuthedRequest extends Request {
  user?: { id: string; username: string };
  projectRole?: string;
}

/** `Authorization: Bearer <access_token>` 검증(SP-00002 2절 "이후 모든 API
 * 호출은 Authorization: Bearer <access_token> 헤더 필요"). */
export function authenticate(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "인증이 필요합니다" });
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch {
    res.status(401).json({ error: "유효하지 않거나 만료된 토큰입니다" });
  }
}

/** SP-00002 3절 role 표. `:projectId` 경로 파라미터가 있는 라우트에서
 * `authenticate` 다음에 붙인다. */
export function requireProjectRole(minRole: Role) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const projectId = req.params.projectId;
    const membership = await getMembership(projectId, req.user!.id);
    if (!membership || !roleAtLeast(membership.role, minRole)) {
      res.status(membership ? 403 : 404).json({ error: membership ? "권한이 없습니다" : "프로젝트를 찾을 수 없습니다" });
      return;
    }
    req.projectRole = membership.role;
    next();
  };
}

/** 이 미들웨어 이후의 나머지 요청 처리(비동기 체인 전체)를 이 프로젝트의
 * 로컬 체크아웃 경로로 스코프한다 - tier2-backend의 core/ 함수들은
 * getProjectRoot()/docsDir()만 호출하므로 아무 것도 안 바꿔도 그대로
 * 이 프로젝트만 본다(PL-00001 3단계 착수 시 AsyncLocalStorage로 고친
 * 부분). 동시에 다른 프로젝트 요청이 인터리빙돼도 서로 안 섞인다. */
export function withProjectRoot() {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    runWithProjectRoot(projectDir(req.params.projectId), () => next());
  };
}
