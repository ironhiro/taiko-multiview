---
name: code-review-harness
description: "태고 멀티뷰 종합 코드 리뷰 하네스의 오케스트레이터. 아키텍처·보안 취약점·성능 병목·코드 스타일을 네 감사 에이전트가 병렬로 감사하고, 통합 에이전트가 중복을 묶고 심각한 지적을 반박 검증해 하나의 리포트(_review/REPORT.md)로 만든다. '종합 코드 리뷰', '전체 코드 감사', '아키텍처/보안/성능/스타일 리뷰', 'PR 전에 전반적으로 봐줘', '브랜치 리뷰 리포트', '보안 취약점 점검해줘'(여러 영역을 함께 볼 때) 요청 시 반드시 사용. 후속: 리뷰 다시 실행, 보안만 다시, 이전 리뷰 대비 확인, 리포트 보완·업데이트 요청에도 사용. 단일 diff의 빠른 버그 찾기만 원하면 내장 /code-review를, 리뷰 결과를 고치는 작업은 multiview-harness를 쓴다."
---

# 종합 코드 리뷰 하네스

네 영역을 따로 깊게 보고, 한 곳에서 검증해 합친다. 영역별 감사관은 서로 독립이라 병렬로 돌고, 통합자가 오탐을 걸러 낸다.

## 실행 모드: 서브 에이전트 (팬아웃/팬인 + 검증)

팀 도구(TeamCreate/SendMessage 기반 팀)가 이 환경에 없어서 리더(이 스킬을 실행하는 메인 세션)가 `Agent` 도구로 호출한다. 감사관 넷은 **한 메시지에서 동시에** `run_in_background: true`로 띄우고, 넷이 모두 끝난 뒤 통합자를 부른다. 산출물은 파일로 주고받는다.

## 에이전트 구성

| 에이전트 | 정의 | 스킬 | 출력 |
|---|---|---|---|
| arch-reviewer | `.claude/agents/arch-reviewer.md` | code-audit (`references/architecture.md`) | `_review/02_architecture.md` |
| security-reviewer | `.claude/agents/security-reviewer.md` | code-audit (`references/security.md`) | `_review/02_security.md` |
| perf-reviewer | `.claude/agents/perf-reviewer.md` | code-audit (`references/performance.md`), perf-check(인용) | `_review/02_performance.md` |
| style-reviewer | `.claude/agents/style-reviewer.md` | code-audit (`references/style.md`) | `_review/02_style.md` |
| review-synthesizer | `.claude/agents/review-synthesizer.md` | code-audit | `_review/REPORT.md` |

**호출:** `Agent(subagent_type: "<이름>", model: "opus", run_in_background: true, prompt: ...)`. 이름이 subagent_type으로 인식되지 않으면 `general-purpose`로 부르고 프롬프트 첫 줄에 "먼저 `.claude/agents/<이름>.md`를 읽고 그 역할로 일하라". 프롬프트에는 범위 파일과 출력 파일의 절대 경로, "읽기 전용" 규칙을 넣는다.

`_review/`는 개발 하네스(multiview-harness)의 `_workspace/`와 분리되어 있어 두 하네스가 동시에 돌아도 섞이지 않는다.

## 진행 표시

에이전트가 백그라운드로 도는 동안 리더는 진행판(Artifact 페이지)을 단계마다 갱신해 사용자에게 보여 준다: 단계별 상태(완료/진행 중/대기/실패→재수정), 일하는 에이전트, 핵심 숫자(수용 기준, 전후 성능, 등급별 개수). 세션에 이미 진행판이 있으면 같은 파일로 다시 게시해 주소를 유지한다. 채팅으로 설명만 하지 않는다(사용자 요청, 2026-09-26).

## 워크플로우

### Phase 0: 컨텍스트 확인
- `_review/` 없음 → 초기 실행
- 있음 + 부분 재실행("보안만 다시") → 그 감사관만 다시 부르고 통합자를 다시 부른다(통합자는 이전 REPORT를 읽어 "이전 리뷰 대비"를 쓴다)
- 있음 + 새 리뷰 → `_review/`를 `_review_{YYYYMMDD_HHMMSS}/`로 옮기고 초기 실행

### Phase 1: 범위 정하기 (리더)
사용자 말에서 대상을 정한다. 말이 없으면 **현재 브랜치 vs main의 diff**가 기본이다.

| 요청 | 범위 |
|---|---|
| (기본) 브랜치 리뷰 | `git diff main...HEAD` + 작업 트리 미커밋 변경 |
| PR 번호 | `gh pr diff <번호>` |
| 경로 | 해당 경로 전체 |
| "전체", "전반적으로" | 저장소 전체(생성물·node_modules·bin/obj·폰트 제외) |

`_review/00_scope.md`에 쓴다: 대상, 기준 커밋(`git rev-parse --short HEAD`), 파일 목록(영역별로 대략 분류), diff 통계, 사용자가 특히 걱정한 점, 제외한 것. 작업 트리에 다른 작업(예: 개발 하네스)이 진행 중이면 그 사실과 "리뷰 도중 파일이 바뀔 수 있음"을 적는다.

### Phase 2: 병렬 감사
네 감사관을 한 메시지에서 동시에 띄운다. 모두 끝날 때까지 기다린다(완료 알림이 온다; 폴링하지 않는다).

### Phase 3: 통합·검증
review-synthesizer를 부른다. 입력은 `_review/00_scope.md`와 `_review/02_*.md` 넷.

### Phase 4: 보고 (리더)
`_review/REPORT.md`를 읽고 사용자에게 한국어로 요약한다:
- 등급별 개수 표, "먼저 고칠 것" 목록(제목·위치·비용), 기각된 지적 수
- 리포트 경로
- 다음 단계 제안: 고칠 항목을 고르면 multiview-harness로 수정·검증까지 진행 가능. 리포트를 팀과 공유하려면 페이지로 만들어 줄 수 있음(한 줄 제안).

## 데이터 흐름

```
00_scope.md ─┬─> [arch-reviewer]     02_architecture.md ─┐
             ├─> [security-reviewer] 02_security.md     ─┤
             ├─> [perf-reviewer]     02_performance.md  ─┼─> [review-synthesizer] ─> REPORT.md ─> 리더 요약
             └─> [style-reviewer]    02_style.md        ─┘      (중복 묶기, high+ 반박 검증)
```

## 에러 핸들링

| 상황 | 대응 |
|---|---|
| 감사관 1명 실패 | 1회 재호출. 재실패 시 그 영역 없이 통합, 리포트에 "감사 누락" 명시 |
| 감사관 과반 실패 | 사용자에게 알리고 진행 여부 확인 |
| 통합자 실패 | 1회 재호출. 재실패 시 리더가 네 보고서를 등급순으로 이어 붙인 임시 리포트를 만들고 "검증 안 됨"을 명시 |
| 감사 중 작업 트리 변경 | 리포트의 줄 번호가 어긋날 수 있음을 한계에 적고, 기준 커밋을 명시 |
| 감사관이 저장소 파일을 고침 | 규칙 위반. `git diff`로 확인하고 되돌린 뒤 보고 |
| 통합자의 REPORT.md 쓰기가 권한에서 막힘 | 리더가 대신 쓰지 않는다(권한 결정 우회). 통합자의 반환 본문을 받아 두고 사용자에게 저장 여부를 묻는다. 승인되면 본문 그대로 저장하고 리포트 머리에 그 사실을 적는다. 반복되면 `_review/` 쓰기 허용 규칙 추가를 제안 |

## 테스트 시나리오

**정상 흐름.** "PR 올리기 전에 종합 리뷰해줘" → 범위: `mobile-chat-and-load-test` vs main diff + 미커밋 변경 → 네 감사관 병렬 → 각 02_*.md → 통합자가 high 3건 반박 검증(1건 기각) → REPORT.md → 리더가 "먼저 고칠 것 2건"과 경로를 보고.

**에러 흐름.** perf-reviewer가 타임아웃 → 1회 재호출도 실패 → 통합자가 세 영역으로 리포트 작성, 표의 성능 칸 "감사 누락", 한계 절에 명시 → 리더가 "성능만 다시" 재실행을 제안.
