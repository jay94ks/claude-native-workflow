import fs from "node:fs";
import path from "node:path";
import { docsDir } from "./paths.js";

// SP-00003 3절 기능 토글 + SP-00001 5·6절의 git/db 설정. docs/.config.json이
// 없으면 아래 기본값(평범 등급 프리셋: git_log_ui/comments on, db/auth off,
// git 자동화 on + 즉시 push)을 그대로 쓴다 - 파일은 있는 값만 덮어쓴다.

export interface FeaturesConfig {
  git_log_ui: boolean;
  comments: boolean;
  db: boolean;
  auth: boolean;
}

export interface GitConfig {
  enabled: boolean;
  push_mode: "immediate" | "manual";
  // docs new/reply/transition-done 성공 직후의 자동 commit(+push)만 끄는
  // 스위치 - `enabled: false`(git 저장소 자체가 아닌 경우)와는 다르다.
  // pull()/push()/commitDocsChange() 같은 명시적 git 명령은 `enabled`만
  // 보고 그대로 동작한다. Tier 3(tier3/backend/core/workspace.ts)가
  // "커밋 작성자는 요청한 설계자로"(SP-00002 5절)를 지키려고 이 자동
  // 커밋만 끄고 pull/push는 그대로 쓰려다가, 기존 `enabled: false`
  // 하나로는 그 둘을 분리할 수 없다는 걸 실제로 웹훅 핸들러에서 pull이
  // "git 자동화가 꺼져 있습니다"로 막히는 걸 보고서야 발견해서 추가함.
  auto_commit: boolean;
}

export interface DbConfig {
  enabled: boolean;
  driver: "mysql" | "mariadb" | "postgres" | "sqlite";
  connection?: Record<string, unknown>;
}

export interface WorkflowConfig {
  features: FeaturesConfig;
  git: GitConfig;
  db: DbConfig;
}

const DEFAULTS: WorkflowConfig = {
  features: { git_log_ui: true, comments: true, db: false, auth: false },
  git: { enabled: true, push_mode: "immediate", auto_commit: true },
  db: { enabled: false, driver: "mysql" },
};

export function loadConfig(): WorkflowConfig {
  const p = path.join(docsDir(), ".config.json");
  if (!fs.existsSync(p)) {
    return structuredClone(DEFAULTS);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<WorkflowConfig>;
  return {
    features: { ...DEFAULTS.features, ...raw.features },
    git: { ...DEFAULTS.git, ...raw.git },
    db: { ...DEFAULTS.db, ...raw.db },
  };
}

/** Only `db.enable`/`disable` (dbmigrate.ts) should call this - every other
 * setting is safe to hand-edit in docs/.config.json directly (SP-00003 3절),
 * but `db.enabled` is the one field that must only flip after a verified
 * data migration, never a bare file edit. */
export function saveConfig(config: WorkflowConfig): void {
  const p = path.join(docsDir(), ".config.json");
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
