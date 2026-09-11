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
import { encryptSecret, decryptSecret } from "./crypto.js";
import { resyncCollaboratorGrantsForUser } from "./members.js";

const MAX_USERNAME_LEN = 40; // Gitea 사용자명 길이 제한에 여유를 둔 값
// 설계자당 하나뿐인 Gitea PAT의 고정 이름 - 백엔드가 그 설계자를
// 대신해 커밋할 때와 그 설계자가 외부 git 클라이언트에서 직접 쓰는
// 자격증명을 겸한다(core/gitea.ts의 createUserAccessToken() 참고).
const GITEA_TOKEN_NAME = "cnwk-backend";

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

/** userId에 대응하는 Gitea 계정 + PAT이 항상 존재하도록 보장한다
 * (멱등 - 이미 `giteaUsername`과 `giteaAccessTokenEncrypted`가 둘 다
 * 있으면 즉시 반환). 계정만 있고 토큰이 없는 상태(과거에 계정 생성은
 * 성공했지만 토큰 발급만 실패했던 경우)도 복구한다 - 저장된 비밀번호로
 * 토큰만 새로 발급. 가입 시점(core/auth.ts의 register())과 부팅 시점
 * 보완 스윕(ensureAllUsersGiteaAccountsConfigured()) 양쪽에서
 * 호출된다. Gitea가 미설정이거나 실패해도 예외를 던지지 않는다 -
 * 호출부(특히 회원가입)가 이 실패로 막히면 안 된다, 대신 다음 부팅
 * 스윕이 재시도한다. */
export async function ensureGiteaAccountForUser(userId: string): Promise<void> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.giteaUsername && user.giteaAccessTokenEncrypted) return;

  if (!giteaConfigured()) return;

  try {
    let username = user.giteaUsername;
    let password: string;

    if (!username) {
      const base = normalizeUsername(user.username);
      username = await findAvailableUsername(base);
      password = crypto.randomBytes(24).toString("hex");
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
    } else if (user.giteaPasswordEncrypted) {
      password = decryptSecret(user.giteaPasswordEncrypted);
    } else {
      return; // 계정은 있는데 비밀번호가 없는 상태 - 이론상 발생하지 않음
    }

    const tokenValue = await gitea.createUserAccessToken(username, password, GITEA_TOKEN_NAME);
    await db.user.update({
      where: { id: userId },
      data: { giteaAccessTokenEncrypted: encryptSecret(tokenValue), giteaTokenName: GITEA_TOKEN_NAME },
    });

    await resyncCollaboratorGrantsForUser(userId);
  } catch (err) {
    console.error(`ensureGiteaAccountForUser(${userId}) 실패:`, err);
  }
}

/** 서버 기동 시 호출 - Gitea가 설정돼 있는데 아직 계정 또는 PAT이 없는
 * User(가입 시점에 실패했거나, 이 기능이 추가되기 전에 이미 가입돼
 * 있던 계정)를 전부 찾아 채운다(`ensureSearchIndexes()`류가 이미 쓰는
 * "부팅 시 훑어서 빠진 것만 채운다"는 멱등 보완 패턴). */
export async function ensureAllUsersGiteaAccountsConfigured(): Promise<void> {
  if (!giteaConfigured()) return;
  const db = getDb();
  const pending = await db.user.findMany({
    where: { OR: [{ giteaUsername: null }, { giteaAccessTokenEncrypted: null }] },
    select: { id: true },
  });
  for (const u of pending) {
    await ensureGiteaAccountForUser(u.id);
  }
}

/** `putFileContent()`의 `actingToken`으로 넘길 값 - 복호화만, 없으면
 * null(호출부가 관리자 토큰으로 폴백). */
export async function getGiteaAccessToken(userId: string): Promise<string | null> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId }, select: { giteaAccessTokenEncrypted: true } });
  if (!user?.giteaAccessTokenEncrypted) return null;
  return decryptSecret(user.giteaAccessTokenEncrypted);
}

/** 프로필 화면 "재발급" 버튼 전용 - 기존 Gitea PAT이 있으면 지우고
 * 새로 발급해 저장한 뒤 평문을 딱 한 번 반환한다(호출부가 이 반환값을
 * 응답에 그대로 실어 보내고, DB에는 계속 암호화된 채로만 남는다 -
 * "지금 한 번만 표시됩니다" UX, `ApiKey`의 생성 시 노출 패턴과 동일). */
export async function regenerateGiteaAccessToken(userId: string): Promise<string> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.giteaUsername || !user.giteaPasswordEncrypted) {
    throw new Error("Gitea 계정이 아직 준비되지 않았습니다 - 잠시 후 다시 시도하세요");
  }
  const password = decryptSecret(user.giteaPasswordEncrypted);
  if (user.giteaTokenName) {
    await gitea.deleteUserAccessToken(user.giteaUsername, password, user.giteaTokenName).catch(() => {});
  }
  const tokenValue = await gitea.createUserAccessToken(user.giteaUsername, password, GITEA_TOKEN_NAME);
  await db.user.update({
    where: { id: userId },
    data: { giteaAccessTokenEncrypted: encryptSecret(tokenValue), giteaTokenName: GITEA_TOKEN_NAME },
  });
  return tokenValue;
}
