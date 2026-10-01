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

`stack.sh status`로 상태와 로그 경로를 보고, `stack.sh stop`으로 멈춘다. 이미 떠 있으면 다시 띄우지 않는다. 사용자가 폰으로 보고 있을 수 있으니 **작업이 끝나도 멋대로 멈추지 않는다.**

스크립트는 macOS와 Windows Git Bash 양쪽에서 돈다 — .NET 10 경로, LAN 주소, 포트 종료를 플랫폼별로 각각 해결한다. 두 스택 모두 Vite는 `--host`로 떠서 같은 와이파이의 폰이 `http://<LAN IP>:<포트>/`로 접속할 수 있고, 그 주소는 `stack.sh mock`·`devapi`가 마지막 줄에 찍는다.

## 플랫폼별로 다른 것

`stack.sh`가 알아서 처리하지만, 손으로 명령을 돌릴 때는 직접 맞춰야 한다.

| | macOS | Windows (Git Bash) |
|---|---|---|
| .NET 10 | PATH의 `dotnet`은 Homebrew .NET 8. `/usr/local/share/dotnet/dotnet`이 10 | PATH의 `dotnet`이 이미 10 (`dotnet --list-sdks`로 확인) |
| LAN IP | `ipconfig getifaddr en0` | `powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 \| Where-Object { \$_.IPAddress -ne '127.0.0.1' }).IPAddress"` |
| 포트 종료 | `lsof -tiTCP:5180 -sTCP:LISTEN \| xargs kill` | `netstat -ano`에서 LISTENING 줄의 PID → `taskkill //PID <pid> //F` |
| 쓸 수 없는 것 | — | `pkill`, `lsof`, `ps -o` (Git Bash에 없거나 옵션 미지원) |

`stack.sh` 밖에서 손으로 띄울 때 .NET 10을 명시하려면 `DOTNET=<경로>`를 환경 변수로 준다 — 스크립트도 그 값을 가장 먼저 본다.

## 실행 중인 API가 빌드를 막는다 (자주 걸린다)

mock 스택의 API가 `backend/TaikoLabs.Api/bin`을 잠그고 있어서, 스택이 떠 있는 동안에는 **같은 출력 경로를 쓰는 빌드가 실패한다**:

- `dotnet test backend/TaikoLabs.Api.Tests`
- Playwright가 자기 `webServer`로 띄우는 5190 API(`frontend/playwright.config.ts`) → e2e 전체가 빌드 단계에서 죽는다

스택을 멈추지 말고 출력 경로를 옮겨서 돌린다:

```bash
# 테스트
dotnet test backend/TaikoLabs.Api.Tests -p:BaseOutputPath=/tmp/taiko-test-bin/

# e2e: 5190을 먼저 직접 띄우면 playwright가 reuseExistingServer로 재사용한다.
# 환경 변수는 playwright.config.ts의 webServer와 똑같이 맞춘다.
(cd backend/TaikoLabs.Api && ASPNETCORE_ENVIRONMENT=Development YouTube__Mode=Mock YouTube__ApiKey= \
   Venues__ClosureCachePath=/tmp/taiko-e2e-closures.json Venues__LiveCachePath=/tmp/taiko-e2e-live.json \
   nohup dotnet run --no-launch-profile \
   --urls http://localhost:5190 -p:BaseOutputPath=/tmp/taiko-e2e-bin/ >/tmp/taiko-5190.log 2>&1 &)
cd frontend && npx playwright test
```

e2e가 끝나면 5190만 종료한다(5180·5173은 살려 둔다).

**`ASPNETCORE_ENVIRONMENT=Mock`으로 띄우지 않는다.** Mock 환경은 `venues.mock.json`(mock-1~6)을 읽는데 e2e는 실제 `venues.json`의 taikolabs를 전제로 한다. 그렇게 띄우면 코드와 무관하게 e2e 10개가 실패한다(24 passed / 10 failed). 결과가 이상하면 먼저 `curl localhost:5190/api/venues`로 taikolabs가 오는지 본다.

## 이 저장소에서 걸리는 것들

- **Mock 매장.** `ASPNETCORE_ENVIRONMENT=Mock`은 `appsettings.Mock.json`을 읽는다. 매장은 `venues.mock.json`(git 제외), 방송은 `YouTube:MockVideoIds`의 실제 24시간 라이브다. 매장 수를 바꾸려면 `node scripts/mock-venues.mjs --venues N --stations M`. API가 파일 변경을 감지해 다시 읽는다.
- **Mock은 `Venues:File`을 바꾼다.** 그래서 mock 스택이 떠 있는 동안 데스크톱 셸의 매장 등록기를 열면 **실제 `venues.json`을 열어 보여 주고 저장한다**(등록기가 경로를 하드코딩한다 — 리뷰 ARCH-5). 부하 테스트 중에는 등록기를 쓰지 않는다.
- **개발 환경은 폴링 간격이 다르다.** `appsettings.Development.json`이 `PollIntervalSeconds: 120`으로 덮어써서, 시작 로그의 예상 쿼터가 `Mock`·운영(60초)과 다르게 찍힌다(4,407 units / 44.1% vs 8,474 / 84.7%). 쿼터 수치를 볼 때는 어느 환경으로 띄웠는지 먼저 확인한다.
- **e2e용 Mock은 또 다르다.** Playwright e2e는 5190/5174에 자체 서버를 띄운다. `MockVideoIds` 없이 가짜 id, 임베드 불가, 네트워크 없음(`e2e/support.ts`의 `offline()`). 그래서 **e2e는 플레이어 재생을 검증하지 못한다** — 재생·실패 타일 동작은 perf-check나 mobile-verification이 맡는다.
- **헤드리스 브라우저와 유튜브.** 유튜브는 `HeadlessChrome` UA에 "오래된 브라우저" 페이지를 준다. Playwright 컨텍스트의 userAgent에서 `HeadlessChrome`을 `Chrome`으로 바꾼다. 유튜브 플레이어는 뜨는 데 몇 초 걸리니 충분히 기다린다.
- **헤드리스 WebKit에는 `MediaSource`가 없다**(이 PC에서 확인: `window.MediaSource`가 `undefined`). 유튜브 임베드는 MSE로 스트림을 붙이므로, iframe은 뜨지만 소스가 붙은 적이 없어 한 프레임도 재생되지 않고 화면은 `NOW LOADING`에 머문다(`video.error`는 `null`, `networkState 0`). `canPlayType`이 H.264를 `probably`라고 답하는 것에 속지 말 것 — 코덱 문제가 아니다. **재생 개수를 세는 판정은 Chromium으로만 한다.** WebKit은 레이아웃·클리핑 확인용이다. 확인 절차는 mobile-verification의 "재생이 '되고 있는지' 확인하는 법".
- **실제 방송 id.** 임베드 가능 여부는 바뀐다. 확인된 것은 `4xDzrJKXOOY`, `S_MOd40zlYU`(둘 다 lofi girl 계열 24시간 라이브). `jfKfPfyJRdk` 등은 localhost에서 오류 150(임베드 거부)이었다. 임베드 실패를 **일부러** 만들려면 재생 불가 id를 물리지 말고 `?breakEmbed=`를 쓴다(mobile-verification 참고) — 유튜브가 같은 id에 오류 대신 API가 못 읽는 페이지를 주는 날이 있어 재현이 흔들린다.
- **공개 레지스트리 push**(ghcr.io)는 이 세션의 권한 검사에 막힌다. 배포 절차는 deploy-dev 스킬을 본다.

## 로그

`$TMPDIR/taiko-stack-api.log`, `taiko-stack-vite-mock.log`, `taiko-stack-vite-devapi.log`. Git Bash는 보통 `TMPDIR`이 비어 있어 `/tmp` 아래에 남는다. 정확한 경로는 `stack.sh status`가 마지막 줄에 찍는다. 클라이언트 진단(`report()`)은 API 로그에 `CLIENT ` 줄로 남는다.

단, 서버가 `stack.sh` 밖에서(손으로, 다른 세션에서) 떠 있으면 로그는 그 실행이 정한 곳에 있다. 추측하지 말고 찾는다:

- macOS: `lsof -p $(lsof -tiTCP:5180 -sTCP:LISTEN) | grep -E '\.log$'`
- Windows: `lsof`가 없다. 띄운 세션의 스크래치패드(`api.log`·`vite.log`)를 먼저 보고, 없으면 그 세션에 물어본다. 포트 보유 PID는 `netstat -ano | grep LISTENING | grep :5180`으로 확인한다.
