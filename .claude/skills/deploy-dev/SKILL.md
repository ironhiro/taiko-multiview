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
   ! docker buildx build --platform linux/amd64 -t ghcr.io/ironhiro/taiko-multiview:<TAG> --push .
   ```
3. push가 끝나면 반영(이건 직접 실행 가능):
   ```bash
   az containerapp update -n taiko-multiview-dev -g rg-taiko-multiview --image ghcr.io/ironhiro/taiko-multiview:<TAG> \
     --query "{image:properties.template.containers[0].image, rev:properties.latestRevisionName}" -o json
   ```
   같은 이미지로 다시 update하면 새 리비전이 생기지 않는다(무해).

## 배포 후 확인

주소: https://taiko-multiview-dev.agreeabletree-b826eb73.koreacentral.azurecontainerapps.io

- `/api/health`: environment가 `Staging`, youTubeMode `Api`, hasApiKey `true`
- 보안 헤더: `curl -sI <주소>/`에서 content-security-policy, strict-transport-security, x-content-type-options, x-frame-options, referrer-policy가 있고 `server` 헤더가 없음
- 요청 제한: `POST /api/live/refresh` 7번째부터 429. `X-Forwarded-For`를 위조해도 429(인그레스가 붙인 마지막 IP를 쓰므로)
- `/api/diagnostics`는 404(Staging에서 꺼짐)
- 실제 사이트를 Chromium·WebKit으로 열어 CSP 위반 콘솔 메시지가 없고 플레이어가 뜨는지(mobile-verification의 shoot.mjs `--url <주소>`)

## 하지 않는 것

- 실서버 배포, 도메인 변경(비용 문의는 답만)
- 사용자 확인 없는 main 직접 push, 태그 없는 `latest` 배포
