# 설계 진행 기록

시스템이 자기 자신의 설계를 담을 만큼 성숙하기 전까지, 이 저장소의
진행 상황은 이 파일에 평범한 마크다운으로 기록한다(Phase 0 완료 후
가이디드 마이그레이션으로 시스템 안으로 옮길 예정 - 전체 배경은
[README.md](README.md) 참고).

## Phase 0 - 완료 (2026-09-10)

백엔드 스캐폴딩. 상세 범위는 커밋 메시지와 README 참고. 검증은 로컬
SQLite와 전체 Docker Compose 스택(Postgres+Meilisearch+EMQX+backend)
양쪽에서 CRUD/검색 동기화/실시간 발행/Question-Answer 자동 전이까지
end-to-end로 실측했다.

미구현으로 남겨둔 부분(의도된 것 - 501 스텁):
- `git log/diff/blame/show` 계열 - Gitea 연동(Phase 2) 전까지 저장소
  자체가 없음.
- `message send/receive`, `message wait` - EMQX 구독 측 인프라(Phase 4)
  전까지 발행만 가능하고 수신 경로가 없음.

## 다음 단계

Phase 1(MCP 서버 + Skill + CLAUDE.md 템플릿 관리)은 아직 착수 전 -
설계자 승인 후 시작한다. Skill/CLAUDE.md 템플릿 본문에 반드시 포함할
두 가지 행동 규칙이 이미 확정돼 있다:
1. 문서/설계 제안 시 추적 코드(`XX-XXXXXXXX`) 명시.
2. 편집용 로컬 스크래치 사본은 정상 작업 방식이지만, 절대 프로젝트
   git 저장소에 커밋하지 않는다.
