---
name: code-audit
description: "태고 멀티뷰 코드 감사의 공통 규칙: 발견 사항(finding) 형식, 심각도 기준, 증거 요건, 영역별 점검표(아키텍처·보안·성능·코드 스타일). code-review-harness의 감사 에이전트(arch/security/perf/style-reviewer)와 review-synthesizer가 감사를 시작하기 전에 반드시 읽는다. 단독으로 '보안 점검', '아키텍처 리뷰', '성능 병목 찾아줘', '코드 스타일 검토'를 요청받았을 때도 이 스킬의 해당 references를 사용."
---

# 코드 감사 공통 규칙

감사의 가치는 **맞는 발견을 적게** 내는 데 있다. 추측성 지적 열 개보다 재현 경로가 있는 지적 하나가 낫다. 오탐은 통합 단계에서 반박 검증으로 걸러지므로, 확신이 없으면 심각도를 낮추고 "확인 필요"로 적는다.

## 영역별 점검표 (자기 영역 것만 읽는다)

| 영역 | 파일 |
|---|---|
| 아키텍처 | `references/architecture.md` |
| 보안 | `references/security.md` |
| 성능 | `references/performance.md` |
| 코드 스타일 | `references/style.md` |

점검표는 출발점이다. 목록에 없어도 실제 문제면 보고하고, 목록에 있어도 해당 없으면 건너뛴다.

## 이 저장소의 지도

- `backend/TaikoLabs.Api/`: .NET 10 최소 API. `Program.cs`(엔드포인트·미들웨어), `Services/`(폴링, 저장소, 일정, YouTube 클라이언트), `Models/`, `venues.json`(매장 설정, 편집기가 씀)
- `frontend/src/`: React 18 + Vite. `App.tsx`, `components/`(PlayerTile이 핵심), `lib/`(순수 로직, 테스트 동반), `editor/`(매장 편집기), `styles.css`·`tokens.css`(설계는 `design.md`)
- `desktop/shell/`: Tauri 2 셸(Rust). `src-tauri/src/main.rs`, `editor.rs`(venues.json 파일 쓰기), `capabilities/`
- 배포: 루트 `Dockerfile` → ghcr → Azure Container Apps. CI `.github/workflows/ci.yml`
- 테스트: `backend/TaikoLabs.Api.Tests`(xUnit), `frontend/src/**/*.test.ts`(vitest), `frontend/e2e`(Playwright, Mock 백엔드)

## 발견 사항 형식

영역 보고서(`_review/02_{영역}.md`)는 요약 몇 줄 뒤에 발견 사항을 아래 형식으로 나열한다.

```markdown
### [ARCH-3] 한 줄 제목
- 심각도: critical | high | medium | low | info
- 확신도: 확인됨 | 가능성 높음 | 확인 필요
- 위치: `path/to/file.ts:123` (여러 곳이면 모두)
- 근거: 코드 인용(짧게)과 왜 문제인지
- 시나리오: 구체적 입력·상태 → 잘못된 결과 (보안은 공격 경로, 성능은 조건과 규모)
- 제안: 고치는 방향(코드 전문 대신 방향과 핵심 줄)
```

ID 접두어: `ARCH`, `SEC`, `PERF`, `STYLE`.

## 심각도 기준

| 등급 | 뜻 | 예 |
|---|---|---|
| critical | 지금 악용되거나 데이터·서비스를 잃는다 | 비밀키 노출, 인증 없는 파괴적 엔드포인트 |
| high | 현실적 조건에서 사용자에게 문제가 생긴다 | 폰에서 탭이 죽는 메모리 누수, 쿼터를 태우는 루프 |
| medium | 조건이 드물거나 영향이 제한적 | 특정 기기에서만 깨지는 레이아웃, 경합 조건 |
| low | 유지보수·가독성 비용 | 중복 로직, 오해를 부르는 이름 |
| info | 참고·칭찬할 설계 | 잘 된 패턴, 문서화할 가치 |

## 증거 요건

- 모든 발견에는 `파일:줄`이 있어야 한다. 줄 번호는 지금 파일 기준으로 확인한다.
- "~할 수 있다"로 끝내지 말고 시나리오를 쓴다. 시나리오를 못 쓰면 확신도를 "확인 필요"로.
- 코드를 실제로 읽고 쓴다. 파일 이름이나 grep 한 줄만 보고 판단하지 않는다.
- 이미 코드 주석이 의도적 선택이라 설명한 것(예: "connect-src is left open on purpose")은 그 이유를 반박할 근거가 있을 때만 지적한다.

## 감사 범위 규칙

- 범위(`_review/00_scope.md`)가 diff면 바뀐 줄과 그 호출자·피호출자까지만. 전체 감사면 영역 점검표 순서대로.
- **읽기 전용.** 저장소 파일을 고치지 않는다. 도구 실행(`npm audit`, `dotnet list package --vulnerable`, grep, 테스트 실행)은 된다. 서버를 띄우거나 멈추지 않는다.
