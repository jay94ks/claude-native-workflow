import { ref } from "vue";
import { ApiError } from "../api/client";

/** `loading`/`error` ref 두 개를 만들고, `run()`으로 감싼 비동기
 * 작업의 try/catch/finally를 대신 처리한다 - 78개 vue 파일 중
 * 50여개가 각자 손으로 재구현하던 다음 패턴을 대체한다
 * (#frontend-async-action-composable, BL-57F8DF17 #68):
 *
 * ```ts
 * loading.value = true; error.value = "";
 * try { ... } catch (err) { error.value = err instanceof ApiError ? err.message : fallback; }
 * finally { loading.value = false; }
 * ```
 *
 * 데이터를 담을 ref는 이 composable이 대신 만들지 않는다 - 조회
 * 액션(결과를 어딘가에 대입)과 저장/삭제 액션(성공 여부만 필요)이
 * 섞여 있어, 하나의 "data ref"를 강제하면 후자에 안 맞는다. 대신
 * `run()`의 콜백 안에서 호출부가 직접 자기 ref에 대입한다. */
export function useAsyncAction() {
  const loading = ref(false);
  const error = ref("");

  async function run(fn: () => Promise<void>, fallbackMessage: string): Promise<boolean> {
    loading.value = true;
    error.value = "";
    try {
      await fn();
      return true;
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : fallbackMessage;
      return false;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, run };
}
