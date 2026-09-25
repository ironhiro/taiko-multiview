# 태고 멀티뷰

태고 매장들의 유튜브 라이브 스트리밍을 한 화면에서 보는 멀티뷰.
**매장 추가는 설정 변경만으로 끝난다** — 코드를 고칠 일이 없다.

배치도를 공개하는 매장(TAIKO LABS)은 실제 기체 배치 좌표로 그리고,
배치도가 없는 매장은 균등 그리드로만 보여준다.

```
ASP.NET Core API  ──▶  Vercel (React + TS)  ──▶  브라우저
       │                                     └▶  Tauri 셸 (macOS · Windows)
       └─ YouTube RSS + Data API v3
```

| 구성 | 위치 | 설명 |
| --- | --- | --- |
| 백엔드 | `backend/TaikoLabs.Api` | 라이브 상태 폴링, 메모리 캐시, JSON API |
| 프론트엔드 | `frontend` | React 18 + TypeScript + Vite |
| 데스크톱 | `desktop/shell` | Tauri 셸. macOS·Windows 공용 |
| **매장 등록기** | `tools/TaikoLabs.VenueEditor` | 매장을 폼으로 추가·편집하는 독립 실행 프로그램 |

---

## 바로 실행해보기

API 키 없이도 동작한다. 키가 없으면 채널 RSS 피드를 읽어 **데모 데이터**(최근 방송 다시보기)를 띄우므로
멀티뷰 레이아웃과 플레이어를 그대로 확인할 수 있다.

```powershell
# 터미널 1 - 백엔드
cd backend/TaikoLabs.Api
dotnet run

# 터미널 2 - 프론트엔드
cd frontend
npm install
npm run dev        # http://localhost:5173

# 터미널 3 - 데스크톱 셸 (선택)
cd desktop/shell
npm install
npm run dev

# 매장 등록기 (필요할 때만)
cd tools/TaikoLabs.VenueEditor
dotnet run
```

`scripts/dev.ps1` 을 실행하면 위 셋을 한 번에 띄운다.

---

## 동작 방식

### 매장 목록 — `venues.json`

매장 목록은 앱 설정(`appsettings.json`)과 따로 **`backend/TaikoLabs.Api/venues.json`** 에 둔다.
매장은 늘고 바뀌는 데이터이고, 앱 설정은 앱이 어떻게 도는지이기 때문이다. 시간대·휴무 조회 시각 같은
운영 값은 계속 `appsettings.json` 의 `Venues` 에 있고, 두 파일이 하나의 `Venues` 설정으로 합쳐진다.

매장을 바꾸는 흐름은 이렇다.

1. 매장 등록기(데스크톱 앱 메뉴 → **매장 등록기**, `Cmd/Ctrl+Shift+E`)로 고쳐 저장한다.
   **로컬 백엔드와 멀티뷰에는 재시작 없이 곧바로 반영된다.**
2. `venues.json` 변경을 커밋하고 `main` 에 올린다. 변경 이력이 git 에 남고, 되돌리기도 git 으로 한다.
3. GitHub Actions 가 테스트를 돌리고, 자동 배포를 켜 두었다면 백엔드를 Azure 에 배포한다
   (`.github/workflows/ci.yml` 의 `deploy-backend` — 켜는 법은 파일 안 주석에 있다).

### 매장 추가하기 — 등록기 사용 (권장)

데스크톱 앱의 메뉴에서 연다. `venues.json` 을 자동으로 찾아 연다.

등록기는 **로컬에서만** 나온다: 개발 서버(`localhost`)나, 로컬 API를 쓰는 번들 빌드일 때.
배포된 사이트(`remoteUrl`)를 띄운 앱에는 메뉴 항목이 없고, 웹에서 `?screen=editor` 를 붙여도 멀티뷰가 뜬다.
등록기가 고치는 건 이 컴퓨터의 `venues.json` 이라, 실서버에 반영하려면 커밋해서 배포해야 한다.

손으로 JSON을 쓰는 것보다 안전한 이유는
**틀리기 쉬운 두 가지를 실제 데이터로 검증해 주기 때문**이다.

- **채널 조회** — `@핸들` 이나 채널 URL만 붙여넣으면 `channelId` 와 매장 이름을 채운다.
- **제목 규칙 검증** — [채널에서 제목 가져오기] 를 누르면 최근 방송 제목 15건을 불러와,
  각 제목에서 뽑은 기체명과 **그것이 어느 기체로 매칭되는지**를 표로 보여준다.
  `⚠ 매칭되는 기체 없음` 이 뜨면 alias를 보태면 된다.
- **패턴 만들기** — 제목에서 기체명 부분만 드래그로 선택하고 버튼을 누르면 정규식을 만들어 준다.
  날짜·회차 숫자는 자동으로 일반화된다.
- **검증 탭** — API가 시작할 때 하는 검사와 같은 규칙을 미리 돌린다.
  API가 매장을 통째로 건너뛰게 만드는 문제는 **저장 자체를 막는다.**

편집기가 모르는 설정(로깅·CORS·API 키)과 기존 매장의 배치도 좌표는 **저장해도 그대로 보존된다.**
배치도 좌표 자체는 편집하지 않는다 — 손으로 입력할 만한 값이 아니고, 새로 추가하는 매장은
대개 배치도가 없기 때문이다.

저장하면 실행 중인 백엔드와 멀티뷰에 곧바로 반영된다. 예전 Avalonia 등록기
(`tools/TaikoLabs.VenueEditor`)도 같은 파일을 연다.

### 매장 추가하기 — 직접 편집

`venues.json` 의 `Venues.Items` 에 항목을 하나 더 넣어도 된다. 배치도 좌표까지
설정에 있으므로 프론트엔드는 건드리지 않는다.

```json
{
  "id": "example",
  "name": "○○ 게임장",
  "accent": "#5B8DEF",
  "logo": "logos/example.svg",
  "channelId": "UC...",
  "channelUrl": "https://www.youtube.com/@example",
  "titlePattern": "^\[(?<name>\d+번)\]",
  "stations": [
    { "id": "1", "label": "1번대", "aliases": ["1번"] },
    { "id": "2", "label": "2번대" }
  ],
  "layout": null,
  "hours": { "Monday": "12:00-23:00", "...": "..." }
}
```

| 필드 | 설명 |
| --- | --- |
| `accent` | 매장 강조색. 선택한 보기·소리 켜진 타일 등 화면의 강조가 이 색을 따른다 |
| `logo` | 선택. `frontend/public/logos/` 아래 파일 경로나 절대 URL. **비우면 YouTube 채널 프로필 이미지**(API 키 필요)를 쓴다 |
| `titlePattern` | 방송 제목 정규식. **`(?<name>...)` 그룹 필수**, `date`·`part`는 선택 |
| `stations` | 기체 목록. `aliases` 로 제목에 쓰이는 다른 표기를 흡수 |
| `zones` | 구역. 2개 이상일 때만 보기 목록에 구역별 항목이 생김 |
| `layout` | 배치도 좌표. **`null` 이면 그리드 전용 매장** |
| `naverPlaceId` | 임시휴무 자동 감지용. 없으면 `closedDates` 만 사용 |

설정이 잘못된 매장은 **불러올 때 건너뛰고 에러 로그를 남긴다.** 실행 중에 파일을 고쳐도 마찬가지다. 정규식에 `name` 그룹이 없거나,
기체가 비어 있거나, 채널 id가 없으면 그 매장만 빠지고 나머지는 정상 동작한다.

### 제목 파싱

TAIKO LABS 의 방송 제목은 다음 형식이다.

```
TAIKO LABS A1 Live Streaming 26.09.22 - 3부
TAIKO LABS THE BASE Live Streaming 26.09.22 - 2부
```

매장의 `titlePattern` 으로 파싱하고, `stations` 의 label·aliases 로 기체 id를 찾는다.
매칭은 공백·대소문자·구분자를 무시하므로 `THE BASE`, `the-base` 가 모두 해석된다.
같은 기체에 여러 방송이 걸리면 **높은 부 > 최신** 순으로 하나만 남긴다.

> 정규식이 설정값이라 컴파일 타임 생성(`GeneratedRegex`)을 쓸 수 없다. 대신 **250ms 매칭
> 타임아웃**을 건다. 잘못된 패턴이 백트래킹으로 폴링 스레드를 묶는 사고를 막기 위함이다.

### 할당량 전략

`search.list` 는 호출당 **100 유닛**이라 하루 10,000 유닛 기본 할당량으로는 5분 폴링조차 감당이 안 된다.
대신 이렇게 한다.

| 단계 | 호출 | 비용 |
| --- | --- | --- |
| 최근 업로드 id 수집 | `playlistItems.list` (업로드 재생목록) | 1 유닛 |
| 라이브 여부 확인 | `videos.list` (id 최대 50개 일괄) | 1 유닛 |

**폴링 1회당 2 유닛**, 60초 주기로 하루 약 2,880 유닛이다. 여유가 충분하다.

> 업로드 재생목록 id는 채널 id의 `UC` 접두사를 `UU` 로 바꾸면 얻어지므로 `channels.list` 호출도 생략한다.

### 모드

`YouTube:Mode` 로 전환한다.

| 모드 | API 키 | 동작 |
| --- | --- | --- |
| `Auto` (기본) | 선택 | 키가 있으면 `Api`, 없으면 `Public` |
| `Api` | **필수** | 공식 API로 라이브 상태 조회. 권장 |
| `Public` | 불필요 | RSS로 후보를 모으고 공개 watch 페이지로 라이브 여부 확인 (할당량 0) |
| `Mock` | 불필요 | 완전 오프라인. 일부 기체만 채워 `준비중...` 상태까지 확인 |

**중요: 라이브가 아닌 방송은 어떤 모드에서도 표시하지 않는다.** 방송이 끝나면 해당 기체는
다시보기가 아니라 `준비중...` 으로 돌아간다.

#### `Public` 모드의 라이브 판별

RSS 피드는 영상 목록만 줄 뿐 라이브 여부를 알려주지 않는다. 그래서 각 후보의 공개 watch
페이지에 있는 `liveBroadcastDetails` 를 확인한다.

```
방송 중 : {"isLiveNow":true,"startTimestamp":"..."}
방송 종료: {"isLiveNow":false,"startTimestamp":"...","endTimestamp":"..."}
```

watch 페이지는 1.2MB쯤 되므로 두 가지로 비용을 줄인다.

- 해당 값을 찾는 즉시 응답 읽기를 중단한다 (전체의 약 60% 지점).
- **종료가 확인된 영상은 영구히 기억한다.** 방송은 다시 살아나지 않으므로 재조회할 이유가 없다.
  덕분에 정상 상태에서는 신규 영상만 조회한다 — 실측 1회차 1,913ms → 2회차 130ms.

이 방식은 공식 API가 아니라 YouTube의 페이지 구조에 의존하는 **최선 노력 수준의 대안**이다.
운영에는 `YouTube:ApiKey` 를 설정해 `Api` 모드를 쓰는 편이 안전하다.

### 상태 유지

폴링이 실패해도 마지막 성공 스냅샷을 유지한다. 일시적인 유튜브 오류로 화면 전체가 비는 일을 막기 위함이다.

### 백엔드 들여다보기

개발 모드로 실행 중이면 백엔드 주소(기본 `http://localhost:5180`)에서 바로 볼 수 있다.

| 주소 | 내용 |
|---|---|
| `/status` | `/api/health`·`/api/venues`·`/api/live`를 합친 상태 화면. 매장별 영업 상태, 기체별 방송, 기체를 못 찾은 방송, 응답 시간. 각 값 아래에 JSON 필드 이름이 붙어 있다. 10초마다 갱신. |
| `/swagger` | Swagger UI. 엔드포인트 설명과 응답 스키마, 직접 호출해보기 |
| `/openapi/v1.json` | OpenAPI 문서 |

운영 환경에서는 꺼져 있다. 켜려면 `ApiDocs:Enabled`를 `true`로 설정한다(환경 변수 `ApiDocs__Enabled=true`).

---

## API 키 설정

1. [Google Cloud Console](https://console.cloud.google.com)에서 **YouTube Data API v3** 를 활성화하고 API 키를 발급한다.
2. 키를 저장한다. 소스에 커밋하지 말 것.

```powershell
# 로컬 개발
cd backend/TaikoLabs.Api
dotnet user-secrets init
dotnet user-secrets set "YouTube:ApiKey" "발급받은_키"
```

배포 환경에서는 환경 변수를 쓴다 (`:` 대신 `__`).

```
YouTube__ApiKey=발급받은_키
YouTube__Mode=Api
```

---

## 화면

### 매장 선택

매장은 헤더 최상단의 **탭**으로 전환한다. 탭마다 현재 송출 중인 기체 수가 배지로 붙어,
전환하지 않고도 어느 매장이 돌아가는지 보인다. 매장은 각각 다른 사업장이라 탭마다 고유 색을 쓴다.

### 보기 선택

**보기 목록은 매장마다 다르다.** 배치도가 없는 매장에는 배치도 항목이 아예 나타나지 않고,
보기가 하나뿐이면 콤보박스 자체가 숨겨진다.

| 보기 | 조건 | 내용 |
| --- | --- | --- |
| **통합** | 항상 | 모든 기체를 균등한 타일로 나열 |
| **구역별** | `zones` 2개 이상 | A 사이트 / B 사이트 / The Base 등

배치도 보기는 목록에서 뺐다. 같은 화면에서 타일이 작아 방송 내용이 잘 안 보였기 때문이다.
`layout` 설정과 `FloorPlanView` 코드는 남아 있지만 쓰이지 않는다.

- **실행하면 항상 통합으로 시작한다.** 마지막에 본 화면을 기억하지 않는다.
- 보기를 바꾸면 `?view=all-grid`, `?view=sector-a` 형태로 주소에 반영되어 링크로 공유된다.
  이 주소로 접속하면 기본값 대신 해당 보기로 열린다.
- 사이드 패널의 **화면 크기** 컨트롤(또는 `Ctrl +` / `Ctrl -` / `Ctrl 0`)로 타일 크기를 조절한다.
  타일 최소 너비가 바뀌어 한 줄에 들어가는 개수가 달라진다.
- 방송이 없는 기체는 영업 상태에 따라 `준비중...` / `영업 종료` / `오늘 휴무` 로 나뉘어 표시된다.

### 소리

브라우저는 음소거 상태가 아니면 자동재생을 막는다. 따라서 모든 타일은 **음소거로 시작**하고,
타일 위의 버튼으로 **한 번에 하나만** 소리를 켤 수 있다. 다른 타일을 선택하면 이전 타일은 자동으로 음소거된다.

데스크톱 셸에는 이 제약이 없다. 이유는 [데스크톱 셸](#데스크톱-셸) 에 적었다.

---

## 영업시간과 휴무

방송이 없을 때 무조건 `준비중...` 을 띄우면 새벽 3시에도 곧 방송이 시작될 것처럼 보인다.
그래서 영업 상태에 따라 문구를 나눈다.

| 상태 | 표시 |
| --- | --- |
| 영업 중 · 방송 없음 | `준비중...` |
| 영업시간 밖 | `영업 종료` + `10:00 오픈` |
| 휴무일 | `오늘 휴무` + 다음 영업일 |

**라이브가 있으면 영업 상태와 무관하게 항상 재생한다.** 판정이 틀려도 방송을 가리지 못하므로,
오답의 대가가 "문구가 조금 어색함"으로 제한된다.

### 영업시간 설정

`Venue:Hours` 에 요일별로 둔다. 자정을 넘기는 마감은 시를 24 이상으로 적는다 —
토요일 07:00~익일 05:00 은 `07:00-29:00`.

```json
"Venue": {
  "TimeZone": "Asia/Seoul",
  "Hours": {
    "Monday": "10:00-24:00", "Tuesday": "10:00-24:00",
    "Wednesday": "10:00-24:00", "Thursday": "10:00-24:00",
    "Friday": "10:00-29:00", "Saturday": "07:00-29:00",
    "Sunday": "07:00-24:00"
  },
  "ClosedDates": ["2026-10-03"],
  "AutoDetectClosure": true,
  "NaverPlaceId": "1485818481",
  "ClosureRefreshHour": 5
}
```

자정을 넘긴 시간대는 **시작한 날**에 속한다. 토요일이 휴무면 일요일 새벽 3시도 휴무로 친다.

> `InvariantGlobalization` 을 켜면 ICU 시간대 데이터가 빠져 `Asia/Seoul` 조회가 실패한다.
> 그래서 이 프로젝트는 꺼 둔다. 조회에 실패하면 모든 영업시간이 9시간 어긋나므로 에러 로그를 남긴다.

### 임시휴무 자동 감지

`ClosedDates` 는 수동 입력이라 임시휴무를 못 따라간다. 그래서 네이버 플레이스의
`comingIrregularClosedDays` 를 **하루 1회**(기본 05:00) 조회한다. 사장님이 네이버에 임시휴무를
등록하면 다음 날 자동 반영된다.

- 하루 1회인 이유: 네이버는 요청 제한이 빡빡하다. 실제로 `pcmap` 쪽은 바로 **429** 를 뱉었다.
- 조회에 실패하면 **직전 결과를 유지**한다. `closures.cache.json` 에 캐시해 재시작에도 살아남는다.
- 수동 `ClosedDates` 가 항상 우선한다.
- 공식 API가 아니라 하이드레이션 데이터 파싱이므로, 구조가 바뀌면 조용히 빈 목록이 된다.
  그래도 영업시간 판정은 그대로 동작한다.

끄려면 `AutoDetectClosure: false`.

---

## 모바일

폰에서 기체 9대를 동시에 재생하는 것은 현실적이지 않다. 회선도 버겁고, iOS는 인라인 동시
재생 자체를 제한한다. 그래서 좁은 화면에서는 동작이 달라진다.

| | 데스크톱 | 모바일 (820px 이하 · 태블릿) |
| --- | --- | --- |
| 타일 | 즉시 재생 | **화면에 절반 이상 보이는 타일만 재생**, 벗어나면 2초 뒤 썸네일로 |
| 그리드 | 자동 배치 | 1열 |
| 채팅 | 오른쪽 패널 | 아래쪽 시트 |
| 소리·채팅 버튼 | 호버 시 표시 | 항상 표시 (터치엔 호버가 없음) |

그 밖에 챙긴 것들.

- 판별 기준은 **터치 여부가 아니라 화면 너비**다. 터치스크린 노트북은 데스크톱으로 취급한다.
- 콤보박스 글자 크기를 16px로 둔다. 그 미만이면 iOS Safari가 포커스 시 화면을 확대한다.
- 헤더와 확대/축소 버튼의 탭 영역을 키우고, 노치 대응으로 `env(safe-area-inset-*)` 을 적용한다.
- 타일이 작아지면 컨테이너 쿼리로 문구를 줄인다 (`임베드가 허용되지 않은 방송입니다` → `임베드 불가`).

---

## 배포

### 백엔드 — Azure Container Apps

폴링 워커가 계속 살아 있어야 하므로 **최소 복제본을 1 이상**으로 둔다. 0이면 스케일 투 제로되면서 폴링이 멈춘다.

```powershell
az containerapp up `
  --name taikolabs-api `
  --resource-group taikolabs `
  --location japaneast `
  --source backend/TaikoLabs.Api `
  --ingress external --target-port 8080 `
  --min-replicas 1 --max-replicas 1 `
  --env-vars "YouTube__ApiKey=<키>" "YouTube__Mode=Api" "Cors__AllowedOrigins__0=https://<프로젝트>.vercel.app"
```

### 프론트엔드 — Vercel

`frontend/vercel.json` 의 rewrite 대상을 배포된 백엔드 주소로 바꾼다.

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://taikolabs-api.<지역>.azurecontainerapps.io/api/:path*" }
  ]
}
```

이 rewrite 덕분에 브라우저는 Vercel 도메인 하나만 보게 되고, **CORS 설정이 필요 없어진다.**
Vercel 프로젝트 설정에서 Root Directory를 `frontend` 로 지정하면 나머지는 자동이다.

> Vercel Hobby 플랜은 비상업적 용도만 허용한다. 수익화 계획이 있다면 Cloudflare Pages를 쓰고
> 프록시는 `functions/api/[[path]].ts` 에 직접 구현한다.

---

## 데스크톱 셸

`desktop/shell` 의 Tauri 앱이다. **macOS 와 Windows 에서 같은 코드로 돈다** — 웹뷰만
플랫폼 기본을 쓴다 (macOS `WKWebView`, Windows `WebView2`).

```bash
cd desktop/shell
npm install
npm run dev      # Vite 개발 서버를 먼저 띄워 둘 것
npm run build    # .app + .dmg (macOS) / .msi + .exe (Windows)
```

**준비물.** Node와 [Rust](https://rustup.rs). Windows 는 Rust 설치 중에 안내되는
**Visual Studio C++ 빌드 도구**도 필요하다. WebView2 는 Windows 10/11 에 기본으로 들어 있다.
예전 WPF 뷰어(`desktop/TaikoLabs.Desktop`)는 이 셸로 대체되어 삭제했다.

`npm run build` 는 `frontend` 빌드를 먼저 돌리고 그 산출물을 앱 안에 넣는다.

> **개발 빌드에는 번들 프론트엔드가 없다.** `npm run dev` 에서는 `Bundled` 모드조차
> `devUrl`(5173)로 해석되므로, Vite를 띄우지 않으면 빈 창이 뜬다. 번들 동작을 확인하려면
> `npm run build` 로 만든 앱을 실행해야 한다.

### 셸이 존재하는 이유

브라우저는 음소거가 아닌 자동재생을 막는다. 셸에는 이 제약이 없고, **그게 셸의 유일한 존재
이유다.** wry가 웹뷰를 만들 때 자동재생을 기본으로 켜 주므로 코드에서 따로 요청하지 않는다 —
macOS 는 `mediaTypesRequiringUserActionForPlayback = None`, Windows 는
`--autoplay-policy=no-user-gesture-required` 로 생성된다.

### 채팅

타일의 **채팅** 버튼은 그 방송의 YouTube 라이브 채팅을 오른쪽 패널에 연다.

- **셸에서는 패널에서 바로 입력된다.** 패널 자리에 iframe 대신 **셸이 따로 띄운 웹뷰**를 겹친다.
  iframe 안의 youtube.com 은 WebKit 추적 방지 때문에 로그인 쿠키를 못 받아 읽기만 되지만,
  독립 웹뷰는 youtube.com 그 자체라 로그인이 된다. 추적 방지 설정은 건드리지 않는다.
- **브라우저에서는** 패널이 읽기 전용 iframe 이고, 입력은 [입력하기 ↗]로 여는 YouTube 채팅 창에서 한다.
- 페이지가 이 웹뷰를 부르는 명령은 `chat_panel` 하나이고, 외부 주소(개발 서버·배포본)에는
  셸이 실제로 띄운 사이트 한 곳에만 허용한다.

셸은 **멀티뷰 창이 다른 사이트로 넘어가지 않게** 지킨다. YouTube 플레이어가 창 전체를 Google
로그인 확인 페이지로 보내는 일이 있어서, 창이 앱 밖의 페이지를 불러오기 시작하면 즉시 되돌리고
로그인 요청은 채팅 창으로, 나머지 링크는 기본 브라우저로 보낸다.

### 설정

`shell.config.json` 을 아래 순서로 찾고, **처음 발견한 파일 하나만** 읽는다.
없는 키는 기본값을 쓰므로 바꿀 키만 적으면 된다. 본보기는 `shell.config.sample.json`.

1. `$TAIKO_SHELL_CONFIG` — 전체 경로. 설치본을 건드리지 않고 시험할 때
2. 실행 파일과 같은 폴더 — Windows 포터블 설치
3. `<앱 설정 폴더>/shell.config.json` — macOS 는 실행 파일이 `.app` 안에 있으므로 이쪽
   (`~/Library/Application Support/app.taikolabs.multiview/`)

| 키 | 설명 |
| --- | --- |
| `frontendMode` | `Auto`(기본) / `DevServer` / `Bundled` / `Remote` |
| `devServerUrl` | Vite 개발 서버 주소 |
| `remoteUrl` | 배포된 프론트엔드 주소. `Auto` 에서 개발 서버가 없을 때 차선 |
| `apiBaseUrl` | **`Bundled` 에서만** 쓰는 백엔드 주소 |
| `allowAutoplayWithSound` | 자동재생 허용. 기본 `true` |

`Auto` 는 개발 서버 → `remoteUrl` → 번들 순으로 내려간다. 무엇을 열었는지는 **창 제목에**
적히므로 확인할 필요가 없다. 어느 모드든 실패하면 번들로 떨어지므로 빈 창은 뜨지 않는다.

`apiBaseUrl` 을 번들 모드에서만 쓰는 이유는, 개발 서버는 Vite가 `/api` 를 프록시하고 배포본은
호스트가 rewrite 하므로 **둘 다 이미 동일 오리진**이기 때문이다.

> `allowAutoplayWithSound: false` 는 Windows 에서만 듣는다. WKWebView 는 미디어 정책을
> 생성 시점에 확정하고 Tauri 가 그 스위치를 노출하지 않는다.

### 단축키

플랫폼 관습을 따르므로 둘이 다르다. macOS 에서 `F11` 은 Mission Control 이 가져간다.

| | macOS | Windows |
| --- | --- | --- |
| 다시 불러오기 | `Cmd R` | `F5` |
| 전체화면 | `Cmd Ctrl F` | `F11` |
| 개발자 도구 | `Cmd Alt I` | `F12` |

다시 불러오기와 개발자 도구는 **멀티뷰** 메뉴에 있다. 전체화면은 macOS 에서는 표준 **View**
메뉴가 이미 제공하므로 중복으로 넣지 않았고, 네이티브 전체화면이라 `Esc` 로 빠져나온다.
Windows 에는 표준 View 메뉴가 없어 **멀티뷰** 메뉴에 직접 넣었다 — 나올 때는 `F11` 을 다시 누른다.

### 아이콘

`icons/source.png` 는 자리를 채우기 위한 임시 도안이다. 실제 로고가 생기면 그 파일을 바꾸고
`npx tauri icon src-tauri/icons/source.png` 를 다시 돌리면 나머지 포맷이 전부 생성된다.

---

## 테스트

세 가지다. 코드를 고친 뒤에는 앞의 둘, 배포 전에는 셋 다 돌린다.

```bash
# 백엔드 — 기체별 방송 선택, 조회 간격, 설정 자동 반영, 영업시간 판정
dotnet test TaikoLabsMultiview.slnx

# 프론트엔드 로직 — 등록기 저장 왕복·검증·제목 규칙, 라이브 지연 계산, 배치 칸 수
cd frontend && npm test

# 화면 전체 — Chromium · WebKit · iPhone(WebKit)
cd frontend && npx playwright install chromium webkit   # 처음 한 번
cd frontend && npm run test:e2e
```

- 화면 테스트는 **Mock 모드 백엔드(5190)와 전용 Vite(5174)** 를 직접 띄우므로 개발 중인 5180/5173 과
  부딪히지 않고, YouTube 로는 요청이 나가지 않는다. PATH 의 `dotnet` 이 .NET 10 이 아니면
  `DOTNET=/경로/dotnet npm run test:e2e` 로 지정한다.
- WebKit 을 꼭 포함한다. 데스크톱 셸(macOS)의 엔진이라, 로고가 안 바뀌거나 화면 밖 영상이 멈추는 식의
  문제는 WebKit 에서만 드러났다.
- 등록기 화면 테스트는 셸을 흉내 내 실제 `venues.json` 을 읽기만 한다. 파일은 바꾸지 않는다.
- 사람이 확인해야 하는 항목(로그인, 실제 재생, Windows 빌드, iPhone)은 QA 체크리스트로 따로 관리한다.

## 알려진 제약

- **동시 재생 부하** — 1080p 9개 동시 재생은 CPU·대역폭 부담이 크다. 필요하면 동시 재생 수를 제한한다.
- **임베드 불가 방송** — 저작권 등으로 임베드가 막힌 방송은 플레이어 대신 "유튜브에서 보기" 카드가 뜬다.
- **RSS 15개 제한** — `Public` 모드는 피드의 최근 15개만 보므로, 한 회차 9개 기체까지는 충분하지만 그 이상 거슬러 올라가지 못한다.
- **`Public` 모드의 취약성** — YouTube가 watch 페이지 구조를 바꾸면 라이브 판별이 멈춘다. 그때는 전부 `준비중...` 으로 보인다. API 키 설정이 근본 대책이다.
- **매장 등록기는 Avalonia UI** — `tools/TaikoLabs.VenueEditor` 는 Windows·macOS·Linux 에서 같은 코드로 돈다.
  기체·구역 표에는 빈 줄 입력이 없으므로 [기체 추가]·[구역 추가] 버튼으로 행을 만든다.
- **.NET 10 SDK 필요** — 백엔드는 `net10.0` 이다. SDK 가 그보다 낮으면 `dotnet run` 이 거부한다 (도커 이미지는 무관).
- **경로에 `#` 금지** — Vite가 경로를 URL로 다루기 때문에 `#` 이 들어간 디렉터리 아래에서는 빌드가 실패한다.
