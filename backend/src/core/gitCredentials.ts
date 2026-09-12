import { getDb } from "./db.js";
import { encryptSecret } from "./crypto.js";
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
}

const VALID_CREDENTIAL_TYPES = new Set(["token", "username_password", "ssh_key"]);

export async function addGitCredential(
  userId: string,
  credentialType: string,
  value: string,
  hostPattern?: string,
): Promise<GitCredentialSummary> {
  if (!VALID_CREDENTIAL_TYPES.has(credentialType)) {
    throw new Error(`알 수 없는 credentialType: ${credentialType} (token|username_password|ssh_key 중 하나)`);
  }
  if (!value) throw new Error("value(암호화할 자격증명 값)가 필요합니다");

  const db = getDb();
  const row = await db.gitCredential.create({
    data: {
      userId,
      hostPattern: hostPattern ?? null,
      credentialType,
      // 평문 value는 이 함수를 벗어나는 순간 즉시 암호화된 상태로만
      // 남는다 - 호출부(API 응답 등)에 그대로 돌려주지 않는다.
      encryptedPayload: encryptSecret(value),
    },
  });
  return {
    id: row.id,
    hostPattern: row.hostPattern,
    credentialType: row.credentialType,
    createdAt: row.createdAt,
  };
}

// payload는 절대 반환하지 않는다 - 목록 조회는 존재 여부/타입/호스트
// 패턴까지만 보여준다.
export async function listGitCredentials(userId: string): Promise<GitCredentialSummary[]> {
  const db = getDb();
  const rows = await db.gitCredential.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map((r: { id: string; hostPattern: string | null; credentialType: string; createdAt: Date }) => ({
    id: r.id,
    hostPattern: r.hostPattern,
    credentialType: r.credentialType,
    createdAt: r.createdAt,
  }));
}

export async function listGitCredentialsPaged(userId: string, page: number, pageSize: number): Promise<Page<GitCredentialSummary>> {
  const db = getDb();
  const result = await paginate<{ id: string; hostPattern: string | null; credentialType: string; createdAt: Date }>(
    (args) => db.gitCredential.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, ...args }),
    () => db.gitCredential.count({ where: { userId } }),
    page,
    pageSize,
  );
  return {
    ...result,
    items: result.items.map((r: { id: string; hostPattern: string | null; credentialType: string; createdAt: Date }) => ({
      id: r.id,
      hostPattern: r.hostPattern,
      credentialType: r.credentialType,
      createdAt: r.createdAt,
    })),
  };
}

export async function removeGitCredential(userId: string, id: string): Promise<void> {
  const db = getDb();
  const row = await db.gitCredential.findUnique({ where: { id } });
  if (!row || (row.userId !== userId && !(await isSuperAdmin(userId)))) {
    throw new Error("자격증명을 찾을 수 없거나 소유자가 아닙니다");
  }
  await db.gitCredential.delete({ where: { id } });
}
