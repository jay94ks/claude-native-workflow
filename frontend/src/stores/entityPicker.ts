import { defineStore } from "pinia";

// 범용 엔티티 선택기 - "이미 존재하는 무언가"를 설계자가 입력해야 하는
// 모든 자리(칸반 카드 근거, 질문 근거, 접근 권한 대상 문서, 멤버/팀장
// 추가 대상 사용자, 문서의 연관 소스 코드)가 이 스토어 하나를 공유한다.
// documentDialog.ts류의 "보여주기만" 패턴과 달리 값을 반환해야 하므로
// Promise 기반: pick()을 부른 쪽이 사용자의 확인/취소를 그대로 기다린다.

export type EntityPickerKind = "document" | "user" | "sourceFile";

export interface EntityPickerOptions {
  kind: EntityPickerKind;
  // document/sourceFile 종류는 프로젝트 스코프 조회가 필요하지만,
  // user 종류(예: 팀장 추가)는 프로젝트 컨텍스트가 없는 화면에서도
  // 써야 해서 선택 필드로 둔다.
  projectId?: string;
  multi?: boolean;
  allowManualEntry?: boolean;
  initialSelected?: string[];
  title?: string;
}

type Resolver = (value: string[] | null) => void;
let pendingResolve: Resolver | null = null;

export const useEntityPickerStore = defineStore("entityPicker", {
  state: () => ({
    open: false,
    options: null as (EntityPickerOptions & { multi: boolean; allowManualEntry: boolean; initialSelected: string[] }) | null,
  }),
  actions: {
    pick(options: EntityPickerOptions): Promise<string[] | null> {
      // 이전 pick이 아직 안 끝났으면(이론상 발생 안 함 - 다이얼로그가
      // 하나뿐이라 순차적으로만 열림) 취소로 정리하고 새로 시작.
      if (pendingResolve) {
        pendingResolve(null);
        pendingResolve = null;
      }
      this.options = {
        multi: false,
        allowManualEntry: false,
        initialSelected: [],
        ...options,
      };
      this.open = true;
      return new Promise<string[] | null>((resolve) => {
        pendingResolve = resolve;
      });
    },
    confirm(value: string[]): void {
      this.open = false;
      pendingResolve?.(value);
      pendingResolve = null;
    },
    cancel(): void {
      this.open = false;
      pendingResolve?.(null);
      pendingResolve = null;
    },
  },
});
