// 이미지/영상 확장자 화이트리스트 두 종류뿐 - 블랙리스트 없음. 그
// 외 모든 파일은 지금처럼 텍스트로 취급한다(알려지지 않은/애매한
// 확장자를 걸러내려고 바이너리 목록을 유지·관리할 필요가 없다 -
// 텍스트로 열었는데 실제로는 바이너리라 내용이 깨져 보이면 "원본
// 다운로드" 링크가 항상 그 자리에서 탈출구가 된다).

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);

export type FileKind = "text" | "image" | "video";

export function classifyFileKind(path: string): FileKind {
  const dotIdx = path.lastIndexOf(".");
  const ext = dotIdx < 0 ? "" : path.slice(dotIdx + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "text";
}
