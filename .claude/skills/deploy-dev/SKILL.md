---
name: deploy-dev
description: "태고 멀티뷰를 Azure Container Apps 개발 서버(taiko-multiview-dev)에 배포하고 배포 후 확인(버전, 보안 헤더, 요청 제한, 실제 사이트 로드)하는 절차. '개발서버에 배포', '배포해줘', 'dev 서버 반영', '배포 확인' 요청 시 반드시 이 스킬을 사용. 실서버 배포나 도메인 연결은 이 스킬 범위가 아님."
---

# 개발 서버 배포

이미지 하나에 API와 프론트엔드 빌드가 함께 들어간다(루트 `Dockerfile`). 개발 서버는 이미지를 바꿔 끼우면 새 리비전이 뜬다.

## 전제

- 배포할 커밋이 main에 머지되어 있을 것(사용자가 달리 말하지 않으면). 머지는 CI(backend, frontend, e2e) 통과 후에만.
- Docker: 컨텍스트가 Colima라 꺼져 있으면 `colima start`.
- ghcr 로그인: `gh auth token | docker login ghcr.io -u ironhiro --password-stdin` (gh 토큰에 `write:packages` 권한 필요).

## 절차

1. 태그는 커밋 해시: `TAG=$(git rev-parse --short HEAD)`
2. **이미지 빌드·push는 사용자가 실행한다.** 공개 레지스트리 push는 이 세션의 권한 검사에 막힌다. 사용자에게 정확한 명령을 준다:
   ```
   ! docker buildx build --platform linux/amd64 --build-arg BUILD_VERSION=<TAG> -t ghcr.io/ironhiro/taiko-multiview:<TAG> --push .
   ```
   `--build-arg BUILD_VERSION`을 빠뜨리지 않는다. 페이지가 오류 보고에 이 값을 빌드 버전으로 실어 보내므로, 없으면 로그에서 모든 빌드가 `unknown`이 된다(CI 배포는 자동으로 넣음).
3. push가 끝나면 반영(이건 직접 실행 가능):
   ```bash
   az containerapp update -n taiko-multiview-dev -g rg-taiko-multiview --image ghcr.io/ironhiro/taiko-multiview:<TAG> \
     --query "{image:properties.template.containers[0].image, rev:properties.latestRevisionName}" -o json
   ```
   같은 이미지로 다시 update하면 새 리비전이 생기지 않는다(무해).

## 배포 후 확인

주소: https://multiview-dev.ironhiro.dev (기본 주소 https://taiko-multiview-dev.agreeabletree-b826eb73.koreacentral.azurecontainerapps.io도 그대로 열림)

**배포는 보통 CI가 한다:** main에 push하면 테스트 후 `deploy-backend` 작업이 ghcr에 이미지를 올리고 개발 서버를 바꾼다. 이 절차의 수동 빌드는 main이 아닌 브랜치를 올릴 때만. CI는 개발 서버에 접속하지 못하므로(IP 잠금) 아래 확인은 이 PC에서 한다.

**접근 제한:** 인그레스 IP 허용 규칙 `this-pc`(작업 PC 공인 IP /32)만 열려 있다. 아래 확인이 전부 `403 RBAC: access denied`면 앱 문제가 아니라 공인 IP가 바뀐 것이다. `curl -s https://api.ipify.org`와 `az containerapp ingress access-restriction list -n taiko-multiview-dev -g rg-taiko-multiview -o table`을 비교하고, 다르면 사용자에게 알린 뒤 README "Azure Container Apps"의 명령으로 규칙을 덮어쓴다. 도메인 인증서(`mc-multiview-dev`)는 TXT 검증이라 IP 잠금과 무관하지만, 갱신 무렵(만료 2027-04-08)에 `az containerapp env certificate list -g rg-taiko-multiview -n cae-taiko-multiview --managed-certificates-only -o table`로 상태를 확인한다. 외부에서 막히는지 볼 때 WebFetch는 이 PC에서 나가므로 판정에 못 쓴다(외부 프록시 `https://r.jina.ai/<주소>`로 403 확인).

- `/api/health`: environment가 `Staging`, youTubeMode `Api`, hasApiKey `true`
- 보안 헤더: `curl -sI <주소>/`에서 content-security-policy, strict-transport-security, x-content-type-options, x-frame-options, referrer-policy가 있고 `server` 헤더가 없음
- 요청 제한: `POST /api/live/refresh` 7번째부터 429. `X-Forwarded-For`를 위조해도 429(인그레스가 붙인 마지막 IP를 쓰므로)
- `/api/diagnostics`: `Diagnostics__ClientReports` 환경 변수에 따라 다름. 확인은 `az containerapp show -n taiko-multiview-dev -g rg-taiko-multiview --query "properties.template.containers[0].env[].name"`
  - 꺼짐(변수 없음): `GET`·`POST` 모두 404
  - 켜짐: `GET` → `{"infoSampleRate":<Diagnostics__InfoSampleRate, 기본 0>}`. 같은 IP로 `POST`(`{"kind":"js-error"}`) 31번째부터 429, `X-Forwarded-For`를 위조해도 429. 본문 4KB 초과 413, 표에 없는 kind는 204(로그에는 개수만)
  - **켜는 것은 새 이미지가 올라간 뒤에만**(2026-10 이후 이미지). 옛 이미지에 켜면 제한이 약한 옛 엔드포인트가 열린다. 켜기·끄기 명령과 KQL은 README "프론트엔드 오류 수집"
- 로그 형식: Staging·Production 콘솔 로그는 한 줄에 JSON 하나(`{"EventId":...,"LogLevel":...,"Category":...,"Message":...,"State":{...}}`). `az containerapp logs show`나 Log Analytics의 `Log_s`가 `info: ...` 두 줄 형식이면 옛 이미지다
- 실제 사이트를 Chromium·WebKit으로 열어 CSP 위반 콘솔 메시지가 없고 플레이어가 뜨는지(mobile-verification의 shoot.mjs `--url <주소>`)

## 하지 않는 것

- 실서버 배포, 도메인 변경(비용 문의는 답만)
- 사용자 확인 없는 main 직접 push, 태그 없는 `latest` 배포
