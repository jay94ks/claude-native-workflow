// project.create / get / list / update / invite / acceptInvite / transfer /
// destroy - 계정/프로젝트/권한 관리 (design-notes.md "회원가입/초대 절차",
// "프로젝트 공개/비공개 스코프", "프로젝트 설정 항목", "collaborator 권한").

import { prisma } from "./prisma";
import { requireMembership, MembershipError } from "./membership";
import { isSuperAdmin } from "./auth";
import { getActiveKeyScope } from "./requestScope";
import type { ActionResult } from "./types";
import type { ActionContext } from "./documents";

function fail(reason: string | string[]): ActionResult {
  return { ok: false, reason: Array.isArray(reason) ? reason : [reason] };
}

// 설계자 요청(2026-09-21 후속) - 웹 접속 path가 /{생성자 login명}/{project id}
// 형태라 모든 응답에 ownerUsername(=creator.username)이 실려야 프론트가 그
// 링크를 만들 수 있다 - 아래 모든 조회 쿼리가 `creator: { select: { username: true } }`를
// include해서 이 함수에 넘긴다.
function toProjectResponse(p: {
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  defaultBranch: string;
  messageTtlDefault: number;
  pushMirrorUrl: string | null;
  createdAt: Date;
  creator: { username: string };
}) {
  return {
    id: p.slug,
    name: p.name,
    description: p.description,
    visibility: p.visibility,
    defaultBranch: p.defaultBranch,
    messageTtlDefault: p.messageTtlDefault,
    pushMirrorUrl: p.pushMirrorUrl,
    createdAt: p.createdAt,
    ownerUsername: p.creator.username,
  };
}

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * 누구나 프로젝트를 만들 수 있고, 만든 사람이 그 프로젝트의 유일한 Admin이
 * 된다. `creatorAccountId`는 이후 project.transfer로 Admin이 넘어가도 안
 * 바뀐다(웹 접속 path의 소유자 segment는 항상 실제 생성자를 가리킨다).
 *
 * `id`(설계자가 직접 고르는 slug, 웹 URL의 두 번째 segment이자 CLI/API가
 * 부르는 "project id")는 설계자 요청(2026-09-21 후속) "프로젝트 id는
 * 설계자별로 관리되어야 한다"에 따라 전역 유일이 아니라 이 호출자
 * (creatorAccountId) 범위에서만 유일하면 된다 - 다른 설계자가 이미 같은
 * id를 쓰고 있어도 문제없다.
 */
export async function projectCreate(payload: any, ctx: ActionContext): Promise<ActionResult> {
  // docs/plan-nickname-apikey-policy.md - 새 프로젝트를 만드는 건 그
  // 정의상 "아직 없는" 프로젝트를 대상으로 하므로 특정 프로젝트로 좁힌
  // 키로는 애초에 의미가 없다(스코프 밖 행위) - personal 키로만 허용.
  if (getActiveKeyScope().type !== "unrestricted") {
    return fail("새 프로젝트 생성은 프로젝트로 범위가 제한된 API 키로는 할 수 없습니다.");
  }
  const { name, description, visibility, defaultBranch, id } = payload;
  if (typeof name !== "string" || !name) return fail("name이 필요합니다.");
  if (typeof id !== "string" || !id) return fail("id가 필요합니다.");
  if (!SLUG_PATTERN.test(id)) {
    return fail("id는 영문/숫자로 시작하고 영문/숫자/-/_ 만 포함하는 1~64자여야 합니다.");
  }
  if (visibility !== undefined && visibility !== "PUBLIC" && visibility !== "PRIVATE") {
    return fail('visibility는 "PUBLIC" 또는 "PRIVATE"여야 합니다.');
  }

  const existing = await prisma.project.findUnique({
    where: { creatorAccountId_slug: { creatorAccountId: ctx.architectId, slug: id } },
  });
  if (existing) return fail(`이미 "${id}"라는 id로 만든 프로젝트가 있습니다 - 다른 id를 골라주세요.`);

  const project = await prisma.project.create({
    data: {
      name,
      description: description ?? null,
      visibility: visibility ?? "PRIVATE",
      defaultBranch: defaultBranch ?? "main",
      creatorAccountId: ctx.architectId,
      slug: id,
    },
    include: { creator: { select: { username: true } } },
  });
  await prisma.projectMembership.create({ data: { projectId: project.id, accountId: ctx.architectId, role: "ADMIN" } });

  return { ok: true, data: toProjectResponse(project) };
}

export async function projectGet(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "READ");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { creator: { select: { username: true } } },
  });
  if (!project) return fail(`프로젝트 ${projectId}를 찾을 수 없습니다.`);

  // Phase 9 판단: WEB UI가 "이 사람이 지금 Admin/Write/Read 중 뭔지"를
  // 알아야 Danger Zone/초대 버튼 등을 조건부로 보여줄 수 있다 - public
  // 프로젝트를 비멤버로 읽는 경우엔 멤버십 자체가 없으니 null.
  const membership = await prisma.projectMembership.findUnique({
    where: { projectId_accountId: { projectId, accountId: ctx.architectId } },
  });

  return { ok: true, data: { ...toProjectResponse(project), myRole: membership?.role ?? null } };
}

/**
 * Phase 9 판단: collaborator 관리 화면을 만들려면 "지금 누가 이 프로젝트의
 * 멤버고 무슨 역할인지" 목록이 있어야 하는데, 설계 로드맵엔 이 조회
 * 액션이 없었다(초대/수락/양도만 있었음) - 화면을 실제로 동작하게
 * 만들다가 발견한 빠진 조각이라 이번 라운드에 추가한다.
 */
export async function projectMembers(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  try {
    await requireMembership(projectId, ctx.architectId, "READ");
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }

  const [memberships, invites] = await Promise.all([
    prisma.projectMembership.findMany({ where: { projectId }, include: { account: true } }),
    prisma.projectInvite.findMany({ where: { projectId, state: "PENDING" }, include: { account: true } }),
  ]);

  return {
    ok: true,
    data: {
      members: memberships.map((m) => ({ username: m.account.username, role: m.role })),
      pendingInvites: invites.map((i) => ({ username: i.account.username, role: i.role })),
    },
  };
}

/** 내가 속한 프로젝트 + public 프로젝트 전체. */
export async function projectList(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { page } = payload;
  const pageSize = 50;
  const pageNumber = typeof page === "number" && page > 0 ? page : 1;

  const where = {
    OR: [{ visibility: "PUBLIC" as const }, { memberships: { some: { accountId: ctx.architectId } } }],
  };

  const [total, items] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pageNumber - 1) * pageSize,
      take: pageSize,
      include: { creator: { select: { username: true } } },
    }),
  ]);

  // Phase 9 판단: 목록 카드에서도 "내 역할"을 바로 보여줄 수 있게(예: public
  // 프로젝트를 비멤버로 보는 중인지 구분) 멤버십을 한 번에 같이 조회한다.
  const memberships = await prisma.projectMembership.findMany({
    where: { accountId: ctx.architectId, projectId: { in: items.map((p) => p.id) } },
  });
  const roleByProjectId = new Map(memberships.map((m) => [m.projectId, m.role]));

  return {
    ok: true,
    data: { page: pageNumber, total, items: items.map((p) => ({ ...toProjectResponse(p), myRole: roleByProjectId.get(p.id) ?? null })) },
  };
}

async function requireAdmin(projectId: string, architectId: string): Promise<ActionResult | null> {
  try {
    await requireMembership(projectId, architectId, "ADMIN");
    return null;
  } catch (err) {
    if (err instanceof MembershipError) return fail(err.message);
    throw err;
  }
}

/** 프로젝트 설정(이름/설명/기본 브랜치/메시지 TTL override/visibility/push-mirror) - Admin만. */
export async function projectUpdate(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, name, description, defaultBranch, messageTtlDefault, visibility, pushMirrorUrl } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  const adminFailure = await requireAdmin(projectId, ctx.architectId);
  if (adminFailure) return adminFailure;

  if (visibility !== undefined && visibility !== "PUBLIC" && visibility !== "PRIVATE") {
    return fail('visibility는 "PUBLIC" 또는 "PRIVATE"여야 합니다.');
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return fail(`프로젝트 ${projectId}를 찾을 수 없습니다.`);

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      name: name ?? project.name,
      description: description === undefined ? project.description : description,
      defaultBranch: defaultBranch ?? project.defaultBranch,
      messageTtlDefault: typeof messageTtlDefault === "number" ? messageTtlDefault : project.messageTtlDefault,
      visibility: visibility ?? project.visibility,
      pushMirrorUrl: pushMirrorUrl === undefined ? project.pushMirrorUrl : pushMirrorUrl,
    },
    include: { creator: { select: { username: true } } },
  });

  return { ok: true, data: toProjectResponse(updated) };
}

/** 초대 - Admin만, Read/Write만 부여 가능(Admin은 project.transfer로만 넘어간다). */
export async function projectInvite(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, username, role } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  const adminFailure = await requireAdmin(projectId, ctx.architectId);
  if (adminFailure) return adminFailure;

  if (typeof username !== "string" || !username) return fail("username이 필요합니다.");
  if (role !== "READ" && role !== "WRITE") {
    return fail('role은 "READ" 또는 "WRITE"만 가능합니다 - Admin은 project.transfer로만 넘길 수 있습니다.');
  }

  const account = await prisma.account.findUnique({ where: { username } });
  if (!account) return fail(`계정 "${username}"을 찾을 수 없습니다.`);

  const existingMembership = await prisma.projectMembership.findUnique({
    where: { projectId_accountId: { projectId, accountId: account.id } },
  });
  if (existingMembership) return fail(`${username}은 이미 이 프로젝트의 collaborator입니다.`);

  const invite = await prisma.projectInvite.upsert({
    where: { projectId_accountId: { projectId, accountId: account.id } },
    update: { role, state: "PENDING" },
    create: { projectId, accountId: account.id, role },
  });

  return { ok: true, data: { id: invite.id } };
}

/**
 * Phase 9 판단(design-notes.md 기록): "나에게 온 초대"를 조회할 방법이
 * 없어서 Phase 9 WEB UI가 프로젝트 ID를 직접 입력받는 우회 UI로 대신
 * 했었다 - 그 빠진 조각을 이번 라운드에 채운다. 멤버십 없이도(초대는
 * 아직 멤버가 아닌 사람에게 오는 것이므로) 호출 가능해야 한다.
 */
export async function projectInvitesForMe(_payload: unknown, ctx: ActionContext): Promise<ActionResult> {
  const invites = await prisma.projectInvite.findMany({
    where: { accountId: ctx.architectId, state: "PENDING" },
    include: { project: { include: { creator: { select: { username: true } } } } },
  });

  // 설계자 요청(2026-09-21 후속) - project id는 이제 생성자별로만 유일하므로
  // 그 문자열(slug)만으로는 어느 프로젝트인지 알 수 없다 - owner(생성자
  // username)를 같이 실어야 accept-invite 호출도, 사람이 읽는 목록도 뜻이
  // 통한다(내부 cuid를 그대로 노출하던 예전 방식은 이제 의미가 없다).
  return {
    ok: true,
    data: {
      items: invites.map((i) => ({
        owner: i.project.creator.username,
        projectId: i.project.slug,
        projectName: i.project.name,
        role: i.role,
      })),
    },
  };
}

/** 초대받은 계정 본인만 수락할 수 있다 - 수락하는 순간 실제 ProjectMembership이 생긴다. */
export async function projectAcceptInvite(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");

  const invite = await prisma.projectInvite.findUnique({
    where: { projectId_accountId: { projectId, accountId: ctx.architectId } },
  });
  if (!invite || invite.state !== "PENDING") return fail("대기 중인 초대가 없습니다.");

  await prisma.$transaction([
    prisma.projectInvite.update({ where: { id: invite.id }, data: { state: "ACCEPTED" } }),
    prisma.projectMembership.create({ data: { projectId, accountId: ctx.architectId, role: invite.role } }),
  ]);

  return { ok: true };
}

/** 양도 - Admin만, 대상은 이미 이 프로젝트의 collaborator여야 한다("제한구역"). */
export async function projectTransfer(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, toUsername } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  const adminFailure = await requireAdmin(projectId, ctx.architectId);
  if (adminFailure) return adminFailure;

  if (typeof toUsername !== "string" || !toUsername) return fail("toUsername이 필요합니다.");
  const targetAccount = await prisma.account.findUnique({ where: { username: toUsername } });
  if (!targetAccount) return fail(`계정 "${toUsername}"을 찾을 수 없습니다.`);

  const targetMembership = await prisma.projectMembership.findUnique({
    where: { projectId_accountId: { projectId, accountId: targetAccount.id } },
  });
  if (!targetMembership) return fail(`${toUsername}은 아직 이 프로젝트의 collaborator가 아닙니다 - 먼저 초대하세요.`);
  if (targetAccount.id === ctx.architectId) return fail("이미 본인이 Admin입니다.");

  await prisma.$transaction([
    prisma.projectMembership.update({
      where: { projectId_accountId: { projectId, accountId: ctx.architectId } },
      data: { role: "WRITE" },
    }),
    prisma.projectMembership.update({
      where: { projectId_accountId: { projectId, accountId: targetAccount.id } },
      data: { role: "ADMIN" },
    }),
  ]);

  return { ok: true };
}

/**
 * docs/plan-account-management.md - `project.transfer`는 그 프로젝트
 * 안에서 Admin **역할**만 옮길 뿐, `Project.creatorAccountId`(웹 URL
 * `/{생성자}/{project id}`의 그 부분, `project.transfer`가 일부러
 * 안 건드리는 영구 필드)는 그대로 남는다는 걸 계정 삭제 기능을
 * 만들다가 재확인했다 - 즉 생성자 계정을 지우려면 이 필드 자체를
 * 다른 계정으로 옮기는 별도 경로가 있어야 한다(없으면 "content
 * preservation" 정책이 실행 불가능한 약속이 된다). 그 프로젝트의
 * Admin이거나 시스템 superAdmin이면 호출 가능(단일-Admin 프로젝트의
 * 그 Admin 계정 자체를 지우려는 상황엔 대상 계정이 이미 로그인을
 * 못 할 수도 있어 superAdmin 경로가 필요) - 대상은 이미 그 프로젝트의
 * collaborator여야 하고(project.transfer와 동일 전제), 대상 계정
 * 소유 범위에 같은 slug가 이미 있으면(`@@unique([creatorAccountId,
 * slug])`) 거부한다. URL이 실제로 바뀌므로 신중하게 다뤄야 하는
 * 작업이다고 판단 - 이 함수 자체는 Admin 역할은 건드리지 않는다
 * (필요하면 projectTransfer와 함께 쓴다).
 */
export async function projectTransferOwnership(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId, toUsername } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");

  const adminFailure = await requireAdmin(projectId, ctx.architectId);
  if (adminFailure && !(await isSuperAdmin(ctx.architectId))) return adminFailure;

  if (typeof toUsername !== "string" || !toUsername) return fail("toUsername이 필요합니다.");
  const targetAccount = await prisma.account.findUnique({ where: { username: toUsername } });
  if (!targetAccount) return fail(`계정 "${toUsername}"을 찾을 수 없습니다.`);

  const targetMembership = await prisma.projectMembership.findUnique({
    where: { projectId_accountId: { projectId, accountId: targetAccount.id } },
  });
  if (!targetMembership) return fail(`${toUsername}은 아직 이 프로젝트의 collaborator가 아닙니다 - 먼저 초대하세요.`);

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return fail("프로젝트를 찾을 수 없습니다.");
  if (project.creatorAccountId === targetAccount.id) return fail("이미 이 계정이 생성자입니다.");

  const collision = await prisma.project.findUnique({
    where: { creatorAccountId_slug: { creatorAccountId: targetAccount.id, slug: project.slug } },
  });
  if (collision) return fail(`${toUsername}은 이미 같은 id("${project.slug}")의 다른 프로젝트를 갖고 있습니다.`);

  await prisma.project.update({ where: { id: projectId }, data: { creatorAccountId: targetAccount.id } });
  return { ok: true, data: { newOwnerUsername: toUsername } };
}

/** 파기("제한구역") - Admin만, 프로젝트와 그 아래 전부(문서/멤버십/초대/메시지/remember)를 영구 삭제한다. */
export async function projectDestroy(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !projectId) return fail("projectId가 필요합니다.");
  const adminFailure = await requireAdmin(projectId, ctx.architectId);
  if (adminFailure) return adminFailure;

  await prisma.project.delete({ where: { id: projectId } });
  return { ok: true };
}
