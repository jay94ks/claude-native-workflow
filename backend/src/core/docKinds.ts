// design-notes.md "문서 분류(kind) 추가/수정 + 분류별 지침 관리" -
// doc 타입의 5개 기본 분류(SP/RP/RM/QA/BT, documentRules.ts
// KINDS_BY_TYPE)는 하드코딩된 기본값으로 남고, 이 파일은 프로젝트별
// 오버레이(라벨/지침 수정 + 완전히 새 분류 추가)만 다룬다. 다른
// type(plan/issue/tracker/test/question/answer/opinion)의 kind는
// 타입당 하나뿐인 구조적 상수라 이 기능의 대상이 아니다.

import { prisma } from "./prisma";
import { guardMembership, fail } from "./actionHelpers";
import { KINDS_BY_TYPE } from "./documentRules";
import type { ActionContext } from "./documents";
import type { ActionResult } from "./types";

export const DEFAULT_DOC_KIND_LABELS: Record<string, string> = {
  SP: "설계 명세",
  RP: "결과 보고",
  RM: "지시/지침 사항",
  QA: "QA 시나리오",
  BT: "돌파구",
};

const CODE_RE = /^[A-Z]{2,3}$/;

interface DocKindEntry {
  code: string;
  label: string;
  guideline: string;
  builtin: boolean;
}

/** docsAdd가 doc 타입 kind를 검증할 때 쓴다 - 기본 5개거나 이 프로젝트에 등록된 커스텀 분류면 유효. */
export async function isValidDocKind(projectId: string, kind: string): Promise<boolean> {
  if (KINDS_BY_TYPE.doc.includes(kind)) return true;
  const row = await prisma.documentKind.findUnique({ where: { projectId_code: { projectId, code: kind } } });
  return !!row;
}

export async function docKindList(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "READ");
  if (membershipFailure) return membershipFailure;

  const overrides = await prisma.documentKind.findMany({ where: { projectId: payload.projectId }, orderBy: { createdAt: "asc" } });
  const overrideByCode = new Map(overrides.map((o) => [o.code, o]));

  const items: DocKindEntry[] = KINDS_BY_TYPE.doc.map((code) => {
    const override = overrideByCode.get(code);
    return {
      code,
      label: override?.label ?? DEFAULT_DOC_KIND_LABELS[code] ?? code,
      guideline: override?.guideline ?? "",
      builtin: true,
    };
  });
  for (const o of overrides) {
    if (!KINDS_BY_TYPE.doc.includes(o.code)) {
      items.push({ code: o.code, label: o.label, guideline: o.guideline, builtin: false });
    }
  }

  return { ok: true, data: { items } };
}

export async function docKindSet(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "WRITE");
  if (membershipFailure) return membershipFailure;

  const { projectId, code, label, guideline } = payload;
  if (typeof code !== "string" || !CODE_RE.test(code)) return fail("code는 대문자 2~3자여야 합니다(예: SP, DOC).");
  if (typeof label !== "string" || !label) return fail("label이 필요합니다.");

  const saved = await prisma.documentKind.upsert({
    where: { projectId_code: { projectId, code } },
    create: { projectId, code, label, guideline: guideline ?? "" },
    update: { label, guideline: guideline ?? "" },
  });

  return {
    ok: true,
    data: { code: saved.code, label: saved.label, guideline: saved.guideline, builtin: KINDS_BY_TYPE.doc.includes(code) },
  };
}

export async function docKindDelete(payload: any, ctx: ActionContext): Promise<ActionResult> {
  const membershipFailure = await guardMembership(payload.projectId, ctx, "WRITE");
  if (membershipFailure) return membershipFailure;

  const { projectId, code } = payload;
  if (typeof code !== "string" || !code) return fail("code가 필요합니다.");

  // 기본 5개는 "삭제"가 아니라 오버라이드 초기화 - 분류 자체는 항상 유효해야
  // 이미 그 kind로 만들어진 문서들이 깨지지 않는다.
  if (KINDS_BY_TYPE.doc.includes(code)) {
    await prisma.documentKind.deleteMany({ where: { projectId, code } });
    return { ok: true };
  }

  // 커스텀 분류는 실제로 그 kind를 쓰는 문서가 있으면 삭제를 거부한다
  // (다른 곳의 "콘텐츠 보존" 판단과 동일한 원칙 - 참조 무결성을 앱
  // 레벨에서 지킨다).
  const inUse = await prisma.document.count({ where: { projectId, type: "doc", kind: code } });
  if (inUse > 0) return fail(`이 분류(${code})를 쓰는 문서가 ${inUse}건 있어 삭제할 수 없습니다.`);

  const result = await prisma.documentKind.deleteMany({ where: { projectId, code } });
  if (result.count === 0) return fail(`"${code}" 분류를 찾을 수 없습니다.`);
  return { ok: true };
}
