import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// SP-00002 2절: "Skill이 안내하는 얇은 REST 클라이언트는 발급받은 토큰을
// 프로젝트 저장소 밖의 설계자 홈 디렉터리 설정 파일(예: ~/.claude-native-
// workflow/credentials.json, 파일 권한 600)에 보관한다. docs/나 git
// 저장소 안에는 토큰을 절대 커밋하지 않는다." - 홈 디렉터리 밖으로
// 나가지 않으므로 그 자체로 이미 어떤 프로젝트의 git 저장소/.gitignore
// 와도 무관하다(실수로 프로젝트 안에 쓰는 코드 경로가 아예 없음).

const CREDENTIALS_DIR = path.join(os.homedir(), ".claude-native-workflow");
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, "credentials.json");

export interface StoredCredentials {
  api_base: string;
  access_token: string;
  refresh_token: string;
}

export function saveCredentials(creds: StoredCredentials): void {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
  // 파일이 이미 있어서 다른 권한으로 남아있었을 수도 있으니 다시 한번 강제.
  fs.chmodSync(CREDENTIALS_PATH, 0o600);
}

export function loadCredentials(): StoredCredentials | null {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8")) as StoredCredentials;
}

export function clearCredentials(): void {
  if (fs.existsSync(CREDENTIALS_PATH)) fs.unlinkSync(CREDENTIALS_PATH);
}

export function credentialsPath(): string {
  return CREDENTIALS_PATH;
}
