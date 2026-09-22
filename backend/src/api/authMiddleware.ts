import type { NextFunction, Request, Response } from "express";
import { resolveApiKey } from "../core/auth";
import type { KeyScope } from "../core/requestScope";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      architectId?: string;
      // docs/plan-nickname-apikey-policy.md - project 스코프 키로 인증된
      // 요청인지 여기서 한 번만 판별해두고, 실제 핸들러 실행은
      // requestScope.ts의 runWithKeyScope()로 감싸 core/*.ts 전체(특히
      // membership.ts의 requireMembership)에 전파한다.
      keyScope?: KeyScope;
      // 설계자 지적(2026-09-22 후속) - 같은 계정을 쓰는 여러 에이전트를
      // 구별하려면 "어떤 API 키로 인증됐는지"가 이미 그 답이다(라벨을
      // 붙여 키를 따로 발급하면 됨) - 별도 헤더가 필요 없다.
      apiKeyId?: string;
      apiKeyLabel?: string | null;
    }
  }
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const [scheme, rawKey] = header.split(" ");
  if (scheme !== "Bearer" || !rawKey) {
    return res.status(401).json({ error: "missing bearer apiKey" });
  }

  const resolved = await resolveApiKey(rawKey);
  if (!resolved) {
    return res.status(401).json({ error: "invalid apiKey" });
  }

  req.architectId = resolved.architectId;
  req.keyScope = resolved.scope;
  req.apiKeyId = resolved.apiKeyId;
  req.apiKeyLabel = resolved.apiKeyLabel;
  next();
}
