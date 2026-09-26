---
name: multiview-harness
description: "태고 멀티뷰 개발 하네스의 오케스트레이터. 기능 수정·UI 개선·버그 수정 요청을 구현(multiview-dev) → 기기별 검증(device-qa) + 성능 전후 비교(perf-analyst) → 실패 시 재수정 루프로 처리하고 결과를 보고한다. '모바일 UI 개선', '채팅창 고쳐줘', '타일/레이아웃 수정', '버그 수정하고 검증까지', '성능 회귀 없는지 확인하면서 바꿔줘', '하네스로 해줘' 요청 시 반드시 사용. 후속 작업: 다시 실행, 재검증, QA만 다시, 성능만 다시 측정, 이전 결과 기반으로 수정·보완·업데이트, 실패 항목만 다시 고쳐줘 요청에도 이 스킬을 사용. 단순 질문(비용, 사용법)이나 배포만 하는 요청은 직접 답하거나 deploy-dev 스킬을 쓴다."
---

# 태고 멀티뷰 개발 하네스

요청 하나를 "구현 → 검증 → (실패 시) 재수정"까지 끝내고, 측정 근거와 함께 보고한다.

## 실행 모드: 서브 에이전트 (생성-검증 패턴)

이 환경에는 팀 도구(TeamCreate/TaskCreate)가 없어서, 리더(이 스킬을 실행하는 메인 세션)가 `Agent` 도구로 에이전트를 호출하고 `_workspace/` 파일로 결과를 주고받는다. 재수정은 같은 에이전트에 `SendMessage`로 이어서 지시해 맥락을 유지한다.

## 에이전트 구성

| 에이전트 | 정의 | 스킬 | 출력 |
|---|---|---|---|
| multiview-dev | `.claude/agents/multiview-dev.md` | multiview-local-env | `_workspace/03_dev_changes.md` |
| device-qa | `.claude/agents/device-qa.md` | mobile-verification, multiview-local-env | `_workspace/04_qa_report.md`, `_workspace/shots*/` |
| perf-analyst | `.claude/agents/perf-analyst.md` | perf-check, multiview-local-env | `_workspace/02_perf_baseline.md`, `_workspace/04_perf_report.md` |

**호출 방법:** `Agent(subagent_type: "<에이전트 이름>", model: "opus", prompt: ...)`. 에이전트 이름이 subagent_type으로 인식되지 않으면(세션 재시작 전 등) `subagent_type: "general-purpose"`로 호출하고 프롬프트 첫 줄에 "먼저 `.claude/agents/<이름>.md`를 읽고 그 역할로 일하라"를 넣는다. 프롬프트에는 항상 사용할 스킬 이름과 입력·출력 파일의 절대 경로를 적는다.

## 진행 표시

에이전트가 백그라운드로 도는 동안 리더는 진행판(Artifact 페이지)을 단계마다 갱신해 사용자에게 보여 준다: 단계별 상태(완료/진행 중/대기/실패→재수정), 일하는 에이전트, 핵심 숫자(수용 기준, 전후 성능, 등급별 개수). 세션에 이미 진행판이 있으면 같은 파일로 다시 게시해 주소를 유지한다. 채팅으로 설명만 하지 않는다(사용자 요청, 2026-09-26).

## 워크플로우

### Phase 0: 컨텍스트 확인
- `_workspace/`가 없으면 → 초기 실행
- 있고 사용자가 부분 수정·재검증을 요청 → 부분 재실행: 해당 에이전트만, 이전 보고서 경로를 주고 호출
- 있고 새 요청 → `_workspace/`를 `_workspace_{YYYYMMDD_HHMMSS}/`로 옮기고 초기 실행

### Phase 1: 요청 정리 (리더)
`_workspace/00_input/request.md`를 쓴다:
- 목표와 배경(사용자가 겪은 증상 원문 포함)
- 범위: 프론트/백엔드, 폰/데스크톱, 영향 받는 화면
- **수용 기준**: 측정 가능한 문장으로(예: "iPhone SE에서 채팅 프레임 아래끝 ≤ 안내문 위끝")
- 성능 영향 여부: 타일·플레이어·스크롤·채팅·레이아웃 코드를 건드리면 "있음"
- 모호한 부분이 결과를 바꾸면 여기서 사용자에게 먼저 묻는다(한 번에 모아서)

### Phase 2: 기준선 (성능 영향 있음일 때만)
perf-analyst를 호출해 **변경 전** 기준선을 잰다 → `02_perf_baseline.md`. multiview-dev가 파일을 바꾸기 시작하면 기준선이 오염되므로 이 단계가 끝난 뒤 Phase 3로 간다.

### Phase 3: 구현
multiview-dev 호출 → 코드 변경, 타입체크·단위 테스트, `03_dev_changes.md`.

### Phase 4: 검증 (순서대로)
1. device-qa 호출 → `04_qa_report.md`
2. 성능 영향 있음이면 perf-analyst 호출 → `04_perf_report.md`

둘을 동시에 돌리지 않는다. 브라우저 여러 개가 겹치면 성능 수치가 흔들린다.

### Phase 5: 재수정 루프 (최대 2라운드)
QA가 FAIL이거나 성능 회귀가 있으면: 실패 항목만 추려 multiview-dev에 `SendMessage`로 전달 → 수정 → 실패했던 쪽만 다시 검증. 2라운드 뒤에도 실패면 멈추고 사용자에게 상황과 선택지를 보고한다.

종합 코드 리뷰(code-review-harness)가 같은 코드에서 확인된 버그를 찾으면, 성능 전후 비교 **전에** 그 수정을 한 라운드로 넣는다(측정을 두 번 하지 않도록). 2라운드 한도를 넘기면 사용자 승인을 받는다.

### Phase 6: 보고 (리더)
사용자에게 한국어로:
- 무엇을 바꿨고(파일 단위 요약), 무엇으로 확인했는지(숫자, 테스트 수)
- 성능 전후 표(해당 시)
- 에뮬레이터로 확인 못 한 것과 **실제 기기에서 볼 주소·항목**
- 커밋·배포는 하지 않은 상태임을 알리고, 원하면 커밋(나눠서) → PR → deploy-dev 순으로 진행을 제안

`_workspace/`는 지우지 않는다(git 제외됨).

## 데이터 흐름

```
request.md ─┬─> [perf-analyst] 02_perf_baseline.md ──────────────┐
            └─> [multiview-dev] 03_dev_changes.md                 │
                        ├─> [device-qa] 04_qa_report.md ──┐       │
                        └─> [perf-analyst] 04_perf_report.md <────┘
                                   FAIL/회귀 ─> SendMessage(multiview-dev) ─> 재검증
                                   PASS ─> 리더 보고
```

## 에러 핸들링

| 상황 | 대응 |
|---|---|
| 에이전트 실패·중단 | 1회 재호출. 재실패 시 그 단계 결과 없이 진행하고 보고서에 누락 명시 |
| 서버가 안 뜸 | multiview-local-env의 로그 확인 후 사용자에게 보고. 추측으로 진행하지 않음 |
| 요구가 브라우저·유튜브 제약상 불가 | 우회 구현을 강행하지 말고 대안과 함께 사용자에게 선택을 받음 |
| QA와 성능 결론 충돌(예: UI 통과, 성능 회귀) | 둘 다 보고, 삭제하지 않음. 트레이드오프를 표로 제시 |
| 작업 트리가 예상과 다르게 바뀜 | 멈추고 `git diff`로 확인. 에이전트의 임시 변경(뮤테이션 체크 등)이 남았으면 되돌림 |

## 테스트 시나리오

**정상 흐름.** "채팅창 안내문이 채팅에 가려져" → Phase 1 수용 기준: 4개 기기에서 프레임 아래끝 ≤ 안내문 위끝 → 성능 영향 없음, Phase 2 생략 → dev가 clip-path로 수정 → QA가 shoot.mjs `--chat`으로 측정, e2e 통과 → PASS → 보고(실제 iPhone Chrome에서 볼 항목 명시).

**에러 흐름.** "스크롤 시 사파리가 죽어" → 성능 영향 있음 → 기준선 players built 21 → dev가 플레이어 예산 3 도입 → perf 결과 13으로 목표(≤6) 미달 = 회귀는 아니나 수용 기준 FAIL → SendMessage로 재수정 요청(예산 값 비교 측정 제안) → 예산 4로 players built 4 → PASS → 보고(실제 기기 메모리는 미확인 명시).
