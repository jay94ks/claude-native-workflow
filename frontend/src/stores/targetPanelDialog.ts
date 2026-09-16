import { defineStore } from "pinia";

// QAPanel/CommentsPanel/OpinionsPanel을 각각 다이얼로그로 감싸는
// 컴포넌트를 따로 만드는 대신, panel 값으로 어느 패널을 끼워 넣을지만
// 가르는 단일 스토어+다이얼로그로 통일한다 - documentDialog.ts와
// 동일한 모양. targetType은 세 패널이 실제로 쓰는 값의 합집합(패널마다
// 실제로 유효한 부분집합은 다름 - qa/comments는 document/source/
// kanbanCard, opinion은 document/plan).
export type TargetPanel = "qa" | "comments" | "opinion";
export type TargetPanelType = "document" | "source" | "kanbanCard" | "plan";

export const useTargetPanelDialogStore = defineStore("targetPanelDialog", {
  state: () => ({
    open: false,
    panel: "qa" as TargetPanel,
    projectId: null as string | null,
    targetType: "document" as TargetPanelType,
    targetKey: null as string | null,
  }),
  actions: {
    show(panel: TargetPanel, projectId: string, targetType: TargetPanelType, targetKey: string): void {
      this.panel = panel;
      this.projectId = projectId;
      this.targetType = targetType;
      this.targetKey = targetKey;
      this.open = true;
    },
    close(): void {
      this.open = false;
    },
  },
});
