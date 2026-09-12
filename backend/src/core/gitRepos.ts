import crypto from "node:crypto";
import { getDb } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { assertProjectExists } from "./projects.js";
import * as gitea from "./gitea.js";
import { GitAuthRequiredError } from "./gitea.js";
import { registerWebhook } from "./externalGit.js";
import { resyncCollaboratorGrantsForProject } from "./members.js";
import { sendMessage } from "./messages.js";

export { GitAuthRequiredError };

export interface ProjectGitRepoInfo {
  projectId: string;
  provider: string;
  repoUrl: string;
  externalRepoId: string | null;
  gitCredentialId: string | null;
  // 민감하지 않은 상태 플래그라(비밀 값 아님) viewer도 그대로 본다 -
  // 프론트가 "웹훅 수동 설정 안내" 카드를 계속 보여줄지 판단하는 데 씀
  // (자동 등록 실패 + 아직 한 번도 안 받음일 때만 필요).
  webhookAutoRegistered: boolean;
  webhookFirstReceivedAt: string | null;
}

interface ProjectGitRepoRow {
  projectId: string;
  provider: string;
  repoUrl: string;
  externalRepoId: string | null;
  gitCredentialId: string | null;
  webhookSecretEncrypted: Buffer | null;
  webhookAutoRegistered: boolean;
  webhookUrl: string | null;
  webhookFirstReceivedAt: Date | null;
}

function toInfo(row: ProjectGitRepoRow): ProjectGitRepoInfo {
  return {
    projectId: row.projectId,
    provider: row.provider,
    repoUrl: row.repoUrl,
    externalRepoId: row.externalRepoId,
    gitCredentialId: row.gitCredentialId,
    webhookAutoRegistered: row.webhookAutoRegistered,
    webhookFirstReceivedAt: row.webhookFirstReceivedAt ? row.webhookFirstReceivedAt.toISOString() : null,
  };
}

/** 프로젝트별로 고유하고 Gitea repo 이름 제약(영문/숫자/-/_/.)에 맞는
 * slug - cuid는 이미 그 조건을 만족하므로 그대로 접두사만 붙여 쓴다.
 * 옵션 3(외부 연동)의 미러/작업 저장소는 여기서 결정론적으로 파생되는
 * `-mirror`/`-work` 접미사 slug를 쓴다 - 프로젝트당 이미 고유해서 별도
 * DB 컬럼으로 저장할 필요가 없다. */
export function slugForProject(projectId: string): string {
  return `project-${projectId}`;
}

function mirrorSlugForProject(projectId: string): string {
  return `${slugForProject(projectId)}-mirror`;
}

function workSlugForProject(projectId: string): string {
  return `${slugForProject(projectId)}-work`;
}

export type GiteaRepoKind = "self_hosted" | "work" | "mirror";

/** slugForProject()/mirrorSlugForProject()/workSlugForProject()의 역함수 -
 * 시스템 웹훅 payload의 `repository.name`(Gitea repo slug)에서
 * projectId와 저장소 종류를 되짚는다. DB 조회 없는 순수 문자열
 * 파싱만으로 충분한 이유 - cuid엔 하이픈이 없어 접미사 파싱이
 * 모호하지 않다. 이 앱이 만들지 않은 slug(수동으로 만든 저장소 등)면
 * null - 호출부(core/pushHooks.ts)가 그 push를 조용히 무시하는 데
 * 쓴다. */
export function resolveProjectFromSlug(slug: string): { projectId: string; kind: GiteaRepoKind } | null {
  const PREFIX = "project-";
  if (!slug.startsWith(PREFIX)) return null;
  const rest = slug.slice(PREFIX.length);

  let kind: GiteaRepoKind = "self_hosted";
  let projectId = rest;
  if (rest.endsWith("-mirror")) {
    kind = "mirror";
    projectId = rest.slice(0, -"-mirror".length);
  } else if (rest.endsWith("-work")) {
    kind = "work";
    projectId = rest.slice(0, -"-work".length);
  }
  if (!projectId) return null;
  return { projectId, kind };
}

// PUBLIC_BACKEND_URL이 없으면(로컬 개발 등, 외부에서 닿을 수 있는 주소가
// 아직 없을 때) null을 반환 - 호출부가 웹훅 등록을 건너뛰고 나머지
// (저장소 생성/연결)는 정상 진행한다(realtimePublish와 같은 fail-soft
// 원칙 - 웹훅은 부가 기능이지 저장소 연결의 필수 조건이 아니다).
function webhookTargetUrl(provider: string, projectId: string): string | null {
  const base = process.env.PUBLIC_BACKEND_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/api/webhooks/${provider}/${projectId}`;
}

async function resolveCredentialToken(gitCredentialId?: string): Promise<string | undefined> {
  if (!gitCredentialId) return undefined;
  const db = getDb();
  const cred = await db.gitCredential.findUnique({ where: { id: gitCredentialId } });
  if (!cred) return undefined;
  return decryptSecret(cred.encryptedPayload);
}

/** gitea.migrateRepo()가 clone 단계에서 실패하면(특히 인증 필요) Gitea가
 * 이미 만들어둔 빈 stub 저장소가 남는다(실측으로 발견) - 그대로 두면
 * 같은 slug로 재시도(자격증명 입력 후 재시도가 이 플로우의 핵심 사용
 * 경로)할 때마다 "이미 존재합니다"로 막혀 영원히 못 고친다. 실패 시
 * 그 자리에서 정리한 뒤 원래 에러를 그대로 던진다(정리 자체가 실패해도
 * 원래 에러가 더 중요하므로 무시). */
async function migrateRepoOrCleanUp(slug: string, cloneAddr: string, opts: gitea.MigrateOptions): Promise<gitea.CreatedRepo> {
  try {
    return await gitea.migrateRepo(slug, cloneAddr, opts);
  } catch (err) {
    await gitea.deleteRepo(slug).catch(() => {});
    throw err;
  }
}

export interface ImportFrom {
  repoUrl: string;
  gitCredentialId?: string;
}

/** 옵션 1(빈 저장소) + 옵션 2(외부 저장소 완전 이주)를 함께 다룬다 -
 * importFrom 없으면 빈 저장소, 있으면 그 URL의 히스토리를 통째로
 * 가져온 독립 저장소로 시작한다. 결과는 둘 다 provider:"self_hosted" -
 * 연결 시점 한 번의 선택일 뿐 그 이후로는 완전히 같은 방식으로
 * 동작하므로 구분해서 저장하지 않는다.
 *
 * 저장소별 Gitea 웹훅은 더 이상 여기서 등록하지 않는다 - 인스턴스
 * 전체를 커버하는 시스템 웹훅(core/gitea.ts의
 * ensureGiteaSystemWebhookConfigured(), 서버 부팅 시 1회 등록) 하나가
 * self_hosted든 external_linked든 상관없이 모든 저장소의 push를
 * 이미 받으므로, 저장소마다 시크릿을 새로 발급해 웹훅을 거는 절차
 * 자체가 필요 없어졌다. */
export async function linkSelfHostedRepo(
  projectId: string,
  importFrom?: ImportFrom,
): Promise<ProjectGitRepoInfo> {
  await assertProjectExists(projectId);
  const db = getDb();
  const existing = await db.projectGitRepo.findUnique({ where: { projectId } });
  if (existing) throw new Error("이미 git 저장소가 연결된 프로젝트입니다");

  const slug = slugForProject(projectId);
  const { cloneUrl, externalRepoId } = importFrom
    ? await migrateRepoOrCleanUp(slug, importFrom.repoUrl, {
        mirror: false,
        authToken: await resolveCredentialToken(importFrom.gitCredentialId),
      })
    : await gitea.createRepo(slug);

  const row = await db.projectGitRepo.create({
    data: {
      projectId,
      provider: "self_hosted",
      repoUrl: cloneUrl,
      externalRepoId,
      gitCredentialId: importFrom?.gitCredentialId ?? null,
    },
  });
  // 저장소가 없던 동안 가입한 멤버들에게도 한 번에 협업자 권한을
  // 부여한다(core/members.ts) - fail-soft, 실패해도 연결 자체는 성공.
  await resyncCollaboratorGrantsForProject(projectId);
  return toInfo(row);
}

export interface LinkExternalResult extends ProjectGitRepoInfo {
  manualWebhookInstructions?: { url: string; secret: string };
}

/** 옵션 3(외부 저장소를 주된/권위 저장소로 연동) - 외부 저장소는
 * 계속 authoritative로 남고, 이 시스템은 내부 관리 편의를 위해 Gitea에
 * 미러(읽기 전용 pull 사본)와 작업 저장소(이 시스템이 실제로 커밋하는
 * 곳) 두 개를 만든다. 기존 linkExternalRepo(외부 저장소를 그냥
 * 가리키기만 하고 Gitea 사본이 전혀 없던 버전)를 대체 - git log/diff/
 * 소스 에디터가 이제 (requireGiteaWorkingSlug를 통해) 작업 저장소로
 * 전부 동작하게 된다. */
export async function linkExternalAsPrimary(
  projectId: string,
  provider: "github" | "gitlab",
  repoUrl: string,
  gitCredentialId?: string,
): Promise<LinkExternalResult> {
  await assertProjectExists(projectId);
  const db = getDb();
  const existing = await db.projectGitRepo.findUnique({ where: { projectId } });
  if (existing) throw new Error("이미 git 저장소가 연결된 프로젝트입니다");

  const authToken = await resolveCredentialToken(gitCredentialId);
  const mirrorSlug = mirrorSlugForProject(projectId);
  const workSlug = workSlugForProject(projectId);
  await migrateRepoOrCleanUp(mirrorSlug, repoUrl, { mirror: true, authToken, description: "mirror (read-only)" });
  try {
    await migrateRepoOrCleanUp(workSlug, repoUrl, { mirror: false, authToken, description: "work (this system commits here)" });
  } catch (err) {
    // work 저장소 생성이 실패하면 이미 만든 미러도 같이 지운다 - 절반만
    // 연결된(미러만 있고 DB 레코드는 없는) 상태로 남기지 않기 위해.
    await gitea.deleteRepo(mirrorSlug).catch(() => {});
    throw err;
  }

  const secret = crypto.randomBytes(24).toString("hex");
  const targetUrl = webhookTargetUrl(provider, projectId);

  let autoRegistered = false;
  if (targetUrl && gitCredentialId) {
    const cred = await db.gitCredential.findUnique({ where: { id: gitCredentialId } });
    if (cred) {
      const token = decryptSecret(cred.encryptedPayload);
      try {
        await registerWebhook(provider, repoUrl, token, targetUrl, secret);
        autoRegistered = true;
      } catch {
        // 자동 등록 실패는 링크 자체를 막지 않는다 - 수동 안내로 폴백.
        autoRegistered = false;
      }
    }
  }

  const row = await db.projectGitRepo.create({
    data: {
      projectId,
      provider: "external_linked",
      repoUrl,
      gitCredentialId: gitCredentialId ?? null,
      webhookSecretEncrypted: encryptSecret(secret),
      webhookAutoRegistered: autoRegistered,
      webhookUrl: targetUrl,
    },
  });
  // 저장소가 없던 동안 가입한 멤버들에게도 한 번에 협업자 권한을
  // 부여한다(work 저장소 기준 - requireGiteaWorkingSlug가 알아서
  // 작업 저장소를 고름).
  await resyncCollaboratorGrantsForProject(projectId);

  return {
    ...toInfo(row),
    ...(!autoRegistered && targetUrl ? { manualWebhookInstructions: { url: targetUrl, secret } } : {}),
  };
}

/** "웹훅 수동 설정 안내" 카드용 - 자동 등록에 실패했고 아직 그
 * 웹훅이 한 번도 실제로 호출된 적이 없을 때만 URL+secret을 돌려준다
 * (그 외엔 카드가 필요 없다는 뜻으로 null). secret은 저장은 돼
 * 있지만(검증용) 평소엔 안 돌려주는 값이라 - API 키처럼 "1회만
 * 노출"은 아니고, 이 카드가 필요한 동안은 owner가 몇 번이고 다시
 * 볼 수 있어야 하므로(설계자 지시) 매번 복호화해 돌려준다. 호출부
 * (server.ts)가 owner 권한을 이미 확인했다고 가정한다. */
export async function getWebhookSetupInstructions(projectId: string): Promise<{ url: string; secret: string } | null> {
  const db = getDb();
  const row = await db.projectGitRepo.findUnique({ where: { projectId } });
  if (!row || row.provider !== "external_linked") return null;
  if (row.webhookAutoRegistered || row.webhookFirstReceivedAt) return null;
  if (!row.webhookSecretEncrypted || !row.webhookUrl) return null;
  return { url: row.webhookUrl, secret: decryptSecret(row.webhookSecretEncrypted) };
}

/** 외부(GitHub/GitLab) 저장소 자체에서 온 웹훅이 실제로 처음
 * 도착했을 때 호출한다(server.ts의 웹훅 수신 라우트, gitea가 아닌
 * provider만) - "웹훅 수동 설정 안내" 카드를 그만 보여줄 시점을
 * 표시한다. 이미 찍혀 있으면 다시 안 건드린다(idempotent - 매
 * push마다 쓸데없이 갱신하지 않음). */
export async function markExternalWebhookReceived(projectId: string): Promise<void> {
  const db = getDb();
  await db.projectGitRepo.updateMany({
    where: { projectId, webhookFirstReceivedAt: null },
    data: { webhookFirstReceivedAt: new Date() },
  });
}

export async function getProjectGitRepo(projectId: string): Promise<ProjectGitRepoInfo | null> {
  const db = getDb();
  const row = await db.projectGitRepo.findUnique({ where: { projectId } });
  return row ? toInfo(row) : null;
}

/** 외부(GitHub/GitLab)를 권위 저장소로 취급하던 관계만 끊는다(설계자
 * 확정 - #git-unlink) - Gitea와의 연결 자체는 프로젝트를 삭제하지
 * 않는 한 끊을 수 없어야 하므로, 저장소를 지우는 게 아니라 이미
 * linkExternalAsPrimary()가 만들어둔 **작업 저장소**를 그대로
 * self_hosted로 승격시킨다(git 히스토리·현재 상태 보존). 미러(외부
 * 저장소의 읽기 전용 캐시)만 이제 의미가 없어져 지운다. self_hosted로
 * 시작한 프로젝트는 처음부터 "외부"라는 관계가 없어 해제 대상이
 * 아니다. */
export async function unlinkExternalRepo(projectId: string): Promise<ProjectGitRepoInfo> {
  const repo = await getProjectGitRepo(projectId);
  if (!repo) throw new Error("연결된 git 저장소가 없습니다");
  if (repo.provider !== "external_linked" && repo.provider !== "github" && repo.provider !== "gitlab") {
    throw new Error("자체 호스팅 저장소는 연결 해제할 수 없습니다 - 프로젝트를 삭제해야 합니다");
  }
  const mirrorSlug = mirrorSlugForProject(projectId);
  const workSlug = workSlugForProject(projectId);
  const plainSlug = slugForProject(projectId);
  await gitea.deleteRepo(mirrorSlug).catch((err) => {
    console.error(`unlinkExternalRepo(${projectId}) - 미러 저장소 삭제 실패(${mirrorSlug}):`, err);
  });
  // requireGiteaWorkingSlug()의 self_hosted 분기는 접미사 없는
  // slugForProject()를 기대한다 - DB의 provider만 바꾸고 Gitea 저장소
  // 이름을 그대로 "-work"로 남기면 이후 모든 git 조회/커밋이 존재하지
  // 않는 slug를 찾아 404가 난다(실측으로 발견) - 실제로 이름을 바꿔야
  // self_hosted 프로젝트와 완전히 동일하게 동작한다.
  const workRepo = await gitea.renameRepo(workSlug, plainSlug);
  const db = getDb();
  const row = await db.projectGitRepo.update({
    where: { projectId },
    data: {
      provider: "self_hosted",
      repoUrl: workRepo.cloneUrl,
      externalRepoId: workRepo.externalRepoId,
      gitCredentialId: null,
      webhookSecretEncrypted: null,
    },
  });
  return toInfo(row);
}

/** 프로젝트 삭제 시 연결된 Gitea 저장소도 함께 지운다(설계자 확인 -
 * 프로젝트를 삭제하면 DB 데이터뿐 아니라 Gitea 저장소도 같이 삭제).
 * self_hosted는 저장소 하나(slugForProject), external_linked는 미러+
 * 작업 저장소 둘 다(레거시 provider "github"/"gitlab"은 애초에 Gitea
 * 사본이 없던 버전이라 스킵). 실패해도(Gitea 다운 등) 개별적으로
 * 로그만 남기고 계속 진행한다(fail-soft - syncCollaboratorGrant와
 * 같은 원칙 - Gitea가 일시적으로 안 떠 있다고 프로젝트 삭제 자체가
 * 막히면 안 됨). */
export async function deleteProjectGitRepo(projectId: string): Promise<void> {
  const repo = await getProjectGitRepo(projectId);
  if (!repo) return;
  const slugs =
    repo.provider === "self_hosted"
      ? [slugForProject(projectId)]
      : repo.provider === "external_linked"
        ? [mirrorSlugForProject(projectId), workSlugForProject(projectId)]
        : [];
  for (const slug of slugs) {
    try {
      await gitea.deleteRepo(slug);
    } catch (err) {
      console.error(`deleteProjectGitRepo(${projectId}) - Gitea 저장소 삭제 실패(${slug}):`, err);
    }
  }
}

export async function getWebhookSecret(projectId: string): Promise<string | null> {
  const db = getDb();
  const row = await db.projectGitRepo.findUnique({ where: { projectId } });
  if (!row?.webhookSecretEncrypted) return null;
  return decryptSecret(row.webhookSecretEncrypted);
}

/** git log/diff/blame/show/tree/file, template deploy 공통 가드 -
 * 저장소가 없으면 명확한 이유와 함께 즉시 실패시킨다(조용히 빈 결과를
 * 주지 않음). self_hosted면 그 저장소 자신의 slug, external_linked면
 * 작업 저장소의 slug를 반환 - 호출부는 이 슬러그로 Gitea를 그대로
 * 호출하면 된다(어느 provider든 결과가 항상 실제로 존재하는 Gitea
 * 저장소를 가리킴 - 예전엔 external 계열이 전부 400이었지만 이제는
 * 작업 저장소가 있어서 지원됨). */
export async function requireGiteaWorkingSlug(projectId: string): Promise<string> {
  const repo = await getProjectGitRepo(projectId);
  if (!repo) {
    throw new Error("먼저 git 저장소를 연결하세요(POST .../git/link 또는 .../git/link-external)");
  }
  if (repo.provider === "self_hosted") return slugForProject(projectId);
  if (repo.provider === "external_linked") return workSlugForProject(projectId);
  // 레거시 - 과거 linkExternalRepo가 만들던 provider:"github"/"gitlab"
  // (Gitea 사본이 전혀 없던 버전)로 이미 연결된 프로젝트가 있을 수 있음.
  throw new Error("이 연결 방식은 git 이력 조회를 지원하지 않습니다(다시 연결하면 지원됩니다)");
}

export interface GitSyncStatus {
  added: string[];
  changed: string[];
  removedFromWork: string[];
}

// ---------------------------------------------------------------- 동기화 상태 큐

// Gitea의 mirror-sync 트리거는 비동기 큐잉이다(호출이 성공해도 실제
// pull은 아직 안 끝났을 수 있음) - "트리거 → 즉시 비교"로는 옛 상태를
// 읽을 위험이 있다(설계자 지적). 그래서 트리거/조회를 분리한다:
// requestGitSyncStatus()가 트리거만 하고 즉시 "예정됨"으로 반환,
// 실제 비교는 백그라운드에서 mirror_updated 타임스탬프가 실제로
// 바뀔 때까지 짧게 폴링한 뒤 수행해 결과를 캐시에 담는다.
// getCachedGitSyncStatus()가 그 캐시를 읽기 전용으로 조회한다.
// 프로젝트당 하나씩만 진행 중이면 되므로(이미 진행 중일 때 또
// 트리거하면 "이미 예정됨"만 알리고 새 요청을 큐에 안 쌓는다) 메모리
// 맵으로 충분 - 서버 재시작 시 사라져도 다시 요청하면 그만인 일시적
// 상태라 DB에 영속화할 이유가 없다.

type SyncState = { status: "pending" } | { status: "ready"; result: GitSyncStatus };

const syncStateByProject = new Map<string, SyncState>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function diffTrees(mirrorTree: gitea.FullTreeEntry[], workTree: gitea.FullTreeEntry[]): GitSyncStatus {
  const mirrorByPath = new Map(mirrorTree.map((e) => [e.path, e.sha]));
  const workByPath = new Map(workTree.map((e) => [e.path, e.sha]));

  const added: string[] = [];
  const changed: string[] = [];
  const removedFromWork: string[] = [];

  for (const [path, sha] of workByPath) {
    const mirrorSha = mirrorByPath.get(path);
    if (mirrorSha === undefined) added.push(path);
    else if (mirrorSha !== sha) changed.push(path);
  }
  for (const path of mirrorByPath.keys()) {
    if (!workByPath.has(path)) removedFromWork.push(path);
  }

  return { added, changed, removedFromWork };
}

async function computeSyncStatusInBackground(projectId: string): Promise<void> {
  const mirrorSlug = mirrorSlugForProject(projectId);
  const workSlug = workSlugForProject(projectId);
  try {
    const updatedBefore = await gitea.getMirrorUpdatedAt(mirrorSlug);
    await gitea.forceMirrorSync(mirrorSlug);

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await sleep(2000);
      const updatedNow = await gitea.getMirrorUpdatedAt(mirrorSlug);
      if (updatedNow !== updatedBefore) break;
    }

    const [mirrorTree, workTree] = await Promise.all([gitea.getFullTree(mirrorSlug), gitea.getFullTree(workSlug)]);
    syncStateByProject.set(projectId, { status: "ready", result: diffTrees(mirrorTree, workTree) });
  } catch (err) {
    syncStateByProject.delete(projectId);
    console.error(`git sync-status 계산 실패 (project ${projectId}):`, err);
  }
}

async function assertExternalLinked(projectId: string): Promise<void> {
  const repo = await getProjectGitRepo(projectId);
  if (!repo || repo.provider !== "external_linked") {
    throw new Error("이 연결 방식은 동기화 제안을 지원하지 않습니다(외부 저장소 연동 프로젝트만 가능)");
  }
}

export type SyncRequestResult = { status: "scheduled" } | { status: "already-scheduled" };

/** 미러 동기화 + 비교를 요청만 하고 즉시 반환한다(완료를 기다리지
 * 않음) - 이미 진행 중이면 새로 트리거하지 않고 "이미 예정됨"만
 * 알린다. 실제 결과는 getCachedGitSyncStatus()로 폴링해서 받는다. */
export async function requestGitSyncStatus(projectId: string): Promise<SyncRequestResult> {
  await assertExternalLinked(projectId);
  if (syncStateByProject.get(projectId)?.status === "pending") {
    return { status: "already-scheduled" };
  }
  syncStateByProject.set(projectId, { status: "pending" });
  void computeSyncStatusInBackground(projectId);
  return { status: "scheduled" };
}

export type CachedSyncStatus = { status: "none" } | { status: "pending" } | ({ status: "ready" } & GitSyncStatus);

export async function getCachedGitSyncStatus(projectId: string): Promise<CachedSyncStatus> {
  await assertExternalLinked(projectId);
  const state = syncStateByProject.get(projectId);
  if (!state) return { status: "none" };
  if (state.status === "pending") return { status: "pending" };
  return { status: "ready", ...state.result };
}

export interface GitSyncProposalFile {
  path: string;
  content: string;
}

/** 캐시에 있는 최근 "ready" 결과의 added+changed 경로마다 작업 저장소의
 * 현재 내용을 가져온다 - 아직 계산이 안 끝났거나 한 번도 요청 안 했으면
 * 명확한 에러(먼저 동기화 상태를 확인하라고 안내). 이 내용을 실제로
 * 외부(권위) 저장소에 반영하는 방법(브랜치 생성, PR 오픈)은 설계자의
 * 몫이다(자동 PR 생성은 범위 밖). */
export async function getGitSyncProposal(projectId: string): Promise<{ files: GitSyncProposalFile[] }> {
  const cached = await getCachedGitSyncStatus(projectId);
  if (cached.status !== "ready") {
    throw new Error("먼저 동기화 상태를 확인하세요(git/sync-status로 요청 후 완료될 때까지 기다려야 합니다)");
  }
  const workSlug = workSlugForProject(projectId);
  const paths = [...cached.added, ...cached.changed];
  const files = await Promise.all(
    paths.map(async (path) => {
      const file = await gitea.getFileContent(workSlug, path);
      return { path, content: file.content };
    }),
  );
  return { files };
}

// ---------------------------------------------------------------- 외부 저장소 동기화(발행) - Gitea Push Mirror 기반
// "동기화 제안"까지만 있던 걸 실제로 외부(권위) 저장소에 반영하는
// 기능(설계자 확정) - work 저장소에 Push Mirror를 걸어두고 즉시
// 동기화를 트리거한다. fast-forward가 안 되거나(외부가 앞서감)
// 자격증명에 push 권한이 없으면 Gitea의 push가 그대로 실패하고(별도
// 사전 판정 없이 "시도 후 확인"), 그 결과를 그대로 AI 대기열로 넘긴다.

export type PublishResult = { status: "synced" } | { status: "queued"; queueEntryId: string };

async function waitForPushMirrorOutcome(slug: string, previousUpdate: string | null): Promise<gitea.PushMirrorStatus | null> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = await gitea.getPushMirrorStatus(slug);
    if (status?.lastError) return status;
    if (status?.lastUpdate && status.lastUpdate !== previousUpdate) return status;
  }
  return await gitea.getPushMirrorStatus(slug);
}

export async function publishToExternalRepo(projectId: string, gitCredentialId: string): Promise<PublishResult> {
  const repo = await getProjectGitRepo(projectId);
  if (!repo || repo.provider !== "external_linked") {
    throw new Error("외부 저장소 연동(external_linked) 프로젝트에서만 발행할 수 있습니다");
  }
  const token = await resolveCredentialToken(gitCredentialId);
  if (!token) throw new Error(`자격증명을 찾을 수 없습니다: ${gitCredentialId}`);

  const workSlug = workSlugForProject(projectId);
  const existing = await gitea.getPushMirrorStatus(workSlug);
  if (!existing) {
    // push mirror의 "username"은 대부분의 PAT 기반 인증(GitHub/GitLab)에서
    // 실질적으로 무시된다 - 토큰을 그대로 재사용한다.
    await gitea.configurePushMirror(workSlug, repo.repoUrl, token, token);
  }
  await gitea.triggerPushMirrorSync(workSlug);
  const result = await waitForPushMirrorOutcome(workSlug, existing?.lastUpdate ?? null);

  if (!result?.lastError) {
    return { status: "synced" };
  }

  const db = getDb();
  const entry = await db.gitSyncQueueEntry.create({
    data: { projectId, status: "pending", reason: "push_failed" },
  });
  await sendMessage(
    projectId,
    null,
    `외부 저장소 동기화(발행)에 실패했습니다: ${result.lastError}\n\n` +
      `"docs git sync-proposal ${projectId} --out <dir>"로 변경 제안을 확인해 직접 반영하거나 충돌을 해소한 뒤, ` +
      `"docs git publish-queue-done ${projectId} ${entry.id}"로 완료를 보고하세요 - 그래야 "동기화" 버튼이 다시 활성화됩니다.`,
  );
  return { status: "queued", queueEntryId: entry.id };
}

/** 이 프로젝트에 아직 처리 안 된(pending) 발행 큐 항목이 있는지 -
 * "동기화" 버튼을 비활성 상태로 유지할지 판단하는 데 쓴다. */
export async function getPendingPublishQueueEntry(projectId: string): Promise<{ id: string; reason: string } | null> {
  const db = getDb();
  const row = await db.gitSyncQueueEntry.findFirst({ where: { projectId, status: "pending" }, orderBy: { createdAt: "desc" } });
  return row ? { id: row.id, reason: row.reason } : null;
}

/** AI가 대기열 항목 처리를 마쳤다고 보고할 때 호출 - 요청한 프로젝트와
 * 실제 큐 항목의 프로젝트가 일치하는지 재확인한다(pushHookPrompts.ts의
 * transitionQueueEntry와 같은 이유 - 다른 프로젝트 권한으로 남의 큐
 * 항목을 건드리는 것 방지). */
export async function completePublishQueueEntry(id: string, projectId: string): Promise<void> {
  const db = getDb();
  const row = await db.gitSyncQueueEntry.findUnique({ where: { id } });
  if (!row || row.projectId !== projectId) throw new Error(`큐 항목을 찾을 수 없습니다: ${id}`);
  await db.gitSyncQueueEntry.update({ where: { id }, data: { status: "done" } });
}
