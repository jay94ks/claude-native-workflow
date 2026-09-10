import crypto from "node:crypto";
import { getDb } from "./db.js";
import { getMemberRole } from "./members.js";
import { isTeamAdmin } from "./teamAdmins.js";
import type { KeyScope } from "./requestScope.js";

// API 키 3종(personal/project/team) - 전부 ownerId가 대행하는 신원이고
// 스코프만 다르다(설계 원칙: "누구인지"가 아니라 "어디까지"를 제한).
// 원문(secret)은 절대 저장하지 않고 단방향 해시(sha256)만 저장한다 -
// auth.ts의 refresh token 해시 저장과 같은 패턴(GitCredential의
// AES-256-GCM 가역 암호화와는 성격이 다름 - 이 값은 "다시 보여줄 필요"
// 자체가 없어야 하므로 가역 암호화보다 단방향 해시가 더 강한 보장).

const KEY_PREFIX = "cnwk_";
const KEY_DISPLAY_PREFIX_LEN = 10; // "cnwk_" + 5자 - 목록 화면에서 구분용

export class ApiKeyError extends Error {}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function generateSecret(): { secret: string; prefix: string; hash: string } {
  const secret = KEY_PREFIX + crypto.randomBytes(24).toString("hex");
  return { secret, prefix: secret.slice(0, KEY_DISPLAY_PREFIX_LEN), hash: hashSecret(secret) };
}

export interface ApiKeyDetail {
  id: string;
  ownerId: string;
  scope: string; // personal | project | team
  projectId: string | null;
  teamId: string | null;
  label: string | null;
  keyPrefix: string;
  status: string; // active | revoked
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
}

// keyHash는 의도적으로 이 타입/매핑 함수 밖에 절대 안 둔다 - 이 함수
// 하나만 거치면 원문/해시가 응답에 새어나갈 방법이 코드 구조적으로 없다.
function toDetail(row: {
  id: string;
  ownerId: string;
  scope: string;
  projectId: string | null;
  teamId: string | null;
  label: string | null;
  keyPrefix: string;
  status: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
}): ApiKeyDetail {
  return {
    id: row.id,
    ownerId: row.ownerId,
    scope: row.scope,
    projectId: row.projectId,
    teamId: row.teamId,
    label: row.label,
    keyPrefix: row.keyPrefix,
    status: row.status,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
  };
}

export interface CreateApiKeyInput {
  scope: "personal" | "project" | "team";
  projectId?: string;
  teamId?: string;
  label?: string;
}

/** ownerId는 항상 actingUserId(다른 사람을 대신해 키를 만드는 기능은
 * 없음 - 팀장이 만드는 "팀 키"도 그 팀장 자신의 신원을 대행하되 범위만
 * 넓어진 것). scope별 사전 검증: project는 그 프로젝트 멤버(viewer
 * 이상 - 역할 무관), team은 그 팀의 팀장이어야 한다. */
export async function createApiKey(
  actingUserId: string,
  input: CreateApiKeyInput,
): Promise<{ key: ApiKeyDetail; secret: string }> {
  const db = getDb();
  if (input.scope === "project") {
    if (!input.projectId) throw new ApiKeyError("projectId가 필요합니다");
    const role = await getMemberRole(input.projectId, actingUserId);
    if (!role) throw new ApiKeyError("이 프로젝트의 멤버만 프로젝트 키를 만들 수 있습니다");
  } else if (input.scope === "team") {
    if (!input.teamId) throw new ApiKeyError("teamId가 필요합니다");
    if (!(await isTeamAdmin(input.teamId, actingUserId))) {
      throw new ApiKeyError("이 팀의 팀장만 팀 관리 키를 만들 수 있습니다");
    }
  } else if (input.scope !== "personal") {
    throw new ApiKeyError(`알 수 없는 scope: ${input.scope}`);
  }

  const { secret, prefix, hash } = generateSecret();
  const row = await db.apiKey.create({
    data: {
      ownerId: actingUserId,
      scope: input.scope,
      projectId: input.scope === "project" ? input.projectId : null,
      teamId: input.scope === "team" ? input.teamId : null,
      label: input.label?.trim() || null,
      keyPrefix: prefix,
      keyHash: hash,
    },
  });
  return { key: toDetail(row), secret };
}

export async function listProjectKeys(projectId: string, viewerId: string): Promise<ApiKeyDetail[]> {
  const db = getDb();
  const role = await getMemberRole(projectId, viewerId);
  const where = role === "owner" ? { projectId, scope: "project" } : { projectId, scope: "project", ownerId: viewerId };
  const rows = await db.apiKey.findMany({ where, orderBy: { createdAt: "desc" } });
  return rows.map(toDetail);
}

export async function listTeamKeys(teamId: string, viewerId: string): Promise<ApiKeyDetail[]> {
  if (!(await isTeamAdmin(teamId, viewerId))) {
    throw new ApiKeyError("이 팀의 팀장만 팀 관리 키 목록을 볼 수 있습니다");
  }
  const db = getDb();
  const rows = await db.apiKey.findMany({ where: { teamId, scope: "team" }, orderBy: { createdAt: "desc" } });
  return rows.map(toDetail);
}

export async function listMyPersonalKeys(viewerId: string): Promise<ApiKeyDetail[]> {
  const db = getDb();
  const rows = await db.apiKey.findMany({
    where: { scope: "personal", ownerId: viewerId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDetail);
}

export async function getApiKeyById(keyId: string): Promise<ApiKeyDetail | null> {
  const db = getDb();
  const row = await db.apiKey.findUnique({ where: { id: keyId } });
  return row ? toDetail(row) : null;
}

/** "삭제"가 아니라 "배제"(soft revoke) - 행은 그대로 남고 status만
 * 바뀐다(감사 기록 보존, GitCredential류와 다르게 이 데이터는 "누가
 * 언제 어떤 범위의 신원을 위임받았었는가"라는 이력 자체가 가치가
 * 있음). 권한 판정(owner/팀장/본인 여부)은 라우트가 먼저 하고 이
 * 함수는 최종 상태 갱신만 한다(이 저장소의 기존 인라인 403 관례). */
export async function revokeApiKey(keyId: string, actingUserId: string): Promise<ApiKeyDetail> {
  const db = getDb();
  const existing = await db.apiKey.findUnique({ where: { id: keyId } });
  if (!existing) throw new ApiKeyError(`키를 찾을 수 없습니다: ${keyId}`);
  if (existing.status === "revoked") throw new ApiKeyError("이미 배제된 키입니다");
  const row = await db.apiKey.update({
    where: { id: keyId },
    data: { status: "revoked", revokedAt: new Date(), revokedBy: actingUserId },
  });
  return toDetail(row);
}

/** authenticate 미들웨어가 Bearer 토큰이 cnwk_로 시작할 때 호출한다.
 * 해시로 조회해 active 상태면 신원(ownerId)+스코프를 반환, 아니면
 * null(→ 401). lastUsedAt을 매번 갱신해 관리 화면에서 "마지막 사용
 * 시각"으로 오래된/미사용 키를 판단할 수 있게 한다. */
export async function verifyApiKeySecret(secret: string): Promise<{ userId: string; scope: KeyScope } | null> {
  const db = getDb();
  const hash = hashSecret(secret);
  const row = await db.apiKey.findUnique({ where: { keyHash: hash } });
  if (!row || row.status !== "active") return null;
  await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  const scope: KeyScope =
    row.scope === "project"
      ? { type: "project", projectId: row.projectId! }
      : row.scope === "team"
        ? { type: "team", teamId: row.teamId! }
        : { type: "unrestricted" };
  return { userId: row.ownerId, scope };
}

export const API_KEY_PREFIX = KEY_PREFIX;
