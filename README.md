# 태고 멀티뷰

태고의 달인 매장들의 유튜브 라이브를 한 화면에서 보는 멀티뷰.

- 매장 추가: `venues.json` 수정만으로 끝. 코드 수정 없음
- 배포: 컨테이너 하나가 화면과 API를 함께 서빙
- 데스크톱 앱: 브라우저의 자동재생 제한 없이 재생

```
컨테이너 하나 (Azure Container Apps)
  ASP.NET Core API + React 빌드  ──▶  브라우저
       │                         └▶  Tauri 데스크톱 앱 (macOS · Windows)
       └─ YouTube Data API v3 / RSS
```

| 구성 | 위치 | 역할 |
| --- | --- | --- |
| 백엔드 | `backend/TaikoLabs.Api` | 방송 폴링, 영업시간 판정, JSON API (.NET 10) |
| 프론트엔드 | `frontend` | 멀티뷰, 매장 등록기 (React 18 + TypeScript + Vite) |
| 데스크톱 앱 | `desktop/shell` | Tauri 셸 |
| 디자인 규칙 | `design.md` | 색·글꼴·버튼 규칙. 화면 수정 전에 확인 |

## 실행

```bash
# 백엔드 (http://localhost:5180)
cd backend/TaikoLabs.Api && dotnet run

# 프론트엔드 (http://localhost:5173)
cd frontend && npm install && npm run dev

# 데스크톱 앱 (선택)
cd desktop/shell && npm install && npm run dev
```

- API 키 없음: `Public` 모드로 동작 (공개 페이지로 라이브 확인)
- 네트워크 없이 화면만 확인: `YouTube__Mode=Mock`
- Windows: `scripts/dev.ps1` 로 셋을 한 번에 실행

## 매장 관리

### venues.json

매장 목록의 위치는 `backend/TaikoLabs.Api/venues.json`. 실행 중에 고쳐도 재시작 없이 반영.

- 매장 데이터: `venues.json`
- 앱 설정(시간대, 휴무 조회 시각): `appsettings.json`
- 두 파일은 하나의 `Venues` 설정으로 합쳐짐

매장 변경 흐름:

1. 매장 등록기로 수정·저장 → 로컬 백엔드와 멀티뷰에 즉시 반영
2. `venues.json` 커밋 후 `main` 에 반영 → 이력과 되돌리기는 git 으로
3. GitHub Actions 테스트 → 배포가 켜져 있으면 서버에 반영

### 매장 등록기

로컬 전용. 여는 곳은 데스크톱 앱의 **멀티뷰 → 매장 등록기** 메뉴 (`Cmd/Ctrl+Shift+E`), 여는 파일은 자동으로 찾은 `venues.json`.

- 열리는 경우: 개발 서버(`localhost`)를 띄웠을 때, 또는 번들 빌드가 로컬 API를 쓸 때
- 열리지 않는 경우: 배포된 사이트를 띄운 앱 (메뉴 없음), 웹의 `?screen=editor` (멀티뷰가 뜸)
- 이유: 등록기가 고치는 건 이 컴퓨터의 파일. 실서버 반영은 커밋과 배포로

손으로 JSON을 고칠 때보다 나은 점은 틀리기 쉬운 부분을 실제 데이터로 확인해 준다는 것.

- 채널 조회: `@핸들`·채널 주소 입력 → `channelId` 와 이름 자동 입력
- 제목 규칙: 최근 방송 제목 15건의 기체 연결 결과를 표로 표시. 연결 안 되는 제목은 `aliases` 로 보완. 제목에서 기체 이름을 드래그하면 정규식 생성
- 검증: API 시작 시 검사를 미리 실행. API가 매장을 건너뛸 문제가 있으면 저장 차단

기존 매장의 배치도 좌표는 편집하지 않고 그대로 보존. 예전 Avalonia 등록기(`tools/TaikoLabs.VenueEditor`)도 같은 파일 사용.

### 항목

```json
{
  "id": "example",
  "name": "○○ 게임장",
  "accent": "#5B8DEF",
  "logo": "logos/example.svg",
  "channelId": "UC...",
  "channelUrl": "https://www.youtube.com/@example",
  "titlePattern": "^\\[(?<name>\\d+번)\\]",
  "stations": [
    { "id": "1", "label": "1번대", "aliases": ["1번"] },
    { "id": "2", "label": "2번대" }
  ],
  "hours": { "Monday": "12:00-23:00", "Saturday": "10:00-26:00" },
  "closedDates": ["2026-10-03"],
  "naverPlaceId": "1234567890"
}
```

| 필드 | 설명 |
| --- | --- |
| `accent` | 매장 고유색. 매장 표시와 로고 자리 전용 (선택·방송 중 표시에는 안 씀) |
| `logo` | `frontend/public/logos/` 아래 경로나 절대 URL. 비우면 유튜브 채널 프로필 사진 (API 키 필요) |
| `titlePattern` | 방송 제목 정규식. `(?<name>...)` 그룹 필수, `date` · `part` 는 선택 |
| `stations` | 기체 목록. `aliases` 로 제목의 다른 표기 흡수 |
| `zones` | 구역. 2개 이상이면 구역별 보기 생성 |
| `hours` | 요일별 영업시간. 자정을 넘기면 24 이상으로 표기 (`07:00-29:00` = 다음 날 05:00) |
| `closedDates` | 휴무일 |
| `naverPlaceId` | 있으면 네이버 플레이스 임시휴무를 하루 1회 조회 |
| `layout` | 배치도 좌표. 현재 화면에서는 미사용 |

설정이 잘못된 매장은 불러올 때 제외하고 에러 로그만 남김. 나머지 매장은 정상 동작.

## 동작

### 제목 해석

`titlePattern` 으로 기체 이름을 뽑아 `stations` 의 `label` · `aliases` 와 연결.

```
TAIKO LABS A1 Live Streaming 26.09.22 - 3부
TAIKO LABS THE BASE Live Streaming 26.09.22 - 2부
```

- 공백·대소문자·구분자 무시: `THE BASE` 와 `the-base` 는 같은 기체
- 한 기체에 방송이 여럿이면 회차가 높은 것, 같으면 최신 것 하나만 표시
- 잘못된 패턴이 폴링을 붙잡지 않도록 매칭 시간 250ms 제한

### 쿼터

매장 4곳 기준 하루 약 7,000 유닛. 하루 한도 10,000 유닛의 70% 남짓.

| 단계 | 호출 | 비용 |
| --- | --- | --- |
| 최근 업로드 id | `playlistItems.list` (채널 id의 `UC` 를 `UU` 로 바꾼 업로드 재생목록) | 1 유닛 |
| 라이브 여부 | `videos.list` (id 최대 50개) | 1 유닛 |

- 매장 하나의 폴링 1회: 2 유닛
- 영업 중 간격: `PollIntervalSeconds` (기본 60초)
- 영업시간 밖 간격: `ClosedPollIntervalSeconds` (기본 600초). 오픈 30분 전부터 다시 영업 중 간격
- 하루 14시간 영업 매장 하나: 약 1,800 유닛
- 매장이 늘면 간격을 늘려서 조정
- `search.list` (호출당 100 유닛)는 사용 안 함
- 사용자 수와 무관: 서버가 폴링한 결과를 모두에게 공유. 새로고침 버튼도 매장별 60초 쿨다운

### 모드

`YouTube:Mode` 로 선택. 운영에는 `Api`.

| 모드 | API 키 | 동작 |
| --- | --- | --- |
| `Auto` (기본) | 선택 | 키가 있으면 `Api`, 없으면 `Public` |
| `Api` | 필요 | 공식 API |
| `Public` | 불필요 | RSS로 후보 수집 후 공개 watch 페이지의 `isLiveNow` 로 확인. 쿼터 사용 없음 |
| `Mock` | 불필요 | 네트워크 없는 가짜 데이터 |

- 라이브가 아닌 방송은 어느 모드에서도 표시 안 함. 방송이 끝나면 그 기체는 `준비중…` 으로 복귀
- 폴링 실패 시 마지막 성공 결과 유지
- `Public` 모드의 한계: 공식 API가 아니라 페이지 구조에 의존. 유튜브가 구조를 바꾸면 중단
- `Public` 모드의 비용 절감: watch 페이지(약 1.2MB)는 필요한 값까지만 읽고, 끝난 방송은 기억해서 재조회 안 함

### 영업시간과 휴무

방송 없는 기체의 문구를 영업 상태에 맞게 구분. 새벽에 `준비중…` 이 떠 있으면 곧 방송이 시작될 것처럼 보이기 때문.

| 상태 | 표시 |
| --- | --- |
| 영업 중, 방송 없음 | `준비중…` |
| 영업시간 밖 | `영업 종료` + 다음 오픈 시각 |
| 휴무일 | `오늘 휴무` + 다음 영업일 |

- 라이브가 있으면 영업 상태와 무관하게 재생. 판정이 틀려도 방송을 가리지 않음
- 자정을 넘긴 시간은 시작한 날 소속. 토요일이 휴무면 일요일 새벽 3시도 휴무
- 임시휴무: `naverPlaceId` 가 있는 매장만 네이버 플레이스에서 하루 1회 (기본 05:00) 조회
  - 하루 1회인 이유: 네이버의 빡빡한 요청 제한
  - 실패 시 직전 결과 사용. `closures.cache.json` 에 저장되어 재시작 후에도 유지
  - `closedDates` 가 항상 우선
- `InvariantGlobalization` 은 꺼 둘 것. 켜면 `Asia/Seoul` 시간대를 못 찾아 영업시간이 9시간 어긋남

## 화면

- 매장 전환: 위쪽 탭. 탭마다 로고와 송출 중인 기체 수
- 보기: 통합, 구역별. 구역이 하나뿐인 매장은 통합만. 선택한 보기는 주소의 `?view=` 로 공유 가능
- 배치: 1×1 ~ 4×4 선택, 선택값 기억. 단축키 `Ctrl/Cmd +` · `-` · `0`. 기체가 적으면 열 수 자동 축소
- 소리: 모든 타일이 음소거로 시작, 한 번에 한 타일만 소리 켜기 가능 (브라우저의 자동재생 제한 때문. 데스크톱 앱은 제한 없음)
- 로딩: 플레이어가 뜨기 전까지 방송 썸네일과 `NOW LOADING` 표시

### 모바일

폰에서는 보이는 타일만 재생. 9개 동시 재생은 회선이 못 버티고, iOS도 인라인 동시 재생을 제한하기 때문. 기준은 820px 이하 (터치 태블릿은 1200px 이하).

| | 데스크톱 | 모바일 |
| --- | --- | --- |
| 재생 | 모든 타일 | 절반 이상 보이는 타일만. 벗어나면 2초 뒤 썸네일로 |
| 배치 | 1×1 ~ 4×4 | 1열 |
| 소리 버튼 | 마우스를 올리면 표시 | 항상 표시 |

타일이 작아지면 문구도 축약 (`임베드가 허용되지 않은 방송입니다` → `임베드 불가`).

## API

| 주소 | 내용 |
| --- | --- |
| `GET /api/health` | 서버 상태, 유튜브 모드, 키 설정 여부 (키 값은 비공개) |
| `GET /api/venues` | 매장 설정 |
| `GET /api/live` | 매장별 현재 방송과 영업 상태 |
| `POST /api/live/refresh` | 즉시 재조회. `?venueId=` 로 한 매장만 |

개발 환경 전용 페이지 (다른 환경은 `ApiDocs__Enabled=true` 로 켜기):

| 주소 | 내용 |
| --- | --- |
| `/status` | 위 세 API를 합친 상태 화면. 값마다 JSON 필드 이름 표시, 10초마다 갱신 |
| `/swagger` | Swagger UI |
| `/openapi/v1.json` | OpenAPI 문서 |

## API 키

개발용과 실서버용 Google Cloud 프로젝트를 나눠서 발급 권장. 쿼터가 키가 아니라 프로젝트 단위라, 나누면 개발 중에 실서버 쿼터를 쓰지 않음.

1. [Google Cloud Console](https://console.cloud.google.com)에서 YouTube Data API v3 활성화 후 키 발급
2. 키의 API 제한을 YouTube Data API v3 하나로 설정
3. 키 저장 (커밋 금지)

```bash
# 로컬
cd backend/TaikoLabs.Api
dotnet user-secrets set "YouTube:ApiKey" "<키>"
```

서버는 환경 변수 `YouTube__ApiKey`. Azure 는 컨테이너 앱 시크릿 사용 (아래 참고).

## 성능 측정

가짜 매장과 실제 재생되는 플레이어로 로컬에서 부하를 재는 방법: [frontend/perf/README.md](frontend/perf/README.md)

## 배포

환경 하나에 컨테이너 하나. 루트의 `Dockerfile` 이 프론트엔드를 빌드해 API의 `wwwroot` 에 포함하므로, 화면과 `/api` 가 같은 주소. 프록시·CORS 설정 불필요.

```bash
docker build -t taiko-multiview .
docker run -p 8080:8080 -e YouTube__Mode=Mock taiko-multiview   # http://localhost:8080
```

| 환경 변수 | 설명 |
| --- | --- |
| `YouTube__ApiKey` | 유튜브 키 |
| `YouTube__Mode` | `Api` / `Public` / `Mock` |
| `ApiDocs__Enabled` | `true` 면 `/swagger`, `/status` 공개 |
| `ASPNETCORE_ENVIRONMENT` | 개발 서버 `Staging`, 실서버는 기본값 (`Production`) |

### Azure Container Apps

최대 복제본은 반드시 1. 폴링 상태를 메모리에 들고 있어서, 둘이면 각자 폴링해 쿼터를 두 배로 소모.

- 실서버: 최소 복제본 1 (0이면 꺼지면서 폴링 중단)
- 개발 서버: 최소 복제본 0 (아무도 안 볼 때 꺼져서 비용·쿼터 0, 접속하면 재시작)

| 리소스 | 이름 |
| --- | --- |
| 리소스 그룹 (한국 중부) | `rg-taiko-multiview` |
| Container Apps 환경 (개발·실서버 공용) | `cae-taiko-multiview` |
| 개발 서버 | `taiko-multiview-dev` (최소 0 / 최대 1, 0.25 vCPU / 0.5 GiB)<br>https://taiko-multiview-dev.agreeabletree-b826eb73.koreacentral.azurecontainerapps.io |
| 이미지 | `ghcr.io/ironhiro/taiko-multiview` (공개) |

새 이미지를 개발 서버에 반영:

```bash
# ARM 맥에서도 에뮬레이션 없이 amd64 로 빌드 (Dockerfile 주석 참고)
docker buildx build --platform linux/amd64 -t ghcr.io/ironhiro/taiko-multiview:$(git rev-parse --short HEAD) --push .
az containerapp update -n taiko-multiview-dev -g rg-taiko-multiview --image ghcr.io/ironhiro/taiko-multiview:<태그>
```

유튜브 키 위치는 컨테이너 앱 시크릿 `youtube-api-key`, 연결은 `YouTube__ApiKey=secretref:youtube-api-key`. 키 교체 시 시크릿만 변경.

## 데스크톱 앱

`desktop/shell` 의 Tauri 앱. 존재 이유는 자동재생: 브라우저는 소리 있는 자동재생을 막지만, 앱의 웹뷰는 처음부터 허용된 상태로 생성.

- macOS·Windows 공용 코드. 웹뷰는 각 플랫폼 기본 (`WKWebView`, `WebView2`)
- 준비물: Node, [Rust](https://rustup.rs). Windows 는 Rust 설치 중 안내되는 Visual Studio C++ 빌드 도구도 필요

```bash
cd desktop/shell
npm install
npm run dev      # Vite 개발 서버를 먼저 실행
npm run build    # .app · .dmg (macOS) / .msi · .exe (Windows)
```

- `npm run build`: 프론트엔드를 먼저 빌드해 앱 안에 포함
- `npm run dev`: 앱에 번들이 없음. Vite를 안 띄우면 빈 창

### 창 이탈 방지

유튜브 플레이어가 창 전체를 로그인 페이지로 보내는 경우가 있어, 멀티뷰 창이 다른 사이트로 넘어가면 즉시 되돌림. 유튜브가 스스로 거치는 로그인 확인(`passive=true`)은 버리고, 나머지 주소와 새 창 요청은 기본 브라우저로

### 설정

`shell.config.json` 을 아래 순서로 찾아 처음 찾은 파일 하나만 사용. 없는 키는 기본값. 본보기는 `shell.config.sample.json`.

1. 환경 변수 `TAIKO_SHELL_CONFIG` 의 경로
2. 실행 파일과 같은 폴더 (Windows 포터블)
3. 앱 설정 폴더. macOS 는 `~/Library/Application Support/app.taikolabs.multiview/`

| 키 | 설명 |
| --- | --- |
| `frontendMode` | `Auto`(기본) / `DevServer` / `Bundled` / `Remote` |
| `devServerUrl` | Vite 개발 서버 주소 |
| `remoteUrl` | 배포된 서버 주소 |
| `apiBaseUrl` | `Bundled` 전용 백엔드 주소. 다른 모드는 화면과 API가 같은 주소 |
| `allowAutoplayWithSound` | 소리 있는 자동재생 허용. 기본 `true`, 끄기는 Windows 만 가능 |

- `Auto` 순서: 개발 서버 → `remoteUrl` → 번들
- 무엇을 열었는지는 창 제목에 표시
- 어느 모드든 실패하면 번들로 열기

### 단축키

| | macOS | Windows |
| --- | --- | --- |
| 다시 불러오기 | `Cmd R` | `F5` |
| 전체화면 | `Cmd Ctrl F` | `F11` |
| 매장 등록기 | `Cmd Shift E` | `Ctrl Shift E` |
| 개발자 도구 | `Cmd Alt I` | `F12` |

macOS 전체화면은 기본 View 메뉴 사용 (`F11` 은 Mission Control 몫).

### 아이콘

원본은 `src-tauri/icons/source.svg`. 수정 후 PNG로 내보내 `source.png` 갱신 → `npx tauri icon src-tauri/icons/source.png` 실행 시 나머지 크기 자동 생성.

## 테스트

코드 수정 후에는 앞의 둘, 배포 전에는 셋 모두 실행.

```bash
# 백엔드: 기체별 방송 선택, 폴링 간격, 설정 반영, 영업시간
dotnet test TaikoLabsMultiview.slnx

# 프론트엔드 로직: 등록기 저장·검증·제목 규칙, 라이브 지연, 배치 열 수, 로컬 판별
cd frontend && npm test

# 화면: Chromium · WebKit · iPhone
cd frontend && npx playwright install chromium webkit   # 최초 1회
cd frontend && npm run test:e2e
```

- 화면 테스트는 Mock 모드 백엔드(5190)와 전용 Vite(5174)를 따로 실행. 개발 중인 서버와 충돌 없고 유튜브로 요청도 안 보냄
- PATH 의 `dotnet` 이 .NET 10 이 아니면 `DOTNET=/경로/dotnet npm run test:e2e`
- WebKit 은 빼지 말 것. macOS 앱의 엔진이고, 로고 미갱신·화면 밖 영상 정지 같은 문제는 WebKit 에서만 발생
- 로그인, 실제 재생, Windows 빌드, iPhone 은 QA 체크리스트로 직접 확인

## 알려진 제약

- 1080p 9개 동시 재생: CPU·대역폭 부담 큼
- 임베드 막힌 방송: 플레이어 대신 `유튜브에서 보기` 링크 표시
- `Public` 모드: RSS의 최근 15개만 조회. 더 오래된 방송은 못 찾음
- 백엔드 실행: .NET 10 SDK 필요 (도커 빌드는 무관)
- 경로에 `#` 이 들어간 폴더: Vite 빌드 실패
