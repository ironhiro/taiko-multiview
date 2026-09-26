# CLAUDE.md

## 하네스: 태고 멀티뷰 개발

**목표:** 기능 수정·UI 개선·버그 수정을 구현 → 기기별 검증 → 성능 전후 비교 → 재수정까지 끝내고 근거와 함께 보고한다.

**트리거:** 멀티뷰 코드 변경 요청(모바일 UI, 채팅, 타일, 레이아웃, 플레이어, 버그 수정, 성능 개선)과 그 후속(재검증, QA·성능만 다시, 실패 항목 재수정)은 `multiview-harness` 스킬을 사용하라. 단순 질문은 직접 답하고, 배포만 하는 요청은 `deploy-dev` 스킬을 쓴다.

## 하네스: 종합 코드 리뷰

**목표:** 아키텍처·보안·성능·코드 스타일을 병렬로 감사하고, 중복을 묶고 심각한 지적을 반박 검증해 하나의 리포트(`_review/REPORT.md`)로 만든다.

**트리거:** 여러 영역을 함께 보는 리뷰·감사 요청(종합 코드 리뷰, PR 전 전반 점검, 보안·성능·아키텍처·스타일 리뷰)과 그 후속(재실행, 영역만 다시, 이전 리뷰 대비)은 `code-review-harness` 스킬을 사용하라. 단일 diff의 빠른 버그 찾기는 내장 `/code-review`, 리뷰 결과 수정은 `multiview-harness`.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-09-26 | 초기 구성: 에이전트 3(multiview-dev, device-qa, perf-analyst), 스킬 5(multiview-harness, multiview-local-env, mobile-verification, perf-check, deploy-dev), 스크립트 2(stack.sh, shoot.mjs) | 전체 | 모바일 UI 수정·검증·성능 측정·배포를 수동으로 반복하던 흐름을 자동화 |
| 2026-09-26 | 로그 위치 찾는 법 추가(stack.sh 밖에서 띄운 서버) | skills/multiview-local-env | 첫 실행에서 device-qa가 안내된 로그 경로와 실제 경로 불일치 보고 |
| 2026-09-26 | 종합 코드 리뷰 하네스 추가: 에이전트 5(arch/security/perf/style-reviewer, review-synthesizer), 스킬 2(code-review-harness, code-audit + 영역별 references 4) | 전체 | 사용자 요청: 네 영역 병렬 감사 → 통합 리포트 |
| 2026-09-26 | 통합자 쓰기 차단 시 처리 규칙, 리뷰 발견 버그를 성능 비교 전 재수정에 넣는 규칙 추가 | skills/code-review-harness, skills/multiview-harness | 리뷰 첫 실행: 통합자 REPORT.md 쓰기 차단, R-1 버그를 개발 하네스 진행 중 발견 |
| 2026-09-26 | 진행 표시 규칙 추가: 백그라운드 실행 중 진행판(Artifact) 단계별 갱신 | skills/multiview-harness, skills/code-review-harness | 사용자 요청: "백그라운드로 진행하면 시각화해서 보여줘" |
