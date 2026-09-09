import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { runWithProjectRoot } from "@claude-native-workflow/tier2-backend/dist/core/paths.js";
import { loadConfig, saveConfig } from "@claude-native-workflow/tier2-backend/dist/core/config.js";

// SP-00002 3절: projects.git_repo_url이 "이 프로젝트의 docs/가 사는 git
// 저장소"다. tier2/backend의 core/(fs 기반)가 실제로 읽고 쓰려면 서버가
// 그 저장소를 로컬 디스크 어딘가에 체크아웃해두고 있어야 한다 - SP-00002
// 자체엔 이 운영 디테일이 없어서, PL-00001 3단계 착수 시점에 정한 것:
// TIER3_PROJECTS_DIR 아래 <projectId>별 서브디렉터리 하나씩.

function projectsRoot(): string {
  return process.env.TIER3_PROJECTS_DIR ?? path.join(process.cwd(), "data", "projects");
}

export function projectDir(projectId: string): string {
  return path.join(projectsRoot(), projectId);
}

/** 프로젝트 생성 시 한 번 clone. 이미 체크아웃돼 있으면(재기동 등) 그대로
 * 둔다 - 매번 다시 clone하지 않는다. */
export async function ensureProjectCheckout(projectId: string, gitRepoUrl: string): Promise<void> {
  const dir = projectDir(projectId);
  if (fs.existsSync(path.join(dir, ".git"))) return;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await simpleGit().clone(gitRepoUrl, dir);

  // tier2-backend의 core 쓰기 경로(createDoc/answerPending/transitionDone)는
  // 성공 직후 자기 나름대로 자동 commit+push한다(SP-00001 5절, 저장소에
  // 설정된 git user로만 커밋). Tier 3는 "커밋 작성자를 실제 요청한 설계자로
  // 남긴다"(SP-00002 5절)는 별도 요구가 있어서, 그 자동 커밋만 끄고
  // (docs/.config.json git.auto_commit=false) 매 요청 끝에서 tier3가
  // 직접 올바른 작성자로 커밋한다(commitAsAndPush, 아래). `git.enabled`
  // 는 그대로 true로 둔다 - 처음엔 이것도 껐다가, 웹훅으로 받은 pull이
  // "git 자동화가 꺼져 있습니다"로 막히는 걸 보고서야 `enabled`(pull/push
  // 자체를 막는 스위치)와 `auto_commit`(쓰기 후 자동 커밋만 막는 스위치)
  // 이 다른 걸 tier2에 추가해 분리했다.
  runWithProjectRoot(dir, () => {
    const config = loadConfig();
    config.git.auto_commit = false;
    saveConfig(config);
  });
}

export interface CommitAsResult {
  committed: boolean;
  sha?: string;
}

/** SP-00002 5절: "API 경로로 들어온 변경은... 커밋 작성자는 실제 요청한
 * 설계자 이름/이메일로 기록"한다 - tier2/backend의 core/git.ts는 저장소에
 * 이미 설정된 git user로만 커밋하므로(단일 설계자 로컬 도구라 그걸로
 * 충분했음), 여기서는 별도로 커밋마다 작성자를 지정하는 얇은 함수를 둔다
 * (tier2의 commitDocsChange를 억지로 확장하는 대신, 이 요구사항 자체가
 * "여러 설계자가 API로 동시에 쓴다"는 Tier 3 고유의 것이라 여기 둠).
 * 성공하면 이어서 push까지 한다(Tier 3는 push_mode 토글이 없다 - 서버가
 * 대행하는 게 기본이자 유일한 동작, SP-00003 2절 "고급: 서버가 대행"). */
export async function commitAsAndPush(
  projectId: string,
  message: string,
  authorName: string,
  authorEmail: string,
): Promise<CommitAsResult> {
  const dir = projectDir(projectId);
  const git = simpleGit(dir);
  await git.add(["docs"]);
  const status = await git.status();
  if (status.staged.length === 0) return { committed: false };
  const res = await git.commit(message, undefined, {
    "--author": `${authorName} <${authorEmail}>`,
  });
  await git.push();
  return { committed: true, sha: res.commit };
}
