// docs.grep / docs.search의 `grep` 파라미터 - PostgreSQL의 POSIX ERE(`~`)를
// 그대로 위임한다(design-notes.md "Meilisearch 활용 최적화 방안" -
// "docs.grep과 동일한 POSIX 정규식"). JS 정규식이 아니라 실제 Postgres
// 엔진에 매칭을 맡겨서 진짜 POSIX ERE 문법을 지원한다.

import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

export interface GrepMatch {
  line: number;
  text: string;
}

/** 문서 하나 안에서 패턴에 매칭되는 줄만 발췌한다. */
export async function grepDocument(content: string, pattern: string): Promise<GrepMatch[]> {
  const rows = await prisma.$queryRaw<{ line_no: number; line: string }[]>(
    Prisma.sql`
      SELECT ordinality::int AS line_no, value AS line
      FROM unnest(string_to_array(${content}::text, E'\n')) WITH ORDINALITY AS t(value, ordinality)
      WHERE value ~ ${pattern}
      ORDER BY ordinality
    `
  );
  return rows.map((r) => ({ line: r.line_no, text: r.line }));
}

/**
 * docs.search의 grep 모드 - 프로젝트 안에서 title/content가 패턴에
 * 매칭되는 문서 id들(구조화 필터는 호출 쪽에서 이 id 목록에 대해
 * Prisma로 다시 좁힌다 - 정규식만 raw SQL로 위임).
 */
export async function grepProjectDocumentIds(projectId: string, pattern: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id FROM "Document"
      WHERE "projectId" = ${projectId}
        AND (title ~ ${pattern} OR content ~ ${pattern})
      ORDER BY "createdAt" DESC
    `
  );
  return rows.map((r) => r.id);
}
