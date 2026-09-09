export type FrontmatterValue = string | boolean | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export type DocMeta = Frontmatter & {
  id?: string;
  type?: string;
  title?: string;
  status?: string;
  created?: string;
  updated?: string;
  links?: string[];
  reply_pending?: boolean;
  target?: string;
};

export interface PendingOption {
  kind: "권장" | "대안";
  text: string;
}

export interface PendingQuestion {
  qid: string;
  question: string;
  options: PendingOption[];
}

export interface PendingItem {
  doc_path: string;
  doc_id: string;
  title: string;
  question_id: string;
  question: string;
  options: PendingOption[];
  updated: string;
}

export interface DocListItem {
  path: string;
  id: string;
  title: string;
  type: string;
  status: string;
  updated: string;
  reply_pending: boolean;
  target: string;
}

export interface Violation {
  path: string;
  field: string;
  rule: string;
  message: string;
}

export interface TreeNode {
  name: string;
  type: "dir" | "file";
  children?: TreeNode[];
  path?: string;
  id?: string;
  title?: string;
  doc_type?: string;
  status?: string;
}

export const TYPE_NAMES: Record<string, string> = {
  IX: "최상위 색인", SP: "설계 명세", PL: "실행 계획", DN: "결과 보고",
  DS: "설계", RM: "기억 지시", TP: "임시 문서", DC: "결정 요청",
  RV: "검토 요청", FX: "수정 검토", LG: "처리 기록", RP: "답변 항목",
};

export const DESIGN_TYPES = new Set(["DC", "RV", "FX"]);
