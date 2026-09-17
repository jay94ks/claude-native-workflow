import { ref } from "vue";
import type { Router } from "vue-router";
import { apiCall, ApiError } from "../api/client";
import type { useEntityPickerStore } from "../stores/entityPicker";

interface SourceLink {
  id: string;
  filePath: string;
}

/** 문서와 연결된 소스 코드 파일 경로(#67 관심사 분리) - 독립적인
 * 관심사, 다른 관심사의 ref를 참조하지 않는다. */
export function useDocumentSourceLinks(
  projectId: () => string,
  trackingCode: () => string,
  router: Router,
  entityPicker: ReturnType<typeof useEntityPickerStore>,
) {
  const sourceLinks = ref<SourceLink[]>([]);
  const sourceLinksError = ref("");
  const newSourcePath = ref("");

  async function loadSourceLinks() {
    try {
      sourceLinks.value = await apiCall<SourceLink[]>(`/documents/${trackingCode()}/source-links`);
    } catch {
      sourceLinks.value = [];
    }
  }

  async function addSourceLink() {
    const filePath = newSourcePath.value.trim();
    if (!filePath) return;
    sourceLinksError.value = "";
    try {
      await apiCall(`/documents/${trackingCode()}/source-links`, {
        method: "POST",
        body: JSON.stringify({ filePath }),
      });
      newSourcePath.value = "";
      await loadSourceLinks();
    } catch (err) {
      sourceLinksError.value = err instanceof ApiError ? err.message : "연결에 실패했습니다";
    }
  }

  async function pickSourceLink() {
    const result = await entityPicker.pick({
      kind: "sourceFile",
      projectId: projectId(),
      multi: false,
      allowManualEntry: true,
    });
    if (result && result[0]) {
      newSourcePath.value = result[0];
      await addSourceLink();
    }
  }

  async function removeSourceLink(id: string) {
    sourceLinksError.value = "";
    try {
      await apiCall(`/document-source-links/${id}?trackingCode=${encodeURIComponent(trackingCode())}`, { method: "DELETE" });
      await loadSourceLinks();
    } catch (err) {
      sourceLinksError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
    }
  }

  function openSourceFile(filePath: string) {
    router.push(`/projects/${projectId()}/source?path=${encodeURIComponent(filePath)}`);
  }

  function reset() {
    sourceLinksError.value = "";
    newSourcePath.value = "";
  }

  return {
    sourceLinks,
    sourceLinksError,
    newSourcePath,
    loadSourceLinks,
    addSourceLink,
    pickSourceLink,
    removeSourceLink,
    openSourceFile,
    reset,
  };
}
