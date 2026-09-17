import { ref } from "vue";
import { apiCall, ApiError } from "../api/client";

interface BranchLink {
  id: string;
  branchName: string;
}

/** 문서와 연결된 git 브랜치(#67 관심사 분리) - 독립적인 관심사, 다른
 * 관심사의 ref를 참조하지 않는다. 원래 DocumentEditorView.vue의 라우트
 * 재사용 리셋 로직(교차 참조 전수 조사로 발견)이 이 관심사의 상태
 * (branchLinksError/newBranchName)는 리셋 목록에서 빠뜨리고 있어서
 * 다른 문서로 이동해도 이전 문서의 에러 메시지가 잠깐 남아있을 수
 * 있었다 - 여기 `reset()`으로 옮기며 호출부가 다른 관심사와 동일하게
 * 빠짐없이 호출하도록 정리했다(실질적 버그 수정, #67 분리의 자연스러운
 * 부산물). */
export function useDocumentBranchLinks(trackingCode: () => string) {
  const branchLinks = ref<BranchLink[]>([]);
  const branchLinksError = ref("");
  const newBranchName = ref("");

  async function loadBranchLinks() {
    try {
      branchLinks.value = await apiCall<BranchLink[]>(`/documents/${trackingCode()}/branch-links`);
    } catch {
      branchLinks.value = [];
    }
  }

  async function addBranchLink() {
    const branchName = newBranchName.value.trim();
    if (!branchName) return;
    branchLinksError.value = "";
    try {
      await apiCall(`/documents/${trackingCode()}/branch-links`, {
        method: "POST",
        body: JSON.stringify({ branchName }),
      });
      newBranchName.value = "";
      await loadBranchLinks();
    } catch (err) {
      branchLinksError.value = err instanceof ApiError ? err.message : "연결에 실패했습니다";
    }
  }

  async function removeBranchLink(id: string) {
    branchLinksError.value = "";
    try {
      await apiCall(`/document-branch-links/${id}?trackingCode=${encodeURIComponent(trackingCode())}`, { method: "DELETE" });
      await loadBranchLinks();
    } catch (err) {
      branchLinksError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
    }
  }

  function reset() {
    branchLinksError.value = "";
    newBranchName.value = "";
  }

  return { branchLinks, branchLinksError, newBranchName, loadBranchLinks, addBranchLink, removeBranchLink, reset };
}
