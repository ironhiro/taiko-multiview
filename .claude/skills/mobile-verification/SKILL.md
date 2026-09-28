---
name: mobile-verification
description: "태고 멀티뷰의 화면 변경을 iPhone·안드로이드·데스크톱 에뮬레이션으로 검증하는 절차. 스크린샷, 요소 위치 측정, Playwright e2e, 서버 응답과 프론트 타입 교차 확인까지. 모바일 UI, 상단 바, 타일, 레이아웃, 겹침, 잘림, 스크롤, 가로모드, 사파리/크롬 차이를 확인하거나 'UI 확인해줘', '폰에서 어떻게 보이는지', '다시 검증' 요청 시 반드시 이 스킬을 사용."
---

# 모바일 화면 검증

주장("겹치지 않는다", "잘리지 않는다")은 눈대중이 아니라 **측정한 숫자와 스크린샷**으로 확인한다. 오늘의 버그 대부분이 에뮬레이터 캡처 한 장에서 바로 보였고, 몇몇은 박스 좌표를 비교해야만 보였다.

## 1. 스택 준비

multiview-local-env 스킬로 스택을 띄운다. 화면 확인은 보통 `devapi`(실제 매장), 플레이어 동작 확인은 `mock`.

## 2. 기기별 캡처와 박스 측정

```bash
node .claude/skills/mobile-verification/scripts/shoot.mjs --url http://localhost:5175 --out _workspace/shots
```

기본 기기: `iPhone 15 Pro`, `iPhone 15 Pro landscape`, `iPhone SE`, `Pixel 7`, `desktop`. 애플 기기는 WebKit, 나머지는 Chromium으로 연다. `boxes.json`에 가로 넘침, 첫 타일의 영상과 버튼 줄, 떠 있는 플레이어 수가 남는다.

**스크린샷은 반드시 Read로 직접 본다.** 숫자가 맞아도 모양이 틀릴 수 있다.

기본 판정 기준(변경 내용에 맞게 추가한다):
- `sidewaysOverflow`가 0 이하
- 폰에서 `tileControls.y >= tilePicture.y + tilePicture.h` (버튼 줄이 영상 아래, 유튜브 컨트롤과 겹치지 않음)
- 가로 폰: 폰 레이아웃이 적용됨(배치 선택기 숨김). 실제 iPhone 가로는 폭 844~932px라 820px 기준만으로는 빠진다.

## 3. 재생 실패 타일 검증 (`?breakEmbed=`)

임베드 차단 방송(오류 101/150)이 섞인 벽은 **에뮬레이션으로는 재현되지 않는다** — mock 방송은 전부 임베드 가능하고, e2e는 오프라인이라 플레이어가 아예 안 뜬다. 그래서 개발 서버 전용 드릴이 있다(`frontend/src/lib/embedFailureDrill.ts`, `import.meta.env.DEV` 게이트라 프로덕션 번들에는 들어가지 않는다).

```
http://localhost:5173/?venue=mock-1&view=all-grid&breakEmbed=A1,A2
```

지정한 타일(라벨 쉼표 구분, 또는 `all`)이 플레이어를 만든 2.5초 뒤 유튜브가 돌려줄 오류를 **같은 핸들러로 보고**한다. 실제 `onError`를 유발하는 것이 아니라 보고만 하므로, 유튜브의 `onError` 배선 자체는 이 드릴로 검증되지 않는다(실기기 항목).

**오판 주의 — 정지 화면의 "재생 0개"는 정상일 수 있다.** 재생 슬롯은 절반 이상(`AUTOPLAY_MIN_RATIO 0.5`) 보이는 타일에만 가고, 실패한 타일은 슬롯에서 빠진다. 맨 위 두 타일을 깨고 화면을 정지해 두면 자격 있는 타일이 없어 0개가 맞다. **스크롤하거나 타일을 탭해 "슬롯을 받을 수 있는 타일이 화면에 있는" 상태에서 센다.** 판정은 앱과 같은 root(`rootMargin: -coveredTop`)로 타일별 `intersectionRatio`를 직접 재서, "ratio ≥ 0.5인데 플레이어가 없는 타일"이 있는지로 한다.

타이머 누수를 볼 때는 `setInterval`을 래핑해 5초 주기만 센다(제품 코드에 계측을 넣지 않는다). 기준은 **감시 타이머 수 == iframe 수**이고, 전부 깨면 둘 다 0이어야 한다.

### 재생이 "되고 있는지" 확인하는 법

iframe이 떠 있는 것과 재생되는 것은 다르다. `iframe` 개수나 스크린샷만으로 판정하지 말고 세 층을 순서대로 본다.

1. **엔진이 무엇을 재생할 수 있다고 주장하는지** — `video.canPlayType('video/mp4; codecs="avc1.42E01E"')`. 단 이건 주장일 뿐이고, MSE 없이도 `probably`가 나온다. 판정 근거로 쓰지 말고 참고만 한다.
2. **유튜브가 쓰는 경로가 있는지** — `typeof window.MediaSource`, `MediaSource.isTypeSupported(...)`. 유튜브 임베드는 MSE로 스트림을 붙인다. 없으면 어떤 코덱을 지원하든 재생되지 않는다.
3. **실제로 시간이 흐르는지** — `page.frames()`에서 `youtube.com/embed/` 프레임을 찾아 그 안의 `<video>`를 잰다:

```js
for (const frame of page.frames()) {
  if (!/youtube\.com\/embed/.test(frame.url())) continue;
  console.log(await frame.evaluate(() => {
    const v = document.querySelector('video');
    return v && { currentTime: v.currentTime, readyState: v.readyState, paused: v.paused,
                  networkState: v.networkState, error: v.error?.code ?? null };
  }));
}
```

`currentTime > 0.5`가 재생의 증거다. 안 될 때는 `readyState`·`networkState`·`error`로 원인이 갈린다: `error.code 4`(SRC_NOT_SUPPORTED)면 코덱, `error`가 `null`인데 `networkState 0`·`src` 없음이면 **소스가 붙은 적이 없다**(MSE 부재나 플레이어가 시작 못 함), `readyState ≥ 2`인데 `paused`면 자동재생 정책이다. 콘솔도 함께 받아 둔다 — 이 PC의 WebKit은 `Unable to post message to https://www.youtube.com`도 같이 찍는다.

## 4. e2e

```bash
cd frontend && npx playwright test
```

macOS에서는 PATH의 `dotnet`이 .NET 8이라 `DOTNET=/usr/local/share/dotnet/dotnet DOTNET_ROOT=/usr/local/share/dotnet`을 앞에 붙인다. Windows는 PATH의 dotnet이 10이라 그대로 된다.

⚠ **mock 스택이 떠 있으면 e2e가 빌드 단계에서 죽는다** — 5180 API가 `bin`을 잠가 Playwright의 5190 서버가 빌드되지 않는다. 스택을 멈추지 말고 5190을 다른 출력 경로로 먼저 띄워 `reuseExistingServer`가 재사용하게 한다(multiview-local-env의 "실행 중인 API가 빌드를 막는다" 절에 명령이 있다).

Chromium, WebKit, iPhone 세 프로젝트다. 폰 동작은 `e2e/multiview.spec.ts`의 `phone` 그룹에 있다. 새 동작을 만들면 여기에 테스트를 더한다. e2e는 오프라인 Mock이라 플레이어는 뜨지 않는다 — **재생·실패 타일 경로는 e2e로 고정되지 않으므로**, 그 동작의 회귀 방지는 `lib/`의 순수 함수 단위 테스트(`tilePlayer.test.ts`)와 위 드릴 측정이 맡는다.

**새 테스트는 통과만 보고 믿지 않는다.** 고친 코드를 잠깐 되돌려 테스트가 실제로 실패하는지 확인하고(뮤테이션 체크), 반드시 원래대로 되돌린 뒤 `git diff`로 되돌린 것을 확인한다. 되돌리기 전에 중단되면 파일이 망가진 채 남는다.

## 5. 경계면 교차 확인

UI만 보지 말고 연결 지점을 맞춰 본다:
- API 응답(`/api/live`, `/api/venues`)의 실제 JSON과 `frontend/src/lib/types.ts`의 타입. curl로 받은 필드와 타입 필드를 1:1로 대조한다.
- 백엔드가 새 필드를 보내면 프론트가 읽는지, 프론트가 기대하는 필드를 백엔드가 보내는지.

## 에뮬레이터가 못 잡는 것 (보고서에 명시)

- **iOS 메모리 한도.** 탭 크래시("문제가 지속적으로 발생했습니다")는 재현되지 않는다. 플레이어를 만들고 부수는 횟수로 간접 판단하고(perf-check), 확정은 실제 기기의 Safari 웹 인스펙터로 한다.
- **Safari의 iframe 클리핑.** iOS Safari는 고정 위치 영역 안 iframe의 `overflow: hidden`을 무시할 수 있다. 자르려면 `clip-path: inset(0)`을 쓴다. 에뮬레이터에서는 멀쩡히 잘려 보인다.
- **헤드리스 WebKit에서는 재생 자체가 안 된다 — `MediaSource`가 없어서다.** 측정값: `window.MediaSource`가 `undefined`, 그래서 유튜브가 스트림을 붙일 곳이 없어 `video.src`는 `(none)`, `networkState 0`, `readyState 0`이고 **`video.error`는 `null`**(오류가 아니라 아무것도 시작되지 않은 상태). `canPlayType('video/mp4; codecs="avc1.42E01E"')`는 `probably`라고 답하니 **코덱 지원 여부로 오진하지 말 것** — canPlayType은 주장이고 MSE 부재가 실제 원인이다. 그러니 **재생 개수 판정은 Chromium으로만** 하고, WebKit은 레이아웃·클리핑 확인에 쓴다. 실제 iPhone 사파리는 임베드 재생 경로가 이것과 달라서 이 공백이 실기기 동작을 말해 주지 않는다 — 재생은 실기기로만 확정한다.
- **iPhone Chrome 툴바, 주소창 높이 변화.** 실제 기기에서만 보인다.
- **로그인.** 다른 사이트에 넣은 유튜브 프레임에는 브라우저가 로그인을 넘기지 않는다(iPhone 전부, 크롬 시크릿).

실제 기기 확인이 필요하면 사용자에게 `http://<LAN IP>:<포트>/`와 무엇을 볼지 구체적으로 적어 요청한다.

## 요령

- 합성 포인터 이벤트로 드래그를 흉내 낼 때: `setPointerCapture`는 가짜 포인터에서 예외를 던지고, React state는 같은 틱의 연속 이벤트에서 아직 갱신 전이다. 코드가 ref로 드래그 상태를 들고 try/catch로 캡처하는지 본다.
- 유튜브 플레이어 iframe 안 요소는 `page.frames()`에서 `youtube.com/embed/` 프레임을 찾아 evaluate로 잰다.
