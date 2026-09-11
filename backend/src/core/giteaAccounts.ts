// Gitea 사용자 계정 마스터링 - 이 시스템의 User 계정은 Gitea에도 항상
// 유효한 계정으로 그대로 이어진다(설계자 확인 - "이 시스템이 master").
// 비밀번호는 사람이 정하지 않고 시스템이 "토큰"처럼 발급해 암호화
// 보관한다(core/crypto.ts의 encryptSecret() 재사용) - 이 계정으로 사람이
// 직접 Gitea에 로그인하는 경로는 없다, 이 백엔드가 필요할 때 그 설계자
// 신원을 내부적으로 대행하기 위한 자격증명일 뿐이다.
//
// 이 모듈은 발급·보관까지만 한다 - 저장소 소유권을 공유 admin 계정에서
// 각 설계자 계정으로 옮기는 것은 이번 범위 밖(더 큰 변경).

import crypto from "node:crypto";
import { getDb } from "./db.js";
import * as gitea from "./gitea.js";
import { encryptSecret } from "./crypto.js";

const MAX_USERNAME_LEN = 40; // Gitea 사용자명 길이 제한에 여유를 둔 값

function normalizeUsername(raw: string): string {
  let name = raw.replace(/[^a-zA-Z0-9_.-]/g, "");
  name = name.replace(/^[-_.]+/, "").replace(/[-_.]+$/, "");
  if (!name) name = "user";
  return name.slice(0, MAX_USERNAME_LEN);
}

/** base가 비어 있을 때까지 숫자 접미사를 늘려가며 Gitea에서 아직 안
 * 쓰이는 이름을 찾는다(닉네임 넘버링과 달리 그냥 "안 겹치는 값"을
 * 찾는 단순 충돌 회피 - Gitea 쪽은 유일해야 하는 실제 로그인 아이디). */
async function findAvailableUsername(base: string): Promise<string> {
  if (!(await gitea.giteaUserExists(base))) return base;
  let suffix = 2;
  for (;;) {
    const suffixStr = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_USERNAME_LEN - suffixStr.length)}${suffixStr}`;
    if (!(await gitea.giteaUserExists(candidate))) return candidate;
    suffix += 1;
  }
}

/** Gitea가 미설정이면(GITEA_API_URL/GITEA_API_TOKEN/GITEA_ADMIN_USERNAME
 * 중 하나라도 없음) 조용히 true를 반환하지 않고 스킵해야 함을 알린다 -
 * ensureEmqxAuthConfigured()와 동일한 fail-soft 판단에 gitea.ts의
 * repoOwner()(내부적으로 config()를 호출해 미설정이면 throw)를
 * 재사용한다. */
function giteaConfigured(): boolean {
  try {
    gitea.repoOwner();
    return true;
  } catch {
    return false;
  }
}

/** userId에 대응하는 Gitea 계정이 항상 존재하도록 보장한다(멱등 - 이미
 * `giteaUsername`이 있으면 즉시 반환). 가입 시점(core/auth.ts의
 * register())과 부팅 시점 보완 스윕(ensureAllUsersGiteaAccountsConfigured())
 * 양쪽에서 호출된다. Gitea가 미설정이거나 계정 생성이 실패해도 예외를
 * 던지지 않는다 - 호출부(특히 회원가입)가 이 실패로 막히면 안 된다,
 * 대신 다음 부팅 스윕이 재시도한다. */
export async function ensureGiteaAccountForUser(userId: string): Promise<void> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.giteaUsername) return;

  if (!giteaConfigured()) return;

  try {
    const base = normalizeUsername(user.username);
    const username = await findAvailableUsername(base);
    const password = crypto.randomBytes(24).toString("hex");
    const email = user.email ?? `${username}@users.noreply.claude-native-workflow.local`;

    const created = await gitea.createGiteaUser({ username, email, password });
    await db.user.update({
      where: { id: userId },
      data: {
        giteaUsername: created.username,
        giteaPasswordEncrypted: encryptSecret(password),
        giteaUserId: created.id,
        giteaProvisionedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`ensureGiteaAccountForUser(${userId}) 실패:`, err);
  }
}

/** 서버 기동 시 호출 - Gitea가 설정돼 있는데 아직 Gitea 계정이 없는
 * User(가입 시점에 실패했거나, 이 기능이 추가되기 전에 이미 가입돼
 * 있던 계정)를 전부 찾아 채운다(`ensureSearchIndexes()`류가 이미 쓰는
 * "부팅 시 훑어서 빠진 것만 채운다"는 멱등 보완 패턴). */
export async function ensureAllUsersGiteaAccountsConfigured(): Promise<void> {
  if (!giteaConfigured()) return;
  const db = getDb();
  const pending = await db.user.findMany({ where: { giteaUsername: null }, select: { id: true } });
  for (const u of pending) {
    await ensureGiteaAccountForUser(u.id);
  }
}
