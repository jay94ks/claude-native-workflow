import { defineStore } from "pinia";

// 문서 페이지의 "폴더" 버튼(단건 이동)과 문서 탭의 "일괄 폴더 이동"
// 둘 다 이 스토어 하나를 공유한다 - entityPicker.ts와 동일한 Promise
// 기반 패턴이지만 반환값이 세 가지로 갈린다: undefined(취소),
// null(명시적으로 "폴더 없음" 선택), string(선택한 폴더 id).

type Resolver = (value: string | null | undefined) => void;
let pendingResolve: Resolver | null = null;

export const useFolderPickerStore = defineStore("folderPicker", {
  state: () => ({
    open: false,
    projectId: "",
  }),
  actions: {
    pick(projectId: string): Promise<string | null | undefined> {
      if (pendingResolve) {
        pendingResolve(undefined);
        pendingResolve = null;
      }
      this.projectId = projectId;
      this.open = true;
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    },
    confirm(folderId: string | null): void {
      this.open = false;
      pendingResolve?.(folderId);
      pendingResolve = null;
    },
    cancel(): void {
      this.open = false;
      pendingResolve?.(undefined);
      pendingResolve = null;
    },
  },
});
