import { getDb } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { isSuperAdmin } from "./auth.js";
import { paginate, type Page } from "./pagination.js";

// 설계자 계정에 연결해 저장하는 외부 git 저장소 자격증명(AES-256-GCM
// 암호화). 프로젝트 생성/마이그레이션 시 입력한 git 저장소가 인증을
// 요구할 때 쓴다 - 실제 clone/push에 쓰는 건 Gitea 통합(Phase 2)부터고,
// 여기서는 저장/조회만 다룬다.

export interface GitCredentialSummary {
  id: string;
  hostPattern: string | null;
  credentialType: string;
  createdAt: Date;
  // GitHub OAuth 로그인으로 발급된(=refresh_token이 함께 저장된)
  // 자격증명만 채워진다 - 수동 PAT/username_password는 항상 null(만료
  // 관리 대상이 아님을 프런트가 구분할 수 있게).
  accessTokenExpiresAt: Date | null;
}

/** OAuth 교환/갱신 응답에서 나오는 부가 정보 - 없으면(수동 PAT 입력 등)
 * 그냥 만료 관리 없이 예전처럼 동작한다. */
export interface GitCredentialOAuthExtras {
  refreshToken?: string;
  accessTokenExpiresInSec?: number;
  refreshTokenExpiresInSec?: number;
}

const VALID_CREDENTIAL_TYPES = new Set(["token", "username_password", "ssh_key"]);

// access token 만료 몇 분 전부터 선제적으로 갱신할지 - 정확히 만료
// 시각까지 기다리면 그 순간 진행 중이던 요청이 애매하게 걸쳐 실패할
// 수 있어 여유를 둔다.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function addGitCredential(
  userId: string,
  credentialType: string,
  value: string,
  hostPattern?: string,
  oauth?: GitCredentialOAuthExtras,
): Promise<GitCredentialSummary> {
  if (!VALID_CREDENTIAL_TYPES.has(credentialType)) {
    throw new Error(`알 수 없는 credentialType: ${credentialType} (token|username_password|ssh_key 중 하나)`);
  }
  if (!value) throw new Error("value(암호화할 자격증명 값)가 필요합니다");

  const now = Date.now();
  const db = getDb();
  const row = await db.gitCredential.create({
    data: {
      userId,
      hostPattern: hostPattern ?? null,
      credentialType,
      // 평문 value는 이 함수를 벗어나는 순간 즉시 암호화된 상태로만
      // 남는다 - 호출부(API 응답 등)에 그대로 돌려주지 않는다.
      encryptedPayload: encryptSecret(value),
      refreshTokenEncrypted: oauth?.refreshToken ? encryptSecret(oauth.refreshToken) : null,
      accessTokenExpiresAt: oauth?.accessTokenExpiresInSec != null ? new Date(now + oauth.accessTokenExpiresInSec * 1000) : null,
      refreshTokenExpiresAt: oauth?.refreshTokenExpiresInSec != null ? new Date(now + oauth.refreshTokenExpiresInSec * 1000) : null,
    },
  });
  return {
    id: row.id,
    hostPattern: row.hostPattern,
    credentialType: row.credentialType,
    createdAt: row.createdAt,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
  };
}

// payload는 절대 반환하지 않는다 - 목록 조회는 존재 여부/타입/호스트
// 패턴까지만 보여준다.
type CredentialListRow = {
  id: string;
  hostPattern: string | null;
  credentialType: string;
  createdAt: Date;
  accessTokenExpiresAt: Date | null;
};

function toSummary(r: CredentialListRow): GitCredentialSummary {
  return {
    id: r.id,
    hostPattern: r.hostPattern,
    credentialType: r.credentialType,
    createdAt: r.createdAt,
    accessTokenExpiresAt: r.accessTokenExpiresAt,
  };
}

export async function listGitCredentials(userId: string): Promise<GitCredentialSummary[]> {
  const db = getDb();
  const rows = await db.gitCredential.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(toSummary);
}

export async function listGitCredentialsPaged(userId: string, page: number, pageSize: number): Promise<Page<GitCredentialSummary>> {
  const db = getDb();
  const result = await paginate<CredentialListRow>(
    (args) => db.gitCredential.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, ...args }),
    () => db.gitCredential.count({ where: { userId } }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: result.items.map(toSummary),
  };
}

interface GithubRefreshResult {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresInSec?: number;
  refreshTokenExpiresInSec?: number;
}

/** GitHub의 refresh_token grant(조직의 "OAuth App 토큰 만료" 정책이
 * 켜져 있어 refresh_token이 발급된 자격증명에서만 쓸 수 있음) - 토큰
 * 교환과 같은 엔드포인트를 grant_type만 바꿔 재사용한다. GitHub는
 * 보통 refresh_token도 함께 회전시켜 새로 내려준다. */
async function refreshGithubAccessToken(refreshToken: string): Promise<GithubRefreshResult> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GitHub OAuth가 설정되지 않았습니다(GITHUB_OAUTH_CLIENT_ID/GITHUB_OAUTH_CLIENT_SECRET)");
  }
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`GitHub 토큰 갱신 실패: HTTP ${res.status}`);
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!json.access_token) {
    throw new Error(`GitHub 토큰 갱신 실패: ${json.error_description ?? json.error ?? "알 수 없는 오류"}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessTokenExpiresInSec: json.expires_in,
    refreshTokenExpiresInSec: json.refresh_token_expires_in,
  };
}

type CredentialRow = {
  id: string;
  encryptedPayload: Buffer;
  refreshTokenEncrypted: Buffer | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
};

/** 저장된 access token을 반환하되, 만료가 임박/이미 지났고 refresh_token
 * 이 있으면(=GitHub 쪽 만료 정책이 켜진 자격증명) 먼저 자동 갱신해서
 * 저장까지 마친 뒤 새 값을 돌려준다. refresh_token 자체가 없거나 이미
 * 만료됐거나 갱신 요청이 실패하면 기존 값을 그대로 돌려준다 - 그래야
 * 호출부(validateExternalCredential/destroyInvalidCredential 등)가
 * 지금처럼 "시도해보고 무효면 자연스럽게 감지"하는 기존 경로를 그대로
 * 탈 수 있다(raw 갱신 예외를 여기서 삼켜 호출부까지 새지 않게 함). */
async function resolveTokenWithRefresh(cred: CredentialRow): Promise<string> {
  const needsRefresh =
    cred.refreshTokenEncrypted != null &&
    cred.accessTokenExpiresAt != null &&
    cred.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS <= Date.now() &&
    (cred.refreshTokenExpiresAt == null || cred.refreshTokenExpiresAt.getTime() > Date.now());

  if (!needsRefresh) return decryptSecret(cred.encryptedPayload);

  try {
    const refreshed = await refreshGithubAccessToken(decryptSecret(cred.refreshTokenEncrypted!));
    const now = Date.now();
    const db = getDb();
    await db.gitCredential.update({
      where: { id: cred.id },
      data: {
        encryptedPayload: encryptSecret(refreshed.accessToken),
        refreshTokenEncrypted: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : cred.refreshTokenEncrypted,
        accessTokenExpiresAt: refreshed.accessTokenExpiresInSec != null ? new Date(now + refreshed.accessTokenExpiresInSec * 1000) : null,
        refreshTokenExpiresAt:
          refreshed.refreshTokenExpiresInSec != null ? new Date(now + refreshed.refreshTokenExpiresInSec * 1000) : cred.refreshTokenExpiresAt,
      },
    });
    return refreshed.accessToken;
  } catch (err) {
    console.error(`gitCredentials.resolveTokenWithRefresh(${cred.id}) - 자동 갱신 실패, 기존 토큰으로 계속 진행:`, err);
    return decryptSecret(cred.encryptedPayload);
  }
}

// GitHub 저장소 목록 조회(credentials/:id/github/repos)처럼 "본인
// 소유 자격증명의 평문 토큰이 당장 필요한" 소수 호출부 전용 - 목록/조회
// API는 여전히 payload를 절대 안 돌려준다는 원칙 그대로 유지. 만료
// 임박/만료된 토큰이면 반환 전에 자동 갱신도 시도한다.
export async function getCredentialTokenIfOwner(userId: string, credentialId: string): Promise<string> {
  const db = getDb();
  const cred = await db.gitCredential.findUnique({ where: { id: credentialId } });
  if (!cred || (cred.userId !== userId && !(await isSuperAdmin(userId)))) {
    throw new Error("자격증명을 찾을 수 없거나 소유자가 아닙니다");
  }
  return resolveTokenWithRefresh(cred);
}

/** gitRepos.ts 등 내부 흐름 전용 - 소유권 검사 없이 id만으로 조회한다
 * (호출부가 이미 프로젝트 경유로 접근 권한을 확인했다는 전제). 만료
 * 임박/만료된 토큰이면 자동 갱신까지 시도한 뒤 돌려준다. */
export async function resolveCredentialTokenById(credentialId?: string): Promise<string | undefined> {
  if (!credentialId) return undefined;
  const db = getDb();
  const cred = await db.gitCredential.findUnique({ where: { id: credentialId } });
  if (!cred) return undefined;
  return resolveTokenWithRefresh(cred);
}

export async function removeGitCredential(userId: string, id: string): Promise<void> {
  const db = getDb();
  const row = await db.gitCredential.findUnique({ where: { id } });
  if (!row || (row.userId !== userId && !(await isSuperAdmin(userId)))) {
    throw new Error("자격증명을 찾을 수 없거나 소유자가 아닙니다");
  }
  await db.gitCredential.delete({ where: { id } });
}
