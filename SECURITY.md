# 보안 정책

## 취약점 제보

보안 취약점은 공개 이슈로 올리지 말고 GitHub의 비공개 제보 기능으로 알려 주세요.

- 저장소 **Security** 탭 → **Report a vulnerability**

재현 방법, 영향 범위, 확인한 배포 주소(개발 서버/실서버)를 함께 적어 주시면 빠르게 확인할 수 있습니다.
공개적으로 알리기 전에 조치할 시간을 주시면 감사하겠습니다.

## 범위

- 백엔드 API (`backend/TaikoLabs.Api`)와 그 이미지에 들어 있는 프론트엔드
- 데스크톱 셸 (`desktop/shell`)

YouTube, Azure 등 외부 서비스 자체의 취약점은 각 서비스에 제보해 주세요.

## 공개 API에 대해

`GET /api/venues`, `GET /api/live`는 공개 대시보드용 데이터이므로 인증 없이 열려 있습니다.
`POST /api/live/refresh`는 매장별 쿨다운과 IP당 요청 제한이 걸려 있으며,
`POST /api/diagnostics`는 개발 환경에서만 등록됩니다.
