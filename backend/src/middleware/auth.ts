import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../core/auth.js";
import { getMemberRole, roleSatisfies } from "../core/members.js";

export interface AuthedRequest extends Request {
  userId?: string;
  username?: string;
}

export function authenticate(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization 헤더(Bearer 토큰)가 필요합니다" });
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    req.userId = payload.sub;
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: "유효하지 않거나 만료된 토큰입니다" });
  }
}

/** 프로젝트 라우트에 건다 - :projectId 경로 파라미터 기준으로 role을
 * 검사한다(옛 concept tier3의 requireProjectRole()과 같은 패턴). */
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
