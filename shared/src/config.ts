import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CONFIG_DIR_NAME = ".cnw";
const PROJECT_CONFIG_FILE = "config.json";
const SESSION_FILE = "session.json";
const STAGING_FILE = "staging.json";
const CACHE_FILE = "cache.json";
// $HOME/.cnw/config.json이었던 걸 별도 파일명으로 분리한다 - 프로젝트
// 디렉터리가 홈 디렉터리 바로 아래(또는 그 하위 어디든) 있으면
// findProjectRoot()가 위로 올라가다 이 홈 설정 파일과 같은 이름
// "config.json"을 만나 "project 설정"으로 잘못 읽어 크래시했다(실제
// 홈 디렉터리 바로 밑에 워크스페이스를 만들어보다가 실측으로 발견).
const HOME_CONFIG_FILE = "credentials.json";

/** `.cnw/config.json` - no personal identifiers, safe to commit to git. */
export interface ProjectConfig {
  httpEndpoint: string;
  projectId: string;
}

/** `.cnw/session.json` - per-checkout, must NOT be committed. */
export interface SessionConfig {
  architectId: string;
}

export interface DesignerCredentials {
  endpoint: string;
  apiKey: string;
}

/** `$HOME/.cnw/credentials.json`, nested httpEndpoint -> projectId -> architectId. */
export type HomeConfig = Record<string, Record<string, Record<string, DesignerCredentials>>>;

export interface ClientConfig extends ProjectConfig, SessionConfig, DesignerCredentials {}

export class CnwConfigError extends Error {}

function projectConfigPath(root: string): string {
  return path.join(root, CONFIG_DIR_NAME, PROJECT_CONFIG_FILE);
}

function sessionConfigPath(root: string): string {
  return path.join(root, CONFIG_DIR_NAME, SESSION_FILE);
}

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new CnwConfigError(`Failed to parse ${filePath}: ${(err as Error).message}`);
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

/** Walks up from `startDir` looking for `.cnw/config.json`, the way git looks for `.git`. */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(projectConfigPath(dir))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readProjectConfig(startDir: string = process.cwd()): { root: string; config: ProjectConfig } {
  const root = findProjectRoot(startDir);
  if (!root) {
    throw new CnwConfigError(
      `${CONFIG_DIR_NAME}/${PROJECT_CONFIG_FILE} not found in "${startDir}" or any parent directory. Run "docs auth login" from inside a linked project.`
    );
  }
  const config = readJson<Partial<ProjectConfig>>(projectConfigPath(root));
  if (typeof config.httpEndpoint !== "string" || typeof config.projectId !== "string") {
    throw new CnwConfigError(`${projectConfigPath(root)} must contain string fields "httpEndpoint" and "projectId".`);
  }
  return { root, config: { httpEndpoint: config.httpEndpoint, projectId: config.projectId } };
}

export function writeProjectConfig(root: string, config: ProjectConfig): void {
  writeJson(projectConfigPath(root), config);
}

export function readSessionConfig(root: string): SessionConfig {
  const filePath = sessionConfigPath(root);
  if (!fs.existsSync(filePath)) {
    throw new CnwConfigError(`${filePath} not found - run "docs auth login" first.`);
  }
  const config = readJson<Partial<SessionConfig>>(filePath);
  if (typeof config.architectId !== "string") {
    throw new CnwConfigError(`${filePath} must contain a string field "architectId".`);
  }
  return { architectId: config.architectId };
}

export function writeSessionConfig(root: string, session: SessionConfig): void {
  writeJson(sessionConfigPath(root), session);
}

/** `.cnw/staging.json` - Phase 8 "로컬 스테이징": `--stage`로 쌓인 액션들, `docs push`로 한 번에 전송된다. Git 추적 금지. */
export interface StagedAction {
  action: string;
  [key: string]: unknown;
}

function stagingPath(root: string): string {
  return path.join(root, CONFIG_DIR_NAME, STAGING_FILE);
}

export function readStaging(root: string): StagedAction[] {
  const filePath = stagingPath(root);
  if (!fs.existsSync(filePath)) return [];
  return readJson<StagedAction[]>(filePath);
}

export function appendStaging(root: string, action: StagedAction): void {
  const staged = readStaging(root);
  staged.push(action);
  writeJson(stagingPath(root), staged);
}

export function clearStaging(root: string): void {
  writeJson(stagingPath(root), []);
}

/** `.cnw/cache.json` - Phase 8 "로컬 캐시": `docs get`이 받은 본문을 트래킹 코드별로 남겨 `docs cat`이 재요청 없이 읽는다. Git 추적 금지, 정본이 아니다. */
export type LocalCache = Record<string, { fetchedAt: string; doc: unknown }>;

function cachePath(root: string): string {
  return path.join(root, CONFIG_DIR_NAME, CACHE_FILE);
}

export function readCache(root: string): LocalCache {
  const filePath = cachePath(root);
  if (!fs.existsSync(filePath)) return {};
  return readJson<LocalCache>(filePath);
}

export function writeCacheEntry(root: string, code: string, doc: unknown): void {
  const cache = readCache(root);
  cache[code] = { fetchedAt: new Date().toISOString(), doc };
  writeJson(cachePath(root), cache);
}

export function getHomeConfigPath(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME, HOME_CONFIG_FILE);
}

export function readHomeConfig(): HomeConfig {
  const filePath = getHomeConfigPath();
  if (!fs.existsSync(filePath)) return {};
  return readJson<HomeConfig>(filePath);
}

export function writeHomeConfig(config: HomeConfig): void {
  writeJson(getHomeConfigPath(), config);
}

export function setDesignerCredentials(
  httpEndpoint: string,
  projectId: string,
  architectId: string,
  creds: DesignerCredentials
): void {
  const home = readHomeConfig();
  home[httpEndpoint] ??= {};
  home[httpEndpoint][projectId] ??= {};
  home[httpEndpoint][projectId][architectId] = creds;
  writeHomeConfig(home);
}

function getDesignerCredentials(httpEndpoint: string, projectId: string, architectId: string): DesignerCredentials {
  const creds = readHomeConfig()[httpEndpoint]?.[projectId]?.[architectId];
  if (!creds) {
    throw new CnwConfigError(
      `No credentials for ${httpEndpoint} / ${projectId} / ${architectId} in ${getHomeConfigPath()}. Run "docs auth login" first.`
    );
  }
  return creds;
}

/**
 * Resolves everything a CLI/MCP call needs: walks up for `.cnw/config.json`,
 * reads `.cnw/session.json` for the active architectId, then looks up that
 * combination in the home config for the endpoint/apiKey to actually call.
 */
export function resolveClientConfig(startDir: string = process.cwd()): ClientConfig {
  const { root, config: project } = readProjectConfig(startDir);
  const session = readSessionConfig(root);
  const credentials = getDesignerCredentials(project.httpEndpoint, project.projectId, session.architectId);
  return { ...project, ...session, ...credentials };
}
