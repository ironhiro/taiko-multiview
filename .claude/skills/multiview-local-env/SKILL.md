---
name: multiview-local-env
description: "태고 멀티뷰의 로컬 실행 환경(백엔드 .NET API, Vite 프론트엔드, Mock 매장, 개발 서버 API 프록시)을 띄우고 멈추고 상태를 확인하는 방법. 로컬 서버 실행, mock 서버, 개발 서버 데이터로 로컬 확인, 포트, dotnet 버전 문제, 폰에서 로컬 접속, 'npm run dev가 안 떠요' 같은 요청이나, 다른 스킬(mobile-verification, perf-check)이 서버가 필요할 때 반드시 이 스킬을 먼저 사용."
---

# 로컬 실행 환경

멀티뷰는 .NET 10 API(`backend/TaikoLabs.Api`)와 Vite/React 프론트엔드(`frontend`)로 되어 있다. 검증과 측정은 늘 둘 중 하나의 스택 위에서 한다.

## 스택 고르기

| 스택 | 명령 | 포트 | 언제 |
|---|---|---|---|
| mock | `.claude/skills/multiview-local-env/scripts/stack.sh mock` | API 5180, 웹 5173 | 성능 측정, 매장·기체 수를 바꿔 보는 실험. 모든 기체가 실제 24시간 라이브를 재생 |
| devapi | `.claude/skills/multiview-local-env/scripts/stack.sh devapi` | 웹 5175 | 실제 매장·실제 방송으로 화면 확인. API는 배포된 개발 서버 |

`stack.sh status`로 상태를 보고, `stack.sh stop`으로 멈춘다. 이미 떠 있으면 다시 띄우지 않는다. 사용자가 폰으로 보고 있을 수 있으니 **작업이 끝나도 멋대로 멈추지 않는다.**

두 스택 모두 Vite는 `--host`로 떠서 같은 와이파이의 폰이 `http://<LAN IP>:<포트>/`로 접속할 수 있다. LAN IP는 `ipconfig getifaddr en0`으로 확인한다.

## 이 PC에서 걸리는 것들

- **dotnet 버전.** PATH의 `dotnet`은 Homebrew .NET 8이고, API는 .NET 10이 필요하다. `/usr/local/share/dotnet/dotnet`에 10.0이 있으므로 `DOTNET_ROOT=/usr/local/share/dotnet /usr/local/share/dotnet/dotnet ...`으로 실행한다. stack.sh는 이미 이렇게 한다. e2e는 `DOTNET=/usr/local/share/dotnet/dotnet DOTNET_ROOT=/usr/local/share/dotnet npx playwright test`.
- **Mock 매장.** `ASPNETCORE_ENVIRONMENT=Mock`은 `appsettings.Mock.json`을 읽는다. 매장은 `venues.mock.json`(git 제외), 방송은 `YouTube:MockVideoIds`의 실제 24시간 라이브다. 매장 수를 바꾸려면 `node scripts/mock-venues.mjs --venues N --stations M`. API가 파일 변경을 감지해 다시 읽는다.
- **e2e용 Mock은 다르다.** Playwright e2e(`frontend/playwright.config.ts`)는 5190/5174에 자체 서버를 띄운다. `MockVideoIds` 없이 가짜 id, 임베드 불가, 네트워크 없음. 그래서 e2e는 플레이어 재생을 검증하지 못하고, 그건 perf-check나 mobile-verification이 맡는다.
- **헤드리스 브라우저와 유튜브.** 유튜브는 `HeadlessChrome` UA에 "오래된 브라우저" 페이지를 준다. Playwright 컨텍스트의 userAgent에서 `HeadlessChrome`을 `Chrome`으로 바꾼다. 유튜브 플레이어는 뜨는 데 몇 초 걸리니 충분히 기다린다.
- **실제 방송 id.** 임베드 가능 여부는 바뀐다. 오늘 확인된 것은 `4xDzrJKXOOY`, `S_MOd40zlYU`(둘 다 lofi girl 계열 24시간 라이브). `jfKfPfyJRdk` 등은 localhost에서 오류 150(임베드 거부)이었다.
- **공개 레지스트리 push**(ghcr.io)는 이 세션의 권한 검사에 막힌다. 배포 절차는 deploy-dev 스킬을 본다.

## 로그

`$TMPDIR/taiko-stack-api.log`, `taiko-stack-vite-mock.log`, `taiko-stack-vite-devapi.log`. 클라이언트 진단(`report()`)은 API 로그에 `CLIENT ` 줄로 남는다.

단, 서버가 stack.sh 밖에서(손으로, 다른 세션에서) 떠 있으면 로그는 그 실행이 정한 곳에 있다. 추측하지 말고 찾는다: `lsof -p $(lsof -tiTCP:5180 -sTCP:LISTEN) | grep -E '\.log$'` (API), 5173/5175도 같은 방식.
