// git 저장소 경로는 OS와 무관하게 항상 "/"를 구분자로 쓴다(Gitea
// 트리/blob 조회 결과도 항상 이 형식) - 하지만 이 경로를 받는 입력
// (CLI/MCP 호출 인자, 웹 폼 등)은 호출 환경에 따라 Windows 스타일
// "\"가 섞여 들어올 수 있다(실측 - 설계자가 Windows에서 `docs git
// add`를 직접 호출하며 발견: 같은 파일이 "docs/X.md"와 "docs\X.md"
// 두 개의 서로 다른 스테이징 키로 각각 올라가는 버그, #git-path-separator).
// 사용자/CLI가 넘긴 경로를 받는 모든 API 경계에서 이 함수로 정규화한
// 뒤에만 git 트리 조회/스테이징 키/Gitea API 호출에 써야 한다.
export function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}
