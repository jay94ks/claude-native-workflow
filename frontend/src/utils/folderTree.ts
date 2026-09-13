// 평평한 폴더 목록을 parentFolderId 기준 중첩 트리로 조립하는 순수
// 함수 - FolderSelectTree.vue(문서 탭 좌측 선택 트리)와
// FolderPickerDialog.vue(읽기 전용 선택 트리) 둘 다 같은 로직을
// 재사용한다. 깊이 제한 없이
// 전체를 다 조립한다(예전 FolderTree.vue는 템플릿에서 2단계까지만
// 그려 손자 폴더가 안 보이는 버그가 있었음 - 이 함수 자체는 항상
// 전체 깊이를 만들어왔고, 문제는 렌더링 쪽에만 있었다). 호출자가
// expanded/documents 같은 UI 전용 필드를 미리 얹어서 넘기면 그대로
// 트리 노드에 실려 나온다(제네릭이라 필드를 가리지 않음).

export interface FolderTreeNode<T extends { id: string; parentFolderId: string | null }> {
  children: (T & FolderTreeNode<T>)[];
}

export function buildFolderTree<T extends { id: string; parentFolderId: string | null }>(
  flat: T[],
): (T & FolderTreeNode<T>)[] {
  const byParent = new Map<string | null, (T & FolderTreeNode<T>)[]>();
  const nodes: (T & FolderTreeNode<T>)[] = flat.map((f) => ({ ...f, children: [] }));
  for (const n of nodes) {
    const list = byParent.get(n.parentFolderId) ?? [];
    list.push(n);
    byParent.set(n.parentFolderId, list);
  }
  for (const n of nodes) n.children = byParent.get(n.id) ?? [];
  return byParent.get(null) ?? [];
}

// FolderSelectTree.vue/FolderSelectNode.vue 전용 - 두 컴포넌트가 서로
// 재귀 참조하는 관계라 순환 import를 피하려고 타입을 여기 공용 파일에
// 둔다.
export interface FolderItem {
  id: string;
  parentFolderId: string | null;
  name: string;
  order: number;
  createdBy: string;
}

// "문서" 탭의 폴더 서브탭은 폴더를 눌러 "선택"만 하고(우측 패널이 그
// 폴더의 문서 목록을 페이지네이션해서 따로 불러옴), 폴더 자신은 문서
// 목록을 안 들고 있다(#documents-tab-redesign) - expanded(하위 폴더
// 펼침 여부)만 있으면 된다.
export interface SelectableFolderUiState {
  expanded: boolean;
}
export type SelectableFolder = FolderItem & SelectableFolderUiState;
export type SelectableFolderNode = SelectableFolder & FolderTreeNode<SelectableFolder>;

// "미분류 문서" 가상 항목의 선택값 - 실제 폴더 id와 절대 안 겹치는
// 고정 문자열(cuid가 아님). 여기 둔 이유: <script setup> SFC는 named
// export를 못 하므로, FolderSelectTree.vue/DocumentsView.vue 둘 다
// 이 순수 유틸 파일에서 가져다 쓴다.
export const UNFILED_SENTINEL = "__unfiled__";
