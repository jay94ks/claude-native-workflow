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
| 20 | ✅ | `#hook-prompt-update` | PushHookPrompt 부분 갱신(update) - 브랜치/프롬프트 내용, CLI/MCP |
| 21 | ✅ | `#hook-branch-pattern` | 브랜치 조건에 `*` glob 패턴 지원(예: `release/*`, 세그먼트 안에서만) |
| 22 | ✅ | `#hook-queue-ttl` | pending 30일 방치 시 자동 expired 전이(주기 워커, 삭제 아님) |
| 23 | ✅ | `#template-history` | 템플릿 변경 이력(리비전) - 덮어쓰기 직전 내용을 스냅샷, 복원은 재저장 방식(Document 리비전과 동일 패턴) |
| 24 | ✅ | `#migrate-idempotent` | 가이디드 마이그레이션 재실행 안전장치 - 매니페스트에 appliedTrackingCode를 남겨 이미 반영된 항목은 재생성 안 함, 실패 항목만 자동 재시도 |
| 25 | ✅ | `#migrate-status-mapping-preset` | 옛 상태 어휘(active/wip 등) → 표준 코드 자동 제안(`--no-status-preset`으로 끌 수 있음) |
| 26 | ✅ | `#responsive-dark-mode` | 1단계(기반+셸+대표 화면 6개) - 테마 토큰/토글/반응형 셸 기반 구축 |
| 27 | ✅ | `#large-list-pagination` | 문서 참조 선택기/변경 추적 문서 이력 선택도 검색·페이지네이션 기반으로 전환(폴더는 트리 구조라 범위 밖) |
| 28 | ✅ | `#private-visibility-default` | 팀/그룹/프로젝트 기본 비공개 가시성(소속 없으면 안 보임, 공개 설정 시 예외) |
| 29 | ✅ | `#document-priority` | 문서 우선순위(정수, review/pending 상태에서만 유효, CLI/MCP/SKILL 반영) |
| 30 | ✅ | `#document-write-gate-bypass-search` | 문서 수정/삭제/전이 등의 사전 권한 확인을 DB 직접 조회로 전환 - Meilisearch 장애 중에도 안 막힘(내용 조회만 예외) |
| 31 | ✅ | `#message-wait-mqtt-direct` | message wait을 백엔드 폴링에서 CLI/MCP 직접 MQTT 구독으로 전환(설계자 지시, HTTP 폴링은 폴백으로 유지) |
| 32 | ✅ | `#doctype-transition-ai-governed` | DocStatusTransition(설계자 CRUD) 완전 제거 - draft 재진입 금지만 하드 규칙, 나머지 전이는 AI가 판단(설계자 지시) |
| 33 | ✅ | `#doctype-status-auto-seed` | DocType 생성 시 표준 상태 6개를 항상 자동으로 심음 - 개별 추가/일괄 적용 CRUD 제거(설계자 지시) |
| 34 | ✅ | `#responsive-dark-mode-phase2` | 나머지 ~40개 뷰/컴포넌트 전부 색상 토큰화 완료(46개 파일 전체가 이제 App.vue 테마 토큰 사용) |
| 35 | ✅ | `#kanban-touch-dnd` | 칸반 보드가 순수 HTML5 드래그라 터치 기기에서 카드 이동이 안 됨 - `vuedraggable`(SortableJS) 도입으로 마우스/터치 통합 드래그 지원 |
| 36 | ✅ | `#document-folder-tree` | 문서 탭을 폴더+문서 통합 트리 뷰로 전환(드래그 재배치, 임의 깊이 하위 폴더, 미분류 문서 가상 노드, 문서 유형 필터, 문서 읽기 페이지의 폴더 다이얼로그) |
| 37 | ✅ | `#message-processing-status` | 메시지 분류에 "처리중" 추가(대기→처리중→기록, ack/complete 명시적 전이) - 대기 상태 메시지는 수정 불가·삭제만 가능 |
| 38 | ✅ | `#full-feature-regression-qa` | FEATURES.md 21개 절 전체 회귀 QA 순회(실제 Docker 스택 + 실제 Gitea 웹훅 왕복) - 닉네임이 CLI/MCP `profile set`에서 빠져있던 것 발견·수정 |
| 39 | ✅ | `#document-nav-stale-content` | 사이드바에서 다른 문서를 눌러도 URL만 바뀌고 화면 내용이 안 바뀌던 버그 수정(Vue Router 컴포넌트 재사용 + trackingCode watch 누락) |

---

