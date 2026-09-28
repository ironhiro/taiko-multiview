# 성능 측정 (로컬)

가짜 매장 여러 개를 띄우고, 실제로 재생되는 유튜브 플레이어로 멀티뷰의 부하를 잽니다.

## 1. 가짜 매장 만들기

```bash
node scripts/mock-venues.mjs --venues 6 --stations 9   # 매장 6개 × 기체 9대
```

`backend/TaikoLabs.Api/venues.mock.json` 이 생깁니다(git 제외). 실제 `venues.json` 은 건드리지 않습니다.

## 2. Mock 서버 실행

```bash
cd backend/TaikoLabs.Api
ASPNETCORE_ENVIRONMENT=Mock dotnet run --no-launch-profile --urls http://localhost:5180
```

`appsettings.Mock.json` 이 적용됩니다:

- `Venues:File`: `venues.mock.json` 사용
- `YouTube:MockVideoIds`: 24시간 라이브 방송 id. 모든 기체가 이 방송을 임베드 가능한 상태로 송출합니다. 비우면 예전처럼 가짜 id, 임베드 불가, 플레이어 없음.

프론트엔드는 평소처럼 `cd frontend && npm run dev` 로 실행합니다(5173, `/api` 를 5180으로 프록시).

## 3. 측정

```bash
cd frontend
npm run perf                                  # 전체 시나리오, 시나리오당 20초
npm run perf -- --venue mock-2 --seconds 30   # 매장·시간 지정
npm run perf -- --only desktop-3x3,phone-scroll
npm run perf -- --only phone-scroll-aggressive --seconds 50
```

| 시나리오 | 내용 |
| --- | --- |
| `desktop-3x3`, `desktop-4x4` | 1920×1080 크롬, 배치 3×3 / 4×4 |
| `phone-scroll` | iPhone 15 Pro 에뮬레이션, 벽을 위아래로 계속 스크롤 |
| `phone-scroll-aggressive` | 같은 폰에서 맨 아래↔맨 위 점프, 700px 빠른 플릭 4번(아래·위), 중간 점프를 반복. 동작마다 표본을 떠서 시간순 기록(`timeline`: 시각, scrollY, 플레이어·재생 수, 누적 생성 수, RSS)을 결과 JSON에 남김. 플레이어를 계속 새로 만드는 패턴을 재는 용도. `--seconds 50` 권장 |
| `phone-scroll (webkit)` | `phone-scroll` 을 WebKit 으로 |

| 지표 | 의미 |
| --- | --- |
| players (peak) | 동시에 떠 있던 플레이어 수 |
| playing (peak) | 실제로 재생 중인(유튜브 임베드 프레임의 `video.paused`가 false) 플레이어 수의 최대값. 샘플마다(1.5초) 셈 |
| players built | 측정 중 새로 만든 플레이어 수. 스크롤마다 만들고 부수면 커짐 |
| CPU (cores) | 브라우저의 모든 프로세스(유튜브 iframe 포함)가 쓴 평균 코어 수 |
| RSS peak (MB) | 브라우저 전체 프로세스의 최대 메모리 |
| JS heap (MB) | 멀티뷰 페이지 자체의 JS 메모리 |
| heap after GC (MB) | 측정 끝에 GC를 강제로 돌린 뒤의 JS heap. 여기까지 남으면 쓰레기가 아니라 붙잡힌 메모리 |
| fps, worst frame | 측정 중 화면 갱신율과 가장 긴 프레임 간격 |
| long tasks | 50ms 넘게 메인 스레드를 막은 작업 수(합계 시간) |
| watchdogs (end/peak) | 측정이 끝난 시점과 최대치의 5초 감시 타이머 수(`PlayerTile.tsx`). 플레이어 하나당 하나여야 하고, 플레이어가 사라졌는데 남아 있으면 정리가 안 된 것 |
| download (MB) | 받은 데이터 총량(영상 포함) |

결과는 표로 출력되고 `frontend/perf/results/*.json` 에 저장됩니다(git 제외).

CPU·메모리는 크롬에서만 잽니다. 에뮬레이터는 실제 아이폰의 메모리 한도를 재현하지 못하므로, 아이폰에서 탭이 죽는지는 기기에서 Safari 웹 인스펙터(타임라인 → 메모리)로 확인합니다.

## 4. 임베드 실패 강제 (`--break-embed`)

임베드가 막힌 방송(오류 101/150)은 mock 으로 만들 수 없어서, 주소에 타일을 지정해 같은 실패 경로를 타게 합니다. 지정한 타일은 플레이어를 정상적으로 만든 뒤 **2.5초 후** 유튜브가 그 방송에 돌려줄 오류(150)를 같은 핸들러로 보고합니다 — 타일이 "재생 실패"로 바뀌고, 슬롯·예산·5초 감시 타이머를 놓아야 합니다.

재생 불가한 영상 id 를 물려서 실제 `onError` 를 받는 방법도 시도했지만, 유튜브가 그 id 에 오류 대신 API 가 읽지 못하는 페이지를 돌려주는 경우가 있어(플레이어가 실패하지 않고 그냥 멈춤) 재현이 불안정했습니다. 그래서 오류를 **유발**하지 않고 **보고**합니다. 유튜브의 `onError` 배선 자체는 이 방법으로 검증되지 않습니다.

```bash
npm run perf -- --only phone-scroll-aggressive --seconds 50 --break-embed A1,A2
```

브라우저에서 직접 볼 때는 주소에 붙입니다(개발 서버에서만 동작합니다. 빌드된 번들은 이 파라미터를 읽지 않습니다):

```
http://localhost:5173/?venue=mock-1&view=all-grid&breakEmbed=A1,A2
http://localhost:5173/?venue=mock-1&view=all-grid&breakEmbed=all
```

- 타일 이름은 벽에 적힌 그대로(`A1`, `THE BASE`). 대소문자·공백·기호는 무시합니다.
- 실패한 타일이 슬롯을 놓으면 **화면의 절반 이상 보이는** 다음 타일이 대신 재생합니다. 맨 위 두 타일을 모두 깨고 화면을 그대로 두면 재생이 0개인 것이 정상입니다(그만큼 보이는 타일이 없음) — 조금 스크롤하거나 썸네일을 탭하면 2개가 됩니다.
- `breakEmbed=all` 로 벽 전체를 깨고 한 바퀴 스크롤하면, 끝에 iframe 0개 · `watchdogs` 0개여야 합니다. 남아 있으면 실패 타일이 타이머를 놓지 않는 것입니다.
- 한 번 실패한 타일은 방송 id 가 바뀔 때까지 실패로 남습니다(실제 임베드 차단 방송과 같음).
