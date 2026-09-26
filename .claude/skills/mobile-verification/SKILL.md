---
name: mobile-verification
description: "태고 멀티뷰의 화면 변경을 iPhone·안드로이드·데스크톱 에뮬레이션으로 검증하는 절차. 스크린샷, 요소 위치 측정, Playwright e2e, 서버 응답과 프론트 타입 교차 확인까지. 모바일 UI, 채팅창, 타일, 레이아웃, 겹침, 잘림, 스크롤, 가로모드, 사파리/크롬 차이를 확인하거나 'UI 확인해줘', '폰에서 어떻게 보이는지', '다시 검증' 요청 시 반드시 이 스킬을 사용."
---

# 모바일 화면 검증

주장("겹치지 않는다", "잘리지 않는다")은 눈대중이 아니라 **측정한 숫자와 스크린샷**으로 확인한다. 오늘의 버그 대부분이 에뮬레이터 캡처 한 장에서 바로 보였고, 몇몇은 박스 좌표를 비교해야만 보였다.

## 1. 스택 준비

multiview-local-env 스킬로 스택을 띄운다. 화면 확인은 보통 `devapi`(실제 매장), 플레이어 동작 확인은 `mock`.

## 2. 기기별 캡처와 박스 측정

```bash
node .claude/skills/mobile-verification/scripts/shoot.mjs --url http://localhost:5175 --out _workspace/shots
node .claude/skills/mobile-verification/scripts/shoot.mjs --url http://localhost:5175 --out _workspace/shots-chat --chat
```

기본 기기: `iPhone 15 Pro`, `iPhone 15 Pro landscape`, `iPhone SE`, `Pixel 7`, `desktop`. 애플 기기는 WebKit, 나머지는 Chromium으로 연다. `boxes.json`에 가로 넘침, 첫 타일의 영상과 버튼 줄, 채팅 관련 박스가 남는다.

**스크린샷은 반드시 Read로 직접 본다.** 숫자가 맞아도 모양이 틀릴 수 있다.

기본 판정 기준(변경 내용에 맞게 추가한다):
- `sidewaysOverflow`가 0 이하
- 폰에서 `tileControls.y >= tilePicture.y + tilePicture.h` (버튼 줄이 영상 아래, 유튜브 컨트롤과 겹치지 않음)
- 채팅: `pinnedPicture.y == 0`, `chatSheet.y == pinnedPicture.y + pinnedPicture.h`, `chatFrame.y + chatFrame.h <= chatHint.y`
- 가로 폰: 폰 레이아웃이 적용됨(배치 선택기 숨김). 실제 iPhone 가로는 폭 844~932px라 820px 기준만으로는 빠진다.

## 3. e2e

```bash
cd frontend && DOTNET=/usr/local/share/dotnet/dotnet DOTNET_ROOT=/usr/local/share/dotnet npx playwright test
```

Chromium, WebKit, iPhone 세 프로젝트다. 폰 동작은 `e2e/multiview.spec.ts`의 `phone` 그룹에 있다. 새 동작을 만들면 여기에 테스트를 더한다. e2e는 오프라인 Mock이라 플레이어는 뜨지 않는다.

**새 테스트는 통과만 보고 믿지 않는다.** 고친 코드를 잠깐 되돌려 테스트가 실제로 실패하는지 확인하고(뮤테이션 체크), 반드시 원래대로 되돌린 뒤 `git diff`로 되돌린 것을 확인한다. 되돌리기 전에 중단되면 파일이 망가진 채 남는다.

## 4. 경계면 교차 확인

UI만 보지 말고 연결 지점을 맞춰 본다:
- API 응답(`/api/live`, `/api/venues`)의 실제 JSON과 `frontend/src/lib/types.ts`의 타입. curl로 받은 필드와 타입 필드를 1:1로 대조한다.
- 백엔드가 새 필드를 보내면 프론트가 읽는지, 프론트가 기대하는 필드를 백엔드가 보내는지.

## 에뮬레이터가 못 잡는 것 (보고서에 명시)

- **iOS 메모리 한도.** 탭 크래시("문제가 지속적으로 발생했습니다")는 재현되지 않는다. 플레이어를 만들고 부수는 횟수로 간접 판단하고(perf-check), 확정은 실제 기기의 Safari 웹 인스펙터로 한다.
- **Safari의 iframe 클리핑.** iOS Safari는 고정 위치 영역 안 iframe의 `overflow: hidden`을 무시할 수 있다. 자르려면 `clip-path: inset(0)`을 쓴다. 에뮬레이터에서는 멀쩡히 잘려 보인다.
- **iPhone Chrome 툴바, 주소창 높이 변화.** 실제 기기에서만 보인다.
- **로그인.** 다른 사이트에 넣은 유튜브 채팅에는 브라우저가 로그인을 넘기지 않는다(iPhone 전부, 크롬 시크릿). 채팅 입력은 유튜브 창에서 한다.

실제 기기 확인이 필요하면 사용자에게 `http://<LAN IP>:<포트>/`와 무엇을 볼지 구체적으로 적어 요청한다.

## 요령

- 합성 포인터 이벤트로 드래그를 흉내 낼 때: `setPointerCapture`는 가짜 포인터에서 예외를 던지고, React state는 같은 틱의 연속 이벤트에서 아직 갱신 전이다. 코드가 ref로 드래그 상태를 들고 try/catch로 캡처하는지 본다.
- 유튜브 채팅 iframe 안 요소는 `page.frames()`에서 `live_chat` 프레임을 찾아 evaluate로 잰다.
