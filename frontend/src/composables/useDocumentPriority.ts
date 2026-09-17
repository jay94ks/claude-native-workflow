import { ref, type Ref } from "vue";
import { apiCall, ApiError } from "../api/client";

/** 문서 우선순위 저장(#67 관심사 분리) - `doc`은 로드 관심사(부모)가
 * 소유한 ref를 그대로 전달받아 저장 응답을 병합한다(transition()과
 * 같은 이유 - priority 응답에도 perm이 없어 통째로 바꿔치면 안 됨).
 * useDocumentStatus와 같은 패턴(상위 ref를 매개변수로 공유). */
export function useDocumentPriority<T extends object>(trackingCode: () => string, doc: Ref<T | null>) {
  const priorityInput = ref<string | number>("");
  const priorityError = ref("");
  const savingPriority = ref(false);

  async function savePriority() {
    // v-model이 type="number" 입력에는 값을 문자열이 아니라 숫자로
    // 자동 캐스팅한다(Vue 3 - .number 수식어 없이도) - 그래서 빈 값이면
    // ""(문자열)로 남고, 뭔가 입력되면 숫자로 바뀐다. 둘 다 안전하게
    // 처리한다.
    const raw = priorityInput.value;
    const priority = Number(raw);
    if (raw === "" || !Number.isInteger(priority)) {
      priorityError.value = "정수를 입력하세요";
      return;
    }
    savingPriority.value = true;
    priorityError.value = "";
    try {
      const updated = await apiCall<T>(`/documents/${trackingCode()}/priority`, {
        method: "PUT",
        body: JSON.stringify({ priority }),
      });
      doc.value = doc.value ? { ...doc.value, ...updated } : updated;
    } catch (err) {
      priorityError.value = err instanceof ApiError ? err.message : "우선순위 저장에 실패했습니다";
    } finally {
      savingPriority.value = false;
    }
  }

  function reset() {
    priorityError.value = "";
  }

  return { priorityInput, priorityError, savingPriority, savePriority, reset };
}
