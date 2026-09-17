import { ref } from "vue";
import { apiCall, ApiError } from "../api/client";

/** 문서 화면의 "메시지로 지시" 작성 상태(#67 관심사 분리) - 다른
 * 관심사의 ref를 참조하지 않는 완전히 독립적인 관심사. `reset()`은
 * 사이드바에서 다른 문서로 이동할 때(같은 라우트 컴포넌트 재사용)
 * 호출부가 불러 이전 문서의 작성 중이던 메시지가 새 문서로 새어
 * 들어가지 않게 한다. */
export function useDocumentMessaging(projectId: () => string, trackingCode: () => string) {
  const messageDraft = ref("");
  const messageOpen = ref(false);
  const messageSending = ref(false);
  const messageError = ref("");
  const messageSent = ref(false);

  async function sendInstructionMessage() {
    if (!messageDraft.value.trim()) return;
    messageSending.value = true;
    messageError.value = "";
    try {
      await apiCall(`/projects/${projectId()}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: `[${trackingCode()}] ${messageDraft.value.trim()}` }),
      });
      messageDraft.value = "";
      messageOpen.value = false;
      messageSent.value = true;
      setTimeout(() => (messageSent.value = false), 3000);
    } catch (err) {
      messageError.value = err instanceof ApiError ? err.message : "전송에 실패했습니다";
    } finally {
      messageSending.value = false;
    }
  }

  function reset() {
    messageDraft.value = "";
    messageOpen.value = false;
    messageError.value = "";
    messageSent.value = false;
  }

  return { messageDraft, messageOpen, messageSending, messageError, messageSent, sendInstructionMessage, reset };
}
