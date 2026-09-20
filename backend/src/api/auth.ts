import { Router } from "express";
import { z } from "zod";
import { login, signup, AuthError } from "../core/auth";

// 인증(로그인/가입)은 명시적으로 /api/actions 밖에 둔다 - 그 엔드포인트는
// 이미 유효한 apiKey가 있어야 호출 가능한데, 로그인은 그 apiKey를
// 발급받는 절차라 같은 체계 안에 넣을 수 없다 (닭과 달걀 문제).
export const authRouter = Router();

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid request body" });
  }
  try {
    const result = await login(parsed.data.username, parsed.data.password);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    throw err;
  }
});

// 시스템 전체 가입은 누구나 할 수 있다 (프로젝트 참여는 별개, Admin 초대 필요).
authRouter.post("/signup", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid request body" });
  }
  try {
    const result = await signup(parsed.data.username, parsed.data.password);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthError) return res.status(409).json({ error: err.message });
    throw err;
  }
});
