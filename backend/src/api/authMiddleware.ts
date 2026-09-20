import type { NextFunction, Request, Response } from "express";
import { resolveApiKey } from "../core/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      architectId?: string;
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
  next();
}
