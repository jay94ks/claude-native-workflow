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
