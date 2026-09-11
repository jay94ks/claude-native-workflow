import { defineStore } from "pinia";

// QAPanel/CommentsPanel을 각각 다이얼로그로 감싸는 컴포넌트 두 개를
// 따로 만드는 대신, panel 값으로 어느 패널을 끼워 넣을지만 가르는
// 단일 스토어+다이얼로그로 통일한다 - documentDialog.ts와 동일한 모양.
export type TargetPanel = "qa" | "comments";
export type TargetPanelType = "document" | "source" | "kanbanCard";

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
