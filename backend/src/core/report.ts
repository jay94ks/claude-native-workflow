import { createDocument, addDocumentLink, type DocumentDetail } from "./documents.js";

const REPORT_TYPE_CODE = "DN";

// 옛 시스템의 "PL → DN 전환"과 같은 "구조화된 생성" 패턴을 일반화한
// 것 - 문서 생성 API 위에 "보고서"라는 이름을 붙인 얇은 래퍼일 뿐,
// 새 테이블은 없다(DN 타입 자체가 문서 타입 체계 안에 이미 있음).
export interface CreateReportInput {
  projectId: string;
  title: string;
  body: string;
  createdBy: string;
  links?: string[]; // 요약 대상이 된 다른 문서들의 trackingCode
}

export async function createReport(input: CreateReportInput): Promise<DocumentDetail> {
  const report = await createDocument({
    projectId: input.projectId,
    docTypeCode: REPORT_TYPE_CODE,
    title: input.title,
    body: input.body,
    createdBy: input.createdBy,
  });
  for (const target of input.links ?? []) {
    await addDocumentLink(report.trackingCode, target);
  }
  return report;
}
