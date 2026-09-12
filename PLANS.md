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
| 7 | ✅ | `#access-overview-cross-project` | 설계자별 접근 제한 프로젝트 횡단 일괄 조회(본인 CLI/MCP/웹, 관리자 CLI/웹) |
| 8 | ✅ | `#doctype-edit-delete` | DocType 이름 수정(기본 타입 제외)/삭제(문서 없을 때만) |
| 9 | ✅ | `#doctype-transition-delete` | DocStatusTransition 삭제(참조 무결성 가드 없음) |
| 10 | ✅ | `#document-bulk-actions` | 문서 일괄 상태 전이(웹/CLI/MCP)/폴더 이동(웹 전용), 항목별 결과 |
| 11 | ✅ | `#folder-delete-recursive` | 폴더 삭제 시 재귀 삭제/상위로 끌어올리기 선택 가능 |
| 12 | ✅ | `#question-bulk-ack` | 질문 일괄 ack(CLI/MCP 전용, 항목별 결과) |
| 13 | ✅ | `#question-withdraw` | 질문 철회(open 상태·본인만, CLI/MCP/웹) |
| 14 | ✅ | `#comment-edit-delete` | 이미 구현돼 있었음 - 문서만 정리(코드 변경 없음) |
| 15 | ✅ | `#message-edit-delete` | 메시지 수정/삭제(본인만, CLI/MCP/웹) |
| 16 | ✅ | `#message-wait-timeout-cap` | 서버 단일 호출 10초 상한 + CLI/MCP 폴링으로 전체 대기 구현 |
| 17 | ✅ | `#meilisearch-spof` | Meilisearch 장애 시 503+명확한 메시지 응답, 색인 쓰기는 큐+워커로 자동 재처리 |
| 18 | ✅ | `#git-unlink` | 외부 연동 해제(자체 호스팅으로 전환) - 자체 호스팅은 프로젝트 삭제 전엔 해제 불가 |
| 19 | ✅ | `#git-publish-pr-draft` | 의도된 설계로 재확인 - 자동 PR 생성은 범위 밖(문서만 정리, 코드 변경 없음) |
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
| 30 | ⬜ | `#document-write-gate-bypass-search` | 문서 수정/삭제/전이 등의 사전 권한 확인이 검색 엔진을 거쳐 Meilisearch 장애 중엔 아예 막힘(생성만 예외) |
| 31 | ✅ | `#message-wait-mqtt-direct` | message wait을 백엔드 폴링에서 CLI/MCP 직접 MQTT 구독으로 전환(설계자 지시, HTTP 폴링은 폴백으로 유지) |

---

## 8. 검색/인덱싱

### `#document-write-gate-bypass-search`
**문서 수정/삭제/전이 등 라우트의 사전 권한 확인이 검색 엔진을
거쳐서, Meilisearch 장애 중엔 새 문서 생성만 안전하고 기존 문서
조작은 아예 시도되지도 못하고 막힌다** - `#meilisearch-spof`
구현·실측 중 발견. `server.ts`의 `/api/documents/:trackingCode`
계열 라우트(PUT/DELETE/transition/priority/links/backlinks/
revisions/source-links/access/folder, 두 bulk 라우트 포함) 전부가
실제 작업 전에 `getDocument()`(검색 엔진 경유)를 먼저 호출해
{projectId, docTypeId, id}만 뽑아 권한 확인용으로 쓴다 - 그런데 이
호출 직후 대부분의 core 함수(`saveDocumentBody`/`deleteDocument`/
`transitionDocumentStatus` 등)가 **자기 자신도 DB를 다시 직접
읽는다** - 즉 평소에도 중복 조회다. Meilisearch가 죽으면 이 사전
조회 자체가 503으로 막혀 그 뒤의 실제 쓰기 단계(`#meilisearch-spof`가
큐로 보호한 지점)에 도달하지 못한다 - 데이터가 조용히 유실되는 건
아니지만(명확한 503으로 안전하게 막힘), 새 문서 생성보다 보호 범위가
좁은 비대칭이다. 이 사전 확인을 DB 직접 조회(예:
`getDocumentAccessInfo(trackingCode)` 같은 경량 함수 신설)로
바꾸면 중복 조회도 없어지고 장애 중에도 기존 문서 수정/삭제/전이가
막히지 않게 되지만, 15개 이상의 라우트를 건드리는 변경이라 별도
라운드로 남겨둔다.

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

