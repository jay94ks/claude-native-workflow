// Pull request/커밋 diff 뷰어(설계자 요청, 2026-09-21)의 좌(변경 전)/우(변경
// 후) 분할 렌더링을 위한 순수 계산 - 실제 렌더링은 components/DiffViewer.vue.
// 라인 단위 diff 자체는 "diff" npm 패키지(diffLines, Myers 알고리즘)에
// 맡기고, 여기서는 그 결과를 "좌우 정렬된 행" + "변경 지점 앞뒤 컨텍스트만
// 남기고 나머지는 접어서 버튼으로 펼치는" 형태로 가공한다.

import { diffLines } from "diff";

export interface DiffRow {
  oldLineNo: number | null;
  oldText: string | null;
  oldChanged: boolean;
  newLineNo: number | null;
  newText: string | null;
  newChanged: boolean;
}

export type DiffBlock = { kind: "visible"; rows: DiffRow[] } | { kind: "collapsible"; rows: DiffRow[] };

function isEqualRow(row: DiffRow): boolean {
  return !row.oldChanged && !row.newChanged;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // trailing newline이면 split 결과 마지막에 빈 문자열이 하나 더 생기는데,
  // 그건 "다음 줄"이 아니라 그냥 파일 끝 개행 표시일 뿐이라 줄로 세지 않는다.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** oldText/newText 전체를 좌우 정렬된 행(DiffRow[])으로 바꾼다. */
function buildRows(oldText: string, newText: string): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldLineNo = 1;
  let newLineNo = 1;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      for (const line of splitLines(part.value)) {
        rows.push({ oldLineNo, oldText: line, oldChanged: false, newLineNo, newText: line, newChanged: false });
        oldLineNo++;
        newLineNo++;
      }
      continue;
    }

    if (part.removed) {
      const removedLines = splitLines(part.value);
      const next = parts[i + 1];
      const addedLines = next?.added ? splitLines(next.value) : [];
      const max = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < max; j++) {
        const oldLine = j < removedLines.length ? removedLines[j] : undefined;
        const newLine = j < addedLines.length ? addedLines[j] : undefined;
        rows.push({
          oldLineNo: oldLine !== undefined ? oldLineNo + j : null,
          oldText: oldLine ?? null,
          oldChanged: oldLine !== undefined,
          newLineNo: newLine !== undefined ? newLineNo + j : null,
          newText: newLine ?? null,
          newChanged: newLine !== undefined,
        });
      }
      oldLineNo += removedLines.length;
      newLineNo += addedLines.length;
      if (next?.added) i++; // added part already consumed above
      continue;
    }

    // added part not preceded by removed (pure addition).
    if (part.added) {
      for (const line of splitLines(part.value)) {
        rows.push({ oldLineNo: null, oldText: null, oldChanged: false, newLineNo, newText: line, newChanged: true });
        newLineNo++;
      }
    }
  }

  return rows;
}

/**
 * 위에서 만든 flat한 행 목록에서, 변경 지점 앞뒤로 `context`줄만 보여주고
 * 그 사이 안 바뀐 구간이 길면 접어서(`collapsible`) 버튼으로 펼칠 수 있게
 * 블록 단위로 나눈다. 파일 맨 앞/맨 뒤의 "equal" 구간은 반대쪽 끝에
 * 컨텍스트가 필요 없다(그 방향엔 diff가 없으므로).
 */
export function computeSplitDiffBlocks(oldText: string, newText: string, context = 6): DiffBlock[] {
  const rows = buildRows(oldText, newText);
  const blocks: DiffBlock[] = [];

  let i = 0;
  while (i < rows.length) {
    if (!isEqualRow(rows[i])) {
      // 변경된 행들을 통째로 하나의 visible 블록으로.
      const start = i;
      while (i < rows.length && !isEqualRow(rows[i])) i++;
      blocks.push({ kind: "visible", rows: rows.slice(start, i) });
      continue;
    }

    const start = i;
    while (i < rows.length && isEqualRow(rows[i])) i++;
    const run = rows.slice(start, i);
    const isFileStart = start === 0;
    const isFileEnd = i === rows.length;

    // 파일 맨 앞/뒤 구간은 반대쪽에 컨텍스트가 필요 없으니 기준이 context
    // 하나뿐이고(그 이상이면 나머지를 전부 접는다), 중간 구간은 양쪽에
    // context씩 필요하니 기준이 context*2다 - 파일 전체가 diff 없이
    // 통째로 하나의 run(=isFileStart && isFileEnd)이면 접을 변경 지점
    // 자체가 없으니 그냥 전부 보여준다.
    if (isFileStart && isFileEnd) {
      blocks.push({ kind: "visible", rows: run });
    } else if (isFileStart) {
      if (run.length <= context) {
        blocks.push({ kind: "visible", rows: run });
      } else {
        blocks.push({ kind: "collapsible", rows: run.slice(0, run.length - context) });
        blocks.push({ kind: "visible", rows: run.slice(run.length - context) });
      }
    } else if (isFileEnd) {
      if (run.length <= context) {
        blocks.push({ kind: "visible", rows: run });
      } else {
        blocks.push({ kind: "visible", rows: run.slice(0, context) });
        blocks.push({ kind: "collapsible", rows: run.slice(context) });
      }
    } else if (run.length <= context * 2) {
      blocks.push({ kind: "visible", rows: run });
    } else {
      blocks.push({ kind: "visible", rows: run.slice(0, context) });
      blocks.push({ kind: "collapsible", rows: run.slice(context, run.length - context) });
      blocks.push({ kind: "visible", rows: run.slice(run.length - context) });
    }
  }

  return blocks;
}
