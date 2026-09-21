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
