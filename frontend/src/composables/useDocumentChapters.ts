import { ref } from "vue";
import { apiCall, ApiError } from "../api/client";
import type { useConfirmDialogStore } from "../stores/confirmDialog";

export interface ChapterInfo {
  ordinal: number;
  level: number;
  heading: string;
  lineStart: number;
  lineEnd: number;
}
interface ChapterMutationResult {
  chapters: ChapterInfo[];
}

/** 문서 본문의 챕터(헤딩 섹션) CRUD(#document-chapters, #67 관심사
 * 분리). 챕터를 쓰면(교체/삽입/삭제) "보기"/"편집" 탭이 보는 doc.body/
 * body도 최신화해야 하는 교차 참조가 있다(전수 조사로 이미 알려진
 * 유일한 원래 발견) - 이 composable은 그 ref들을 직접 건드리지 않고
 * `onBodyChanged` 콜백을 통해서만 요청한다(호출부인
 * DocumentEditorView가 자기 소유 상태를 어떻게 갱신할지 결정). */
export function useDocumentChapters(
  trackingCode: () => string,
  confirmDialog: ReturnType<typeof useConfirmDialogStore>,
  onBodyChanged: () => Promise<void>,
) {
  const chapters = ref<ChapterInfo[]>([]);
  const chaptersLoading = ref(false);
  const chaptersError = ref("");
  const chaptersLoaded = ref(false);

  const editingChapterOrdinal = ref<number | null>(null);
  const editingChapterContent = ref("");
  const editingChapterLoading = ref(false);
  const editingChapterSaving = ref(false);
  const editingChapterError = ref("");

  const addingChapter = ref(false);
  const addChapterContent = ref("");
  const addChapterPosition = ref<"atStart" | "atEnd" | "after" | "before">("atEnd");
  const addChapterRelativeOrdinal = ref<number | "">("");
  const addChapterSaving = ref(false);
  const addChapterError = ref("");

  function chapterLabel(c: ChapterInfo): string {
    return c.heading || (c.level === 0 ? "(제목 없음)" : `(제목 없는 ${"#".repeat(c.level)} 헤딩)`);
  }

  async function loadChapters() {
    chaptersLoading.value = true;
    chaptersError.value = "";
    try {
      chapters.value = await apiCall<ChapterInfo[]>(`/documents/${trackingCode()}/chapters`);
      chaptersLoaded.value = true;
    } catch (err) {
      chaptersError.value = err instanceof ApiError ? err.message : "챕터 목록을 불러오지 못했습니다";
    } finally {
      chaptersLoading.value = false;
    }
  }

  function ensureChaptersLoaded() {
    if (!chaptersLoaded.value) loadChapters();
  }

  async function startEditChapter(ordinal: number) {
    addingChapter.value = false;
    editingChapterOrdinal.value = ordinal;
    editingChapterContent.value = "";
    editingChapterError.value = "";
    editingChapterLoading.value = true;
    try {
      const result = await apiCall<{ chapter: ChapterInfo; content: string }>(`/documents/${trackingCode()}/chapters/${ordinal}`);
      editingChapterContent.value = result.content;
    } catch (err) {
      editingChapterError.value = err instanceof ApiError ? err.message : "챕터 내용을 불러오지 못했습니다";
    } finally {
      editingChapterLoading.value = false;
    }
  }

  function cancelEditChapter() {
    editingChapterOrdinal.value = null;
    editingChapterContent.value = "";
    editingChapterError.value = "";
  }

  async function saveEditChapter() {
    if (editingChapterOrdinal.value === null) return;
    editingChapterSaving.value = true;
    editingChapterError.value = "";
    try {
      const result = await apiCall<ChapterMutationResult>(`/documents/${trackingCode()}/chapters/${editingChapterOrdinal.value}`, {
        method: "PUT",
        body: JSON.stringify({ content: editingChapterContent.value }),
      });
      chapters.value = result.chapters;
      cancelEditChapter();
      await onBodyChanged();
    } catch (err) {
      editingChapterError.value = err instanceof ApiError ? err.message : "저장에 실패했습니다";
    } finally {
      editingChapterSaving.value = false;
    }
  }

  async function deleteChapter(ordinal: number) {
    const chapter = chapters.value.find((c) => c.ordinal === ordinal);
    const confirmed = await confirmDialog.confirm(`"${chapter ? chapterLabel(chapter) : ordinal}" 챕터를 삭제하시겠습니까?`);
    if (!confirmed) return;
    chaptersError.value = "";
    try {
      const result = await apiCall<ChapterMutationResult>(`/documents/${trackingCode()}/chapters/${ordinal}`, { method: "DELETE" });
      chapters.value = result.chapters;
      if (editingChapterOrdinal.value === ordinal) cancelEditChapter();
      await onBodyChanged();
    } catch (err) {
      chaptersError.value = err instanceof ApiError ? err.message : "삭제에 실패했습니다";
    }
  }

  function startAddChapter() {
    cancelEditChapter();
    addingChapter.value = true;
    addChapterContent.value = "";
    addChapterPosition.value = "atEnd";
    addChapterRelativeOrdinal.value = "";
    addChapterError.value = "";
  }

  function cancelAddChapter() {
    addingChapter.value = false;
  }

  async function saveAddChapter() {
    if (!addChapterContent.value.trim()) return;
    if ((addChapterPosition.value === "after" || addChapterPosition.value === "before") && addChapterRelativeOrdinal.value === "") {
      addChapterError.value = "기준 챕터 번호를 입력하세요";
      return;
    }
    addChapterSaving.value = true;
    addChapterError.value = "";
    try {
      const payload: Record<string, unknown> = { content: addChapterContent.value };
      if (addChapterPosition.value === "atStart") payload.atStart = true;
      else if (addChapterPosition.value === "atEnd") payload.atEnd = true;
      else if (addChapterPosition.value === "after") payload.after = Number(addChapterRelativeOrdinal.value);
      else if (addChapterPosition.value === "before") payload.before = Number(addChapterRelativeOrdinal.value);
      const result = await apiCall<ChapterMutationResult>(`/documents/${trackingCode()}/chapters`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      chapters.value = result.chapters;
      addingChapter.value = false;
      await onBodyChanged();
    } catch (err) {
      addChapterError.value = err instanceof ApiError ? err.message : "추가에 실패했습니다";
    } finally {
      addChapterSaving.value = false;
    }
  }

  function reset() {
    chapters.value = [];
    chaptersLoaded.value = false;
    chaptersError.value = "";
    cancelEditChapter();
    cancelAddChapter();
  }

  return {
    chapters,
    chaptersLoading,
    chaptersError,
    chaptersLoaded,
    editingChapterOrdinal,
    editingChapterContent,
    editingChapterLoading,
    editingChapterSaving,
    editingChapterError,
    addingChapter,
    addChapterContent,
    addChapterPosition,
    addChapterRelativeOrdinal,
    addChapterSaving,
    addChapterError,
    chapterLabel,
    loadChapters,
    ensureChaptersLoaded,
    startEditChapter,
    cancelEditChapter,
    saveEditChapter,
    deleteChapter,
    startAddChapter,
    cancelAddChapter,
    saveAddChapter,
    reset,
  };
}
