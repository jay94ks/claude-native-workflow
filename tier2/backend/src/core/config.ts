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
  git: { enabled: true, push_mode: "immediate" },
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
