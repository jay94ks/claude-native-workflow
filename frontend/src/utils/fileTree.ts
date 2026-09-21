export interface TreeNode {
  label: string;
  nodeKey: string;
  isFile: boolean;
  status?: string;
  children?: TreeNode[];
}

export interface FileTreeInput {
  path: string;
  status?: string;
}

// 설계자 요청(2026-09-21) - 변경된 파일 목록을 평평한 경로 배열이 아니라
// 디렉터리 구조를 살린 트리(q-tree)로 보여준다. PullRequestsTab.vue와
// CommitDiffPage.vue가 동일한 로직을 각자 갖고 있던 것을 통합.
export function buildFileTree(files: FileTreeInput[]): TreeNode[] {
  interface Draft {
    label: string;
    nodeKey: string;
    isFile: boolean;
    status?: string;
    children: Map<string, Draft>;
  }
  const root: Draft = { label: "", nodeKey: "", isFile: false, children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    let acc = "";
    parts.forEach((part, idx) => {
      acc = acc ? `${acc}/${part}` : part;
      const isFile = idx === parts.length - 1;
      if (!cur.children.has(part)) {
        cur.children.set(part, { label: part, nodeKey: acc, isFile, status: isFile ? f.status : undefined, children: new Map() });
      }
      cur = cur.children.get(part)!;
    });
  }
  function toArray(draft: Draft): TreeNode[] {
    return [...draft.children.values()]
      .sort((a, b) => Number(a.isFile) - Number(b.isFile) || a.label.localeCompare(b.label))
      .map((d) => ({ label: d.label, nodeKey: d.nodeKey, isFile: d.isFile, status: d.status, children: d.isFile ? undefined : toArray(d) }));
  }
  return toArray(root);
}
