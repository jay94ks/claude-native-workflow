<template>
  <div class="row no-wrap" style="min-height: calc(100vh - 160px)">
    <ProjectSidebar>
      <!-- 설계자 요청(2026-09-21) - Documents 탭 우측에 있던 About 카드를
           Code 탭 좌측 패널 맨 위로 옮겼다(다른 탭들과 달리 Code가 프로젝트
           진입 시 첫 화면이라 About이 가장 먼저 눈에 띄어야 한다는 판단). -->
      <ProjectAboutSidebar :owner="owner" :project-id="projectId" />
      <q-separator class="q-my-md" />

      <div class="row items-center q-gutter-sm q-mb-sm">
        <q-select v-model="branch" :options="branchNames" dense style="min-width: 140px" label="branch" @update:model-value="onBranchChange" />
        <!-- 설계자 요청(2026-09-21, 항목 9) - 좌측의 "최근 커밋" 목록은 없애고
             이 눈알 아이콘으로 그 브랜치의 커밋 목록을 별도 페이지에서 본다. -->
        <q-btn v-if="branch" flat dense round icon="visibility" size="sm" :to="`/${owner}/${projectId}/commits?branch=${branch}`">
          <q-tooltip>{{ branch }} 브랜치 최근 커밋 보기</q-tooltip>
        </q-btn>
        <q-btn v-if="path" flat dense icon="arrow_upward" @click="goUp" />
        <div class="text-caption">/{{ path }}</div>
      </div>

      <div v-if="branchNames.length === 0" class="text-caption" style="color: var(--gh-fg-muted)">
        저장소가 비어있습니다(아직 커밋이 없습니다) - Settings의 Template 메뉴에서 배포하면 첫 커밋이 생깁니다.
      </div>
      <q-list v-else bordered separator>
        <q-item v-for="entry in entries" :key="entry.name" clickable @click="openEntry(entry)">
          <q-item-section avatar>
            <q-icon :name="entry.type === 'tree' ? 'folder' : 'description'" :color="entry.type === 'tree' ? 'amber-8' : 'grey-7'" />
          </q-item-section>
          <q-item-section>{{ entry.name }}</q-item-section>
        </q-item>
        <q-item v-if="entries.length === 0"><q-item-section class="text-caption">비어있는 디렉터리입니다.</q-item-section></q-item>
      </q-list>
    </ProjectSidebar>

    <q-separator vertical />

    <div class="col" style="overflow-y: auto">
      <!-- 설계자 요청(2026-09-21 후속) - /code/:branch/:commitId로 들어오면
           그 커밋 시점의 스냅샷을 읽기 전용으로 보여준다(repo.writeFile은
           항상 "지금" 브랜치 tip에만 커밋 가능하므로, 과거 시점에서는
           편집 UI 자체를 없앤다). -->
      <q-banner v-if="isHistorical" dense class="bg-warning text-white">
        <template #avatar><q-icon name="history" /></template>
        이 화면은 커밋 <b>{{ commitId?.slice(0, 8) }}</b> 시점의 원본입니다(읽기 전용).
        <template #action>
          <q-btn flat dense label="지금 브랜치로 돌아가기" :to="`/${owner}/${projectId}/code/${branch}`" />
        </template>
      </q-banner>

      <template v-if="currentPath && currentFile">
        <!-- 설계자 요청(2026-09-21, 항목 8) - 우측 뷰어를 탭으로 나눈다:
             파일 내용(탭 이름=파일명만, 경로 제외)/Recent Commits(그
             파일을 실제로 건드린 커밋만). -->
        <q-tabs v-model="rightTab" align="left" dense class="q-px-md" style="border-bottom: 1px solid var(--gh-border)">
          <q-tab name="content" :label="fileNameOf(currentPath)" />
          <q-tab name="commits" label="Recent Commits" />
        </q-tabs>
        <div class="q-pa-md">
          <div v-if="rightTab === 'content'">
            <div v-if="currentFile.isBinary" class="text-caption">바이너리 파일이라 내용을 표시하지 않습니다({{ currentFile.size }} bytes).</div>
            <!-- 전체 QA 점검(2026-09-21) 중 발견 - 512KB(BLOB_SIZE_LIMIT)를
                 넘는 텍스트 파일은 서버가 content를 ""로 잘라 돌려주는데
                 (readFile/readFileAtRef), 지금까지 isBinary만 걸러서 이
                 경우 MarkdownSourceView에 빈 문자열이 들어가 "파일이
                 비어있다"처럼 잘못 보였다(diff 뷰어에서 이미 고친 것과
                 같은 종류의 버그 - 거긴 고쳤는데 Code 탭 자체는 놓쳤었다). -->
            <div v-else-if="!currentFile.isBinary && currentFile.size > 0 && currentFile.content === ''" class="text-caption">
              파일이 너무 커서(512KB 초과, {{ currentFile.size }} bytes) 표시할 수 없습니다.
            </div>
            <!-- 설계자 요청(2026-09-21) - 코드 탭의 파일 뷰어/편집기도 다른 곳과
                 동일하게 yiitap 기반 Source View를 쓴다. yiitap은 근본적으로
                 마크다운 편집기라 임의의 소스 파일은 그대로 넣으면 들여쓰기/
                 공백이 문단으로 뭉개진다 - .md가 아닌 파일은 펜스 코드 블록
                 (```lang ... ```)으로 감싸 넣어서 <pre><code>로 보존되게 하고,
                 저장 시 그 펜스를 다시 벗겨 원문만 repo.writeFile로 커밋한다. -->
            <MarkdownSourceView
              v-else
              :key="currentPath"
              :content="sourceViewContent(currentFile)"
              :read-only="isHistorical"
              @save="saveCurrentFile"
            />
          </div>
          <div v-else>
            <div v-if="fileCommitsLoading" class="text-caption">불러오는 중...</div>
            <q-list v-else bordered separator>
              <q-item v-for="c in fileCommits" :key="c.id" clickable :to="`/${owner}/${projectId}/commit/${branch}/${c.id}`">
                <q-item-section>
                  <q-item-label>{{ c.message }}</q-item-label>
                  <q-item-label caption>{{ c.id.slice(0, 8) }} · {{ c.author }} · {{ new Date(c.time).toLocaleString() }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="fileCommits.length === 0"><q-item-section class="text-caption">이 파일을 건드린 커밋이 없습니다.</q-item-section></q-item>
            </q-list>
          </div>
        </div>
      </template>
      <!-- 설계자 요청(2026-09-21, 항목 11) - README.md가 없을 때의 안내
           문구+버튼을 우측 영역 중앙 정렬 + 상단 패딩 200px로. 과거 시점
           보기에선 "작성하기"가 의미 없으므로(그 시점에 쓸 수 없음) 버튼
           없이 안내만 보여준다. -->
      <div v-else-if="readmeState === 'missing' && (isHistorical || !creatingReadme)" class="column items-center" style="padding-top: 200px">
        <div class="text-caption q-mb-sm">이 브랜치 루트에 README.md가 없습니다.</div>
        <q-btn v-if="!isHistorical" color="primary" icon="add" label="README.md 작성하기" @click="creatingReadme = true" />
      </div>
      <div v-else-if="readmeState === 'missing'" class="q-pa-md">
        <MarkdownSourceView content="" start-in-edit @save="saveReadme" @cancel="creatingReadme = false" />
      </div>
      <div v-else class="q-pa-md text-caption">왼쪽에서 파일을 선택하세요.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "stores/auth";
import { useProjectStore } from "stores/project";
import MarkdownSourceView from "components/MarkdownSourceView.vue";
import ProjectSidebar from "components/ProjectSidebar.vue";
import ProjectAboutSidebar from "components/ProjectAboutSidebar.vue";
import * as api from "src/api/client";

interface BranchInfo {
  name: string;
  tipCommitId: string | null;
}
interface TreeEntry {
  name: string;
  type: "blob" | "tree" | "other";
  oid: string;
}
interface CommitInfo {
  id: string;
  message: string;
  author: string;
  time: string;
}
interface FileContent {
  path: string;
  content: string;
  isBinary: boolean;
  size: number;
}

// 설계자 요청(2026-09-21 후속) - Code 탭 URL 체계: /code?path=P(기본
// 브랜치)/ /code/:branch?path=P(그 브랜치 지금 시점)/ /code/:branch/
// :commitId?path=P(그 브랜치 위 특정 커밋 시점, 읽기 전용) - branch/
// commitId 둘 다 optional route param, path는 지금 열려 있는 파일을
// 가리키는 query(디렉터리 브라우징 중인 하위 폴더 자체는 URL에 안 담음).
const props = defineProps<{ owner: string; projectId: string; branch?: string; commitId?: string }>();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const project = useProjectStore();

const branchNames = ref<string[]>([]);
const branch = ref<string | null>(null);
const commitId = computed(() => props.commitId ?? null);
const isHistorical = computed(() => !!commitId.value);
const path = ref("");
const entries = ref<TreeEntry[]>([]);

// 설계자 요청(2026-09-21) - 파일 트리에서 고른 파일이든 루트에서 자동으로
// 보여주는 README든 "지금 우측에 보여줄 파일" 하나의 개념으로 통일했다
// (둘 다 탭 구조를 똑같이 쓰므로).
const currentPath = ref<string | null>(null);
const currentFile = ref<FileContent | null>(null);
const rightTab = ref<"content" | "commits">("content");
const fileCommits = ref<CommitInfo[]>([]);
const fileCommitsLoading = ref(false);

const readmeState = ref<"loading" | "found" | "missing" | "n/a">("loading");
const creatingReadme = ref(false);

function fileNameOf(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function isMarkdownPath(filePath: string): boolean {
  return /\.mdx?$/i.test(filePath);
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  vue: "html",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  py: "python",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  prisma: "prisma",
  toml: "toml",
  rs: "rust",
  go: "go",
  java: "java",
};

function extLangFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "";
}

function wrapAsCodeFence(content: string, lang: string): string {
  return "```" + lang + "\n" + content + "\n```\n";
}

function unwrapCodeFence(markdown: string): string {
  const match = markdown.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
  return match ? (match[1] ?? "") : markdown;
}

function sourceViewContent(file: FileContent): string {
  return isMarkdownPath(file.path) ? file.content : wrapAsCodeFence(file.content, extLangFromPath(file.path));
}

// commitId가 있으면(과거 시점) listTreeAtRef/readFileAtRef 기반, 없으면
// 지금까지처럼 branch의 "지금" tip - backend/src/core/repoBrowse.ts의
// repoTree/repoFile이 이 구분을 그대로 반영한다.
async function fetchTree(dirPath: string): Promise<TreeEntry[] | null> {
  if (!branch.value) return null;
  const result = await api.listTree(auth.apiKey!, props.owner, props.projectId, branch.value, dirPath, commitId.value ?? undefined);
  return result.ok ? (result.data as { items: TreeEntry[] }).items : null;
}
async function fetchFile(filePath: string): Promise<Omit<FileContent, "path"> | null> {
  if (!branch.value) return null;
  const result = await api.readRepoFile(auth.apiKey!, props.owner, props.projectId, branch.value, filePath, commitId.value ?? undefined);
  return result.ok ? (result.data as Omit<FileContent, "path">) : null;
}

async function loadBranches(): Promise<string[]> {
  const result = await api.listBranches(auth.apiKey!, props.owner, props.projectId);
  if (result.ok) {
    const items = (result.data as { items: BranchInfo[] }).items;
    branchNames.value = items.map((b) => b.name);
    return branchNames.value;
  }
  return [];
}

async function loadTree() {
  const items = await fetchTree(path.value);
  entries.value = items ?? [];
  await loadReadmeIfAtRoot();
}

// 설계자 요청(2026-09-20): 선택된 파일이 없을 때 "루트"에 README.md가
// 있으면 기본으로 보여준다 - 하위 디렉터리를 보는 중일 땐 이 README
// 처리 자체가 적용되지 않는다("이 브랜치에 README가 없다"는 문구가
// 하위 디렉터리 안에서도 뜨는 건 오해를 부른다), 그냥 "파일을
// 선택하세요"로 되돌아간다("n/a" 상태).
async function loadReadmeIfAtRoot() {
  creatingReadme.value = false;
  if (currentPath.value || !branch.value) {
    readmeState.value = "n/a";
    return;
  }
  if (path.value) {
    readmeState.value = "n/a";
    return;
  }
  const hasReadme = entries.value.some((e) => e.type === "blob" && e.name === "README.md");
  if (!hasReadme) {
    readmeState.value = "missing";
    return;
  }
  const file = await fetchFile("README.md");
  if (file) {
    currentPath.value = "README.md";
    currentFile.value = { path: "README.md", ...file };
    readmeState.value = "found";
  } else {
    readmeState.value = "missing";
  }
}

async function saveReadme(markdown: string) {
  if (!branch.value || isHistorical.value) return;
  const result = await api.writeRepoFile(auth.apiKey!, props.owner, props.projectId, {
    branch: branch.value,
    path: "README.md",
    content: markdown,
    message: readmeState.value === "found" ? "update README.md" : "add README.md",
  });
  if (result.ok) {
    creatingReadme.value = false;
    currentPath.value = null;
    currentFile.value = null;
    await loadTree();
  }
}

async function saveCurrentFile(markdown: string) {
  if (!branch.value || !currentFile.value || isHistorical.value) return;
  let raw = isMarkdownPath(currentFile.value.path) ? markdown : unwrapCodeFence(markdown);
  // marked -> turndown 왕복에서 코드 펜스 안 마지막 줄바꿈이 사라진다
  // (검증: node로 직접 왕복시켜 확인) - 원본에 있었으면 되돌려준다,
  // 안 그러면 저장할 때마다 "파일 끝에 줄바꿈 없음"으로 diff가 튄다.
  if (!isMarkdownPath(currentFile.value.path) && currentFile.value.content.endsWith("\n") && !raw.endsWith("\n")) {
    raw += "\n";
  }
  const result = await api.writeRepoFile(auth.apiKey!, props.owner, props.projectId, {
    branch: branch.value,
    path: currentFile.value.path,
    content: raw,
    message: `update ${currentFile.value.path}`,
  });
  if (result.ok) {
    currentFile.value = { ...currentFile.value, content: raw };
    if (rightTab.value === "commits") await loadFileCommits();
  }
}

async function loadFileCommits() {
  if (!branch.value || !currentPath.value) {
    fileCommits.value = [];
    return;
  }
  fileCommitsLoading.value = true;
  const result = await api.getFileCommits(auth.apiKey!, props.owner, props.projectId, branch.value, currentPath.value, 30);
  if (result.ok) fileCommits.value = (result.data as { items: CommitInfo[] }).items;
  fileCommitsLoading.value = false;
}

watch(rightTab, (tab) => {
  if (tab === "commits") loadFileCommits();
});
watch(currentPath, () => {
  rightTab.value = "content";
});

// 버그(2026-09-21 후속 발견) - Project.defaultBranch는 스키마 기본값이
// "main"인데, 실제 저장소는 es-git 초기화 시점의 브랜치명(이 데모
// 데이터는 "master")을 그대로 쓰는 경우가 있어 **DB의 defaultBranch
// 필드값이 실제로 존재하는 브랜치가 아닐 수 있다** - 이 값을 검증 없이
// fallback으로 쓰면 존재하지 않는 브랜치로 API를 불러 422가 난다(실제로
// demo-project에서 재현: defaultBranch="main"인데 실제 브랜치는
// master/feature-branch/another-feature뿐). 실제 `branchNames`에 있는
// 경우에만 신뢰하고, 아니면 `branchNames[0]`(항상 실재하는 브랜치)로
// 대체한다.
function effectiveDefaultBranch(): string | null {
  const configured = project.current?.defaultBranch;
  if (configured && branchNames.value.includes(configured)) return configured;
  return branchNames.value[0] ?? null;
}

// 설계자 요청(2026-09-21 후속) - 브랜치를 바꾸면 그 브랜치의 "지금"
// 시점으로 이동한다(과거 시점 보기 중이었어도 브랜치를 바꾸는 순간
// 그 조합은 만들지 않는다) - 기본 브랜치를 고르면 짧은 /code로,
// 아니면 /code/{branch}로.
function onBranchChange(newBranch: string) {
  const isDefault = newBranch === effectiveDefaultBranch();
  const base = isDefault ? `/${props.owner}/${props.projectId}/code` : `/${props.owner}/${props.projectId}/code/${newBranch}`;
  router.push(base);
}

async function openEntry(entry: TreeEntry) {
  if (!branch.value) return;
  const entryPath = path.value ? `${path.value}/${entry.name}` : entry.name;
  if (entry.type === "tree") {
    path.value = entryPath;
    currentPath.value = null;
    currentFile.value = null;
    await loadTree();
    return;
  }
  const file = await fetchFile(entryPath);
  if (file) {
    currentPath.value = entryPath;
    currentFile.value = { path: entryPath, ...file };
    // 설계자 요청(2026-09-21 후속) - 지금 열어본 파일을 ?path=에 반영해
    // Browser History/새로고침에도 유지되게 한다.
    router.push({ path: route.path, query: { ...route.query, path: entryPath } });
  }
}

function goUp() {
  const parts = path.value.split("/");
  parts.pop();
  path.value = parts.join("/");
  currentPath.value = null;
  currentFile.value = null;
  loadTree();
}

// 설계자 요청(2026-09-21 후속) - route(:branch/:commitId/query.path)가
// 가리키는 상태를 그대로 반영한다 - 최초 진입, 브랜치/커밋 전환,
// DiffViewer의 "코드 트리에서 보기" 링크, 브라우저 뒤로/앞으로 가기
// 전부 이 한 함수로 처리한다(예전엔 onMounted와 query watcher가
// 따로 있어서 로직이 두 곳에 흩어져 있었다).
async function applyRoute() {
  branch.value = props.branch || effectiveDefaultBranch();

  const qPath = typeof route.query.path === "string" ? route.query.path : "";
  currentPath.value = null;
  currentFile.value = null;

  if (qPath) {
    const parts = qPath.split("/");
    parts.pop();
    path.value = parts.join("/");
    await loadTree();
    const file = await fetchFile(qPath);
    if (file) {
      currentPath.value = qPath;
      currentFile.value = { path: qPath, ...file };
    }
  } else {
    path.value = "";
    await loadTree();
  }
}

onMounted(async () => {
  await loadBranches();
  await applyRoute();
});
watch(() => [props.branch, props.commitId, route.query.path], applyRoute);
</script>
