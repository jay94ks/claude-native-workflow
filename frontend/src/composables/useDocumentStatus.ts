import { ref, type Ref } from "vue";
import { apiCall, ApiError } from "../api/client";

interface NextStatus {
  code: string;
  label: string;
  guideline: string | null;
}

/** 문서 상태 전이(#67 관심사 분리) - `doc`은 로드 관심사(부모)가 소유한
 * ref를 그대로 전달받아 전이 응답을 병합한다(전이 응답엔 perm이 없어
 * 통째로 바꿔치면 doc.perm이 undefined가 돼 v-if="doc.perm.write"가
 * 깨짐 - 원본 코드에서 실측 발견된 이유를 그대로 보존). Vue composable이
 * 상위 컴포넌트의 ref를 매개변수로 받아 공유하는 건 표준 패턴이라
 * "다른 관심사의 ref를 몰래 건드리는" 교차 참조와는 다르다 - 이
 * 관심사가 doc을 갱신해야 한다는 게 명시적인 계약이 됨. */
export function useDocumentStatus<T extends { statusCode: string }>(trackingCode: () => string, doc: Ref<T | null>) {
  const nextStatuses = ref<NextStatus[]>([]);
  const toStatusCode = ref("");
  const transitionError = ref("");

  async function loadNextStatuses() {
    try {
      nextStatuses.value = await apiCall<NextStatus[]>(`/documents/${trackingCode()}/next-statuses`);
    } catch {
      nextStatuses.value = [];
    }
  }

  async function transition() {
    if (!toStatusCode.value) return;
    transitionError.value = "";
    try {
      const updated = await apiCall<T>(`/documents/${trackingCode()}/transition`, {
        method: "POST",
        body: JSON.stringify({ toStatusCode: toStatusCode.value }),
      });
      doc.value = doc.value ? { ...doc.value, ...updated } : updated;
      toStatusCode.value = "";
      await loadNextStatuses();
    } catch (err) {
      transitionError.value = err instanceof ApiError ? err.message : "상태 전이에 실패했습니다";
    }
  }

  // QAPanel에서 답변으로 인한 자동 상태 전이가 일어났을 때만 씀 - 전체
  // load()와 달리 상단 상태 배지만 조용히 갱신한다(QAPanel의 답변 API
  // 응답에 이미 새 상태 코드가 있으니 재조회 안 함 - Meilisearch 색인
  // 반영 지연으로 옛 상태가 잠깐 다시 보이는 걸 피하려고, fetchDocument
  // 재시도 패턴과 같은 이유).
  function refreshStatus(statusCode: string) {
    if (doc.value) doc.value.statusCode = statusCode;
    loadNextStatuses();
  }

  function reset() {
    toStatusCode.value = "";
    transitionError.value = "";
  }

  return { nextStatuses, toStatusCode, transitionError, loadNextStatuses, transition, refreshStatus, reset };
}
