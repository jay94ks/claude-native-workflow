// 평평한 폴더 목록을 parentFolderId 기준 중첩 트리로 조립하는 순수
// 함수 - DocumentTree.vue(편집 가능한 트리)와 FolderPickerDialog.vue
// (읽기 전용 선택 트리) 둘 다 같은 로직을 재사용한다. 깊이 제한 없이
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

// DocumentTree.vue/FolderNode.vue 전용 - 편집 가능한(드래그/지연 로드
// 문서 목록을 갖는) 트리 노드 타입. 두 컴포넌트가 서로 재귀 참조하는
// 관계라 순환 import를 피하려고 타입을 여기 공용 파일에 둔다.
export interface FolderItem {
  id: string;
  parentFolderId: string | null;
  name: string;
  order: number;
  createdBy: string;
}
export interface FolderDocumentSummary {
  trackingCode: string;
  title: string;
  docTypeId: string;
}
export interface FolderUiState {
  expanded: boolean;
  // vuedraggable의 v-model 대상이라 항상 배열이어야 한다(null 불가) -
  // docsLoaded로 "아직 서버에서 안 받아옴"과 "받아왔는데 비어있음"을
  // 구분한다.
  documents: FolderDocumentSummary[];
  docsLoaded: boolean;
  loadingDocs: boolean;
  docsError: string;
}
export type AugmentedFolder = FolderItem & FolderUiState;
export type EditableFolderNode = AugmentedFolder & FolderTreeNode<AugmentedFolder>;
