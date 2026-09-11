# 추가 개발 계획 (백로그)

QA-SCENARIOS.md의 각 기능 영역을 훑으며 드러난 개선 여지를 여기 한
곳에 모아 관리한다 - QA-SCENARIOS.md 쪽에는 태그만 남기고 전체 설명은
이 문서에만 둔다(중복 기재 방지). **전부 "승인 대기" 상태** - 설계자가
우선순위를 정하면 그때 각각 Plan Mode로 상세 설계를 잡는다. 항목을
처리하면 본문 절은 지우되(완료 이력은 DESIGN-NOTES.md에 라운드로
남으므로 본문엔 "완료" 표시를 남겨둘 필요 없음), 아래 색인 표의
행은 지우지 않고 완료 칸만 표시한다(이유는 색인 절 참고).

새 QA 패스에서 백로그 후보가 드러나면 본문에 태그+설명으로 추가하고
아래 색인 표에도 한 줄 추가하며, QA-SCENARIOS.md의 해당 절엔 그
태그만 붙인다. **다음 작업 항목을 고를 땐 항상 아래 색인 표부터
본다** - 표 순서가 곧 우선순위다.

---

## 색인

**다음 작업 항목은 이 표를 기준으로 고른다** - 완료 칸이 ✅인 행은
건너뛰고, 아직 ⬜인 행 중 표의 가장 위에 있는 것을 우선 후보로
삼는다. 설계자가 표의 행 순서를 바꾸면 그게 곧 우선순위 변경이다.

**완료된 항목도 행을 지우지 않고 완료 칸만 ✅로 바꾼다** - 이 표
자체가 전체 백로그의 처리 현황판 역할을 하므로, 다음 항목을 고를 때
이미 끝난 걸 다시 조사하거나 본문/DESIGN-NOTES.md를 뒤져 처리 여부를
확인할 필요가 없다(완료 칸만 보면 바로 앎). 완료된 항목의 상세 설명은
DESIGN-NOTES.md의 해당 라운드 절에 있다 - 요약 칸에 다시 옮겨 적지
않는다. 새 항목을 추가할 땐 본문에 절/항목을 추가하고 이 표 맨
아래에 완료 칸을 ⬜로 비운 채 한 줄 추가한다.

| # | 완료 | 태그 | 요약 |
|---|---|---|---|
| 1 | ✅ | `#cli-mcp-audit-script` | CLI/MCP 대칭성 자동 감사 스크립트(`npm run audit:cli-mcp`) |
| 2 | ✅ | `#login-rate-limit` | 로그인 무차별 대입 방어(계정별 5회/IP별 20회, 15분 이중 잠금) |
| 3 | ✅ | `#api-key-ttl` | API 키 선택적 만료(TTL) - 생성 시 지정, 지나면 배제와 동일하게 거부 |
| 4 | ✅ | `#password-reset` | admin 대행 비밀번호 재설정(사용자 관리 화면 + `docs user reset-password`) |
| 5 | ✅ | `#team-group-reparent` | 프로젝트 그룹 재소속(다른 팀으로 이동/팀 없음으로 뗌, 목적지 팀장 동의 필요) |
| 6 | ✅ | `#folder-access-ui` | 의도된 설계로 확인 - 폴더는 개인화 기능, 공유 기능 추가 안 함 |
| 7 | ⬜ | `#access-overview-cross-project` | 설계자별 접근 제한 프로젝트 횡단 일괄 조회 없음 |
| 8 | ⬜ | `#doctype-edit-delete` | DocType 이름(코드/라벨) 변경·삭제 불가 |
| 9 | ⬜ | `#doctype-transition-delete` | DocStatusTransition 삭제 불가 |
| 10 | ⬜ | `#document-bulk-actions` | 문서 일괄 상태 전이/폴더 이동 없음 |
| 11 | ⬜ | `#folder-delete-recursive` | 폴더 재귀 삭제/상위로 끌어올리기 없음 |
| 12 | ⬜ | `#question-bulk-ack` | 질문 일괄 ack 없음 |
| 13 | ⬜ | `#question-withdraw` | 질문 취소/철회 기능 없음 |
| 14 | ⬜ | `#comment-edit-delete` | 코멘트 수정/삭제 없음(해결 처리만 가능) |
| 15 | ⬜ | `#message-edit-delete` | 메시지 수정/삭제 없음 |
| 16 | ⬜ | `#message-wait-timeout-cap` | `message wait` 최대 타임아웃 상한 미정 |
| 17 | ⬜ | `#meilisearch-spof` | Meilisearch 장애 시 에러 메시지 품질 미점검 |
| 18 | ⬜ | `#git-unlink` | git 저장소 연결 해제(unlink) 기능 없음 |
| 19 | ⬜ | `#git-publish-pr-draft` | PR 초안 자동 생성 중간 단계 없음(의도된 설계) |
| 20 | ⬜ | `#hook-prompt-update` | PushHookPrompt 수정(update) 라우트 없음 |
| 21 | ⬜ | `#hook-branch-pattern` | 브랜치 패턴(glob/regex) 매칭 없음 |
| 22 | ⬜ | `#hook-queue-ttl` | push 훅 대기열 만료/자동 정리 없음 |
| 23 | ⬜ | `#template-history` | 템플릿 변경 이력(리비전) 없음 |
| 24 | ⬜ | `#migrate-idempotent` | 가이디드 마이그레이션 재실행이 멱등하지 않음 |
| 25 | ⬜ | `#migrate-status-mapping-preset` | 마이그레이션 상태 매핑 프리셋 없음 |
| 26 | ⬜ | `#responsive-dark-mode` | 반응형/다크 모드 미지원 |
| 27 | ⬜ | `#large-list-pagination` | 대량 목록 페이지네이션 미확인 |
| 28 | ✅ | `#private-visibility-default` | 팀/그룹/프로젝트 기본 비공개 가시성(소속 없으면 안 보임, 공개 설정 시 예외) |
| 29 | ✅ | `#document-priority` | 문서 우선순위(정수, review/pending 상태에서만 유효, CLI/MCP/SKILL 반영) |

---

## 1. 멤버십 & 세부 접근 권한

### `#access-overview-cross-project`
**오버라이드 일괄 조회가 프로젝트 단위뿐** - "이 설계자가 전체
설치에서 어떤 제한을 받고 있는지" 한 번에 보는 화면/명령이 없다
(프로젝트마다 `access-list`를 따로 조회해야 함).

## 2. 문서 타입/상태 체계

### `#doctype-edit-delete`
**DocType을 지우거나 이름(코드/라벨)을 바꿀 방법이 없다** - 지침
(guideline)만 수정 가능. 오타로 만든 타입을 정리할 수 없다.

### `#doctype-transition-delete`
**정의한 `DocStatusTransition`을 지울 방법이 없다** - 잘못 그은 전이를
되돌리려면 DB를 직접 만져야 한다(현재 유일한 경로).

## 3. 문서 CRUD

### `#document-bulk-actions`
**일괄 작업이 없다** - 문서 여러 개를 한 번에 상태 전이하거나 폴더로
옮기는 기능이 없다(하나씩 해야 함). 마이그레이션 직후처럼 문서가
몰려 있을 때 특히 아쉬움.

## 4. 문서 정리 폴더

### `#folder-delete-recursive`
**폴더 삭제 시 재귀 삭제/상위로 끌어올리기 옵션이 없다**(설계 당시에도
의도적으로 범위 밖으로 뺀 부분 - 폴더가 늘어난 프로젝트에서 실제로
아쉬울 수 있어 재검토 후보로 남겨둔다).

## 5. 질의/응답 (Q&A)

### `#question-bulk-ack`
**일괄 ack가 없다** - pending이 여러 건 쌓이면 하나씩 `question
ack`해야 한다. 마이그레이션 직후처럼 한꺼번에 밀렸을 때 불편.

### `#question-withdraw`
**질문을 취소/철회하는 기능이 없다** - 클로드가 등록한 질문이 더 이상
유효하지 않게 됐을 때(예: 관련 결정이 다른 경로로 이미 내려짐) 상태를
"철회"로 표시할 방법이 없다 - 지금은 그냥 방치되어 `pending list`에
계속 남는다.

## 6. 코멘트

### `#comment-edit-delete`
**코멘트 수정/삭제가 없다** - 등록 후 오탈자를 고치거나 잘못 단
코멘트를 지울 방법이 없다(해결 처리만 가능). 설계자 전용 채널이라
덜 급하지만 실사용 시 자주 걸릴 만한 공백.

## 7. 메시징

### `#message-edit-delete`
**메시지 수정/삭제가 없다**(코멘트와 같은 공백) - 잘못 보낸 메시지를
철회할 수 없다.

### `#message-wait-timeout-cap`
**`message wait`의 최대 타임아웃 상한이 코드/문서 어디에도 명시된
적이 없다** - 설계자가 과도하게 긴 타임아웃을 걸면 서버 자원을 오래
묶어둘 수 있는지 점검 필요.

## 8. 검색/인덱싱

### `#meilisearch-spof`
**Meilisearch가 단일 장애점** - "모든 조회가 검색 엔진을 거친다"는
설계 원칙 자체의 자연스러운 귀결이지만, Meilisearch가 죽으면 문서
읽기/쓰기가 전부 막힌다(DB는 멀쩡해도). 장애 시 사용자에게 보이는
에러가 "그냥 500"인지 "검색 엔진 연결 안 됨"처럼 원인을 알 수 있는
메시지인지는 점검해본 적이 없다 - 최소한 에러 메시지 품질만이라도
확인할 가치가 있다.

## 9. git 저장소 연동

### `#git-unlink`
**저장소 연결 해제(unlink) 기능이 실제로 없다** - 코드로 확인 완료
(`server.ts`엔 `GET /api/projects/:projectId/git/repo`뿐, `DELETE`
라우트 자체가 없음 - `gitRepos.ts`의 `gitea.deleteRepo()` 호출 2곳도
전부 `migrateRepo()` 인증 실패 시 남은 빈 stub 저장소를 내부적으로
정리하는 에러 처리 경로일 뿐, 사용자가 부르는 unlink 기능이 아님).
한 번 연결하면 다른 방식으로 바꾸거나 연결을 끊을 방법이 없다 - 실제
공백 확인됨, 필요해지면 별도 요청으로 설계.

### `#git-publish-pr-draft`
**동기화(발행)이 즉시 반영/AI 대기열 둘 중 하나로만 갈라진다** -
"PR 초안 자동 생성" 같은 중간 단계는 여전히 없다(의도된 설계 - 자동
PR은 범위 밖으로 명시적으로 남겨둠). 실사용 빈도가 높아지면 재검토할
여지.

## 10. push 훅 자동화

### `#hook-prompt-update`
**`PushHookPrompt` 수정(update) 라우트가 없다** - 생성/삭제만 있고,
트리거 브랜치나 프롬프트 내용을 바꾸려면 지우고 다시 만들어야 한다.

### `#hook-branch-pattern`
**브랜치 매칭이 정확히 일치 또는 전체뿐, 패턴(glob/regex) 매칭이
없다** - `release/*`처럼 브랜치 그룹을 한 규칙으로 묶을 수 없다.

### `#hook-queue-ttl`
**대기열 항목에 만료/자동 정리가 없다** - 아무도 안 봐서 영원히
pending으로 남는 항목이 쌓일 수 있다(정리 명령이나 TTL 없음).

## 11. 템플릿 관리

### `#template-history`
**템플릿 변경 이력이 없다** - override를 덮어쓰면 이전 내용이
사라진다(리비전 개념이 문서(Document)에는 있지만 템플릿에는 없음).
실수로 잘못된 내용을 배포하면 이전 버전을 복구할 방법이 없다.

## 12. 가이디드 마이그레이션

### `#migrate-idempotent`
**재실행이 멱등하지 않다**(이미 문서화된 한계) - 같은 매니페스트를
두 번 반영하면 문서가 중복 생성된다. `oldId` 기준으로 "이미
반영됐는지" 표시를 매니페스트에 남기는 정도의 가벼운 보강을 검토할
만하다(완전한 멱등성까지는 아니더라도 실수 방지 차원).

### `#migrate-status-mapping-preset`
**옛 상태 어휘 → 새 표준 코드 매핑 프리셋이 없다** - 매번 수작업으로
`docTypeCode`/`statusCode`를 고쳐야 한다. `concept` 스타일 문서가
흔한 소스라면, "active→approved" 같은 흔한 매핑을 제안해주는 옵션이
있으면 마이그레이션이 훨씬 수월해진다.

## 13. 웹 UI 전반

### `#responsive-dark-mode`
**반응형/다크 모드 미지원** - 지금까지 전부 데스크톱 뷰포트로만
검증했다. 개인 설치형 도구라 우선순위는 낮을 수 있지만, 실제 필요
여부는 설계자 판단.

### `#large-list-pagination`
**문서/폴더 대량 목록에서의 페이지네이션이 안 보인다** - 코드 확인
필요(목록이 전부 한 번에 로드되는 구조로 보임) - 문서 수가 많아지면
초기 로드가 느려질 수 있다.

