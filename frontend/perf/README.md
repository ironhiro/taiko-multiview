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
```

| 시나리오 | 내용 |
| --- | --- |
| `desktop-3x3`, `desktop-4x4` | 1920×1080 크롬, 배치 3×3 / 4×4 |
| `phone-scroll` | iPhone 15 Pro 에뮬레이션, 벽을 위아래로 계속 스크롤 |
| `phone-chat-scroll` | 같은 조건에 채팅을 연 채로 |
| `… (webkit)` | 위 두 폰 시나리오를 WebKit 으로 |

| 지표 | 의미 |
| --- | --- |
| players (peak) | 동시에 떠 있던 플레이어 수 |
| players built | 측정 중 새로 만든 플레이어 수. 스크롤마다 만들고 부수면 커짐 |
| CPU (cores) | 브라우저의 모든 프로세스(유튜브 iframe 포함)가 쓴 평균 코어 수 |
| RSS peak (MB) | 브라우저 전체 프로세스의 최대 메모리 |
| JS heap (MB) | 멀티뷰 페이지 자체의 JS 메모리 |
| fps, worst frame | 측정 중 화면 갱신율과 가장 긴 프레임 간격 |
| long tasks | 50ms 넘게 메인 스레드를 막은 작업 수(합계 시간) |
| download (MB) | 받은 데이터 총량(영상 포함) |

결과는 표로 출력되고 `frontend/perf/results/*.json` 에 저장됩니다(git 제외).

CPU·메모리는 크롬에서만 잽니다. 에뮬레이터는 실제 아이폰의 메모리 한도를 재현하지 못하므로, 아이폰에서 탭이 죽는지는 기기에서 Safari 웹 인스펙터(타임라인 → 메모리)로 확인합니다.
