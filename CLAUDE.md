# CLAUDE.md

## 하네스: 태고 멀티뷰 개발

**목표:** 기능 수정·UI 개선·버그 수정을 구현 → 기기별 검증 → 성능 전후 비교 → 재수정까지 끝내고 근거와 함께 보고한다.

**트리거:** 멀티뷰 코드 변경 요청(모바일 UI, 타일, 레이아웃, 플레이어, 버그 수정, 성능 개선)과 그 후속(재검증, QA·성능만 다시, 실패 항목 재수정)은 `multiview-harness` 스킬을 사용하라. 단순 질문은 직접 답하고, 배포만 하는 요청은 `deploy-dev` 스킬을 쓴다.

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
| 2026-09-28 | 윈도우 지원: stack.sh가 dotnet 10 경로·LAN IP·포트 종료를 플랫폼별로 해결(pkill·lsof·ps -o 의존 제거), 플랫폼 차이 표와 "실행 중 API가 bin을 잠가 dotnet test·e2e 빌드를 막는다"(`-p:BaseOutputPath` 우회) 추가 | skills/multiview-local-env(+scripts/stack.sh), skills/mobile-verification | 맥북 작업을 윈도우에서 검증하며 stack.sh가 macOS 전용이라 손으로 띄웠고, 5180이 bin을 잠가 e2e·백엔드 테스트가 빌드 단계에서 실패 |
| 2026-09-28 | 재생 실패 타일 검증 절차 추가(`?breakEmbed=`, `--break-embed`): 드릴 사용법, "정지 화면의 재생 0개는 정상" 오판 주의, 타이머 수 == iframe 수 기준, 헤드리스 WebKit에서 재생 판정 불가(원인은 `MediaSource` 부재), Windows에서 RSS peak 측정 불가 | skills/mobile-verification, skills/perf-check | R-1 수정 시 임베드 실패를 재현할 수단이 없어(e2e는 오프라인, RTL 없음) 드릴을 새로 만들었고, QA가 정지 화면의 0개를 FAIL로 오판할 뻔했다 |
| 2026-09-28 | "재생이 되고 있는지 확인하는 법" 3단(canPlayType은 주장일 뿐 → MSE 존재 → 프레임 안 `<video>`의 `currentTime`) 추가, 헤드리스 WebKit 무재생의 원인을 H.264 부재 → `MediaSource` 부재로 정정 | skills/mobile-verification, skills/multiview-local-env, skills/perf-check | 직접 재 보니 `canPlayType`이 H.264를 `probably`로 답해 코덱 설명이 틀렸다. `video.error`가 `null`인데 소스가 붙은 적 없는 상태를 코덱 문제로 오진하고 있었다 |
| 2026-09-28 | 측정 규율 추가: 편차 큰 지표는 회수를 늘리고 안 되면 "판정 불가", 결과 디렉터리에 섞인 다른 실행 구분, 러너 계측을 넣었으면 계측 뺀 사본으로 분리 검증, 기준선에 없던 구성은 전후 비교가 아님 | skills/perf-check | long task가 실행 구간에 따라 3~16개로 흔들려 판정이 갈렸고, 계측 추가분이 메모리 수치에 섞였는지 분리해야 했다 |
