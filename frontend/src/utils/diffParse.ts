// Gitea가 돌려주는 unified diff 텍스트(커밋 전체, 여러 파일이 섞여
// 있을 수 있음)를 파일 단위로 쪼갠다 - "변경 기록이 길어지면 구분이
// 안 된다"는 문제의 핵심 원인이 파일 경계가 전혀 안 보이는 것이라,
// 여기서 그 경계를 되살려 목록으로 렌더링할 수 있게 한다.

export type DiffLineKind = "add" | "del" | "ctx";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

function stripPrefix(path: string): string {
  if (path === "/dev/null") return path;
  const idx = path.indexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function parseFileBlock(block: string[]): FileDiff {
  let oldPath = "";
  let newPath = "";
  let binary = false;

  const headerMatch = (block[0] ?? "").match(/^diff --git a\/(.+) b\/(.+)$/);
  if (headerMatch) {
    oldPath = headerMatch[1];
    newPath = headerMatch[2];
  }

  let bodyStart = block.length;
  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    if (line.startsWith("--- ")) {
      const p = line.slice(4).trim();
      oldPath = p === "/dev/null" ? p : stripPrefix(p);
    } else if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      newPath = p === "/dev/null" ? p : stripPrefix(p);
      bodyStart = i + 1;
      break;
    } else if (/^Binary files .+ differ$/.test(line)) {
      binary = true;
      bodyStart = i + 1;
      break;
    }
  }

  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  let currentHunk: DiffHunk | null = null;
  for (let i = bodyStart; i < block.length; i++) {
    const line = block[i];
    if (line.startsWith("@@")) {
      currentHunk = { header: line, lines: [] };
      hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue; // index/mode/rename 등 hunk 밖 메타 줄은 건너뜀
    if (line.startsWith("+")) {
      currentHunk.lines.push({ kind: "add", text: line.slice(1) });
      additions++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ kind: "del", text: line.slice(1) });
      deletions++;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" - 표시 안 함
    } else {
      currentHunk.lines.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }

  return {
    oldPath: oldPath || "(알 수 없음)",
    newPath: newPath || "(알 수 없음)",
    binary,
    additions,
    deletions,
    hunks,
  };
}

export function parseUnifiedDiff(raw: string): FileDiff[] {
  if (!raw.trim()) return [];
  const lines = raw.split("\n");
  const fileStarts: number[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith("diff --git ")) fileStarts.push(i);
  });
  if (fileStarts.length === 0) return [parseFileBlock(lines)];

  const files: FileDiff[] = [];
  for (let i = 0; i < fileStarts.length; i++) {
    const start = fileStarts[i];
    const end = i + 1 < fileStarts.length ? fileStarts[i + 1] : lines.length;
    files.push(parseFileBlock(lines.slice(start, end)));
  }
  return files;
}
