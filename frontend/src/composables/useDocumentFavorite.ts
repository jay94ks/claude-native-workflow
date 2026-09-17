import { ref } from "vue";
import { apiCall, ApiError } from "../api/client";

/** 문서 즐겨찾기 토글(#document-favorites) - DocumentEditorView.vue의
 * 9개 관심사 분리(BL-57F8DF17 #67) 중 하나. 실패 시 토스트/배너 표시는
 * 이 composable이 직접 하지 않고 `onError` 콜백으로 위임한다 - 호출부
 * (DocumentEditorView)가 자기 소유의 공용 에러 배너(`error` ref)에
 * 넣을지 여부를 결정하게 해, 이 composable이 다른 관심사의 ref를
 * 직접 건드리지 않도록(원래 코드는 `error.value`를 직접 썼음 - 교차
 * 참조였다). */
export function useDocumentFavorite(trackingCode: () => string, onError?: (message: string) => void) {
  const favorited = ref(false);
  const favoriteToggling = ref(false);

  async function loadFavorite() {
    try {
      const result = await apiCall<{ favorited: boolean }>(`/documents/${trackingCode()}/favorite`);
      favorited.value = result.favorited;
    } catch {
      favorited.value = false;
    }
  }

  async function toggleFavorite() {
    if (favoriteToggling.value) return;
    const next = !favorited.value;
    favoriteToggling.value = true;
    try {
      await apiCall(`/documents/${trackingCode()}/favorite`, {
        method: "PUT",
        body: JSON.stringify({ favorited: next }),
      });
      favorited.value = next;
    } catch (err) {
      onError?.(err instanceof ApiError ? err.message : "즐겨찾기 변경에 실패했습니다");
    } finally {
      favoriteToggling.value = false;
    }
  }

  return { favorited, favoriteToggling, loadFavorite, toggleFavorite };
}
