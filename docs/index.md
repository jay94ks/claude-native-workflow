# 문서 목차

v3 설계/작업 기록은 이 디렉토리(`docs/`)에 모아두고, 새 문서를 추가할
때마다 이 파일에 항목을 추가한다.

각 문서 파일은 설계에서 정의한 문서 엔티티 모델과 동일한 구조의 YAML
frontmatter(`id`/`parent_id`/`type`/`kind`/`state`/`branch`/
`commit_id`/`title`/`author`/`related`)를 최상단에 둔다 - 나중에
실제 시스템으로 마이그레이션할 때 그대로 매핑할 수 있게 하기
위함이다.

| 추적 코드 | 문서 | 설명 |
| --- | --- | --- |
| SP-XJQCTF6Y | [design-notes.md](design-notes.md) | 설계 논의 기록 (라운드별 챕터) |
| SP-PSTRUCT01 | [project-structure.md](project-structure.md) | 지금 시점의 프로젝트 구조/구현 현황 요약 (CLAUDE.md에서 이관) |
| PL-PLANURL01 | [plan-pr-code-url-scheme.md](plan-pr-code-url-scheme.md) | 완료: PR/Code URL 체계 개편 |
| PL-PLANQA001 | [plan-qa-card-redesign.md](plan-qa-card-redesign.md) | 완료: Q&A/opinion 카드 UI 재설계 |
| PL-PLANACCT1 | [plan-account-management.md](plan-account-management.md) | 완료: 계정 관리(임시 비밀번호 재설정, 비활성화/삭제) |
| PL-PLANNICKN | [plan-nickname-apikey-policy.md](plan-nickname-apikey-policy.md) | 완료: 닉네임 정책 + 개인/프로젝트별 API 키 세분화 |
| PL-PLANGITEA | [plan-gitea-provisioning.md](plan-gitea-provisioning.md) | 완료: Gitea 서버 실제 프로비저닝 |
| PL-QAFULL01 | [plan-full-qa.md](plan-full-qa.md) | 완료: 전체 시스템 QA(액션 64개 + 프론트엔드 전 화면, 버그 4건 발견·수정) |
| PL-PLANFEUI | [plan-frontend-consistency.md](plan-frontend-consistency.md) | 완료: 프론트엔드 UI 일관성 정리(헤더/다이얼로그/폼/여백/색 통일) |
| PL-PLANACT01 | [plan-activity-heatmap.md](plan-activity-heatmap.md) | 완료: 문서 코드별 활동 히트맵/로그 - 종합 현황에 표시 |
| PL-PLANDK01 | [plan-doc-kind-management.md](plan-doc-kind-management.md) | 완료: 문서 분류(kind) 추가/수정 + 분류별 지침 관리 |
| PL-PLANGHOA | [plan-github-push-mirror-oauth.md](plan-github-push-mirror-oauth.md) | 완료: GitHub OAuth 연결 - push-mirror 설정 화면에 추가 |
| PL-PLANUXQA1 | [plan-ux-qa-improvements.md](plan-ux-qa-improvements.md) | 완료: 사용자 편의성 관점 UI QA + 개선 계획(F1~F7 전부 처리 - 수정 4건, 결정 1건, 결론 2건) |
