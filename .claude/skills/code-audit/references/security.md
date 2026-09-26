# 보안 점검표

공개 인터넷에 떠 있는 서비스(개발 서버, 실서버)와 사용자 PC에서 도는 데스크톱 앱 두 면을 본다. 2026-09-25 외부 제보(이슈 #1)로 보안 헤더·요청 제한이 들어갔으니, 그 조치가 **여전히 유효한지**부터 확인한다.

## 서버 (backend/TaikoLabs.Api)
- 인증 없는 쓰기 엔드포인트: `POST /api/live/refresh`(IP당 분당 6회 + 매장별 쿨다운), `POST /api/diagnostics`(`Diagnostics:ClientReports`가 켜진 환경에서만, 분당 120, 본문 2KB). 새 쓰기 엔드포인트가 제한 없이 생겼나.
- `ForwardedHeaders`: `KnownIPNetworks`/`KnownProxies`를 비웠고 ForwardLimit=1에 기대 마지막 홉만 믿는다. 인그레스 없이 직접 노출되는 경로가 생기면 위조 가능. 요청 제한 파티션 키가 이 IP를 쓴다.
- 보안 헤더(`SetSecurityHeaders`): CSP 지시어가 실제 로드 자원과 맞나(YouTube 스크립트·프레임, 이미지 https 전체 허용의 범위), `/swagger`·`/status` 예외, HSTS 조건, Server 헤더 제거.
- CORS: 개발 설정 `AllowedOrigins: ["*"]`가 운영에 새지 않나(`appsettings.json`과 환경별 파일 비교).
- 비밀: API 키는 환경 변수/컨테이너 시크릿. 저장소·이미지·로그·`/api/health` 응답에 키 값이 새지 않나(`HasApiKey`만 노출). `.gitignore`, `.dockerignore` 확인.
- 외부 입력: `venueId` 쿼리, `venues.json`의 `titlePattern`(정규식 → ReDoS 가능성, 타임아웃 있나), 스크래핑하는 YouTube/Naver 응답 파싱(크기 제한, 예외 처리).
- 로그 주입: 클라이언트 진단 본문을 로그에 그대로 쓴다(줄바꿈은 치환). 다른 제어 문자·길이.
- 의존성: `dotnet list backend/TaikoLabs.Api package --vulnerable`.

## 프론트엔드
- XSS: `innerHTML`, `dangerouslySetInnerHTML`, URL을 속성에 넣는 곳(`href`에 `javascript:` 가능성), 매장 설정의 `logo`·`channelUrl`이 그대로 렌더되는 곳.
- iframe: 플레이어 iframe 출처, `postMessage` 수신 시 origin 확인.
- `window.open`: `noopener` 여부(열린 창이 opener를 조작할 수 있나), 열리는 URL의 출처 고정.
- 저장소: `localStorage`에 민감 정보가 없나.
- 의존성: `cd frontend && npm audit --omit=dev`.

## 데스크톱 셸 (Tauri)
- `capabilities/*.json`: 원격 URL을 띄우는 창에 과한 권한(파일시스템, shell)이 붙어 있나. 원격 페이지가 IPC 명령을 부를 수 있나.
- `editor.rs`: 파일 경로 결정(상위 디렉터리 탐색, 선택 대화상자) — 경로 조작으로 임의 파일을 쓰게 되는 경로가 있나.
- 네비게이션 가드(`main.rs`): 멀티뷰 창이 다른 사이트로 넘어가지 못하게 하는 로직의 우회 가능성, `open_elsewhere`로 넘기는 URL 검증.
- `initialization_script`에 넣는 값(`__TAIKO_API_BASE__`)의 이스케이프.

## CI/배포
- 워크플로 권한(`permissions:`), 시크릿 사용 범위, 서드파티 액션 버전 고정.
- Dockerfile: 비루트 실행, 불필요한 파일 포함 여부.
