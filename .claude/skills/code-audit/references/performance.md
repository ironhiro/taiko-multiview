# 성능 점검표

이 앱의 비용은 대부분 **유튜브 플레이어**(디코딩, 네트워크, 메모리)와 **YouTube API 쿼터**에서 나온다. 코드를 읽어 병목을 찾고, 측정이 필요하면 perf-check 스킬(`npm run perf`)의 결과를 근거로 인용한다. `_workspace/02_perf_baseline.md`, `_workspace/04_perf_report.md`, `frontend/perf/results/*.json`이 있으면 먼저 읽는다.

## 플레이어 수명 (frontend/src/components/PlayerTile.tsx, lib/playerBudget.ts, lib/playbackSlots.ts)
- 만들고 부수기(churn): 스크롤·가시성 변화마다 플레이어를 새로 만드는 경로가 있나. 예산·슬롯 규칙을 우회하는 경로(매장 전환, 창 폭 변화로 폰 규칙 진입, 스트림 id 변경).
- 멈춘 플레이어가 계속 받거나 디코딩하나(일시정지 누락, 감시 타이머가 재생을 재개).
- 타이머·옵저버·이벤트 리스너 정리 누락(언마운트, 의존성 변경 시). 모듈 전역 상태에 남는 참조.
- 데스크톱 9~16개 동시 재생 시 불필요한 작업(모든 타일의 5초 감시 타이머, 레이아웃 재계산).

## React 렌더링
- `App.tsx`의 상태 변경이 전체 그리드를 다시 그리나. `streamsByStation` 같은 파생 값의 메모이제이션, 콜백 안정성(`onRequestAudio={() => ...}` 인라인 함수가 매 렌더 새로 생김 → 자식 효과 재실행 여부).
- 폴링 응답이 같아도 새 객체로 교체되어 렌더를 유발하나.
- 레이아웃 스래싱: 스크롤·리사이즈 핸들러에서 `getBoundingClientRect` 반복(GridView의 글라이드 애니메이션).

## 네트워크
- 폴링 주기와 숨김 탭 처리, 수동 새로고침.
- 썸네일 이미지 크기(maxresdefault vs hqdefault), lazy 로딩.
- 번들 크기: 폰트 서브셋(Pretendard·Black Han Sans 수백 개 파일), CSS 354KB — 첫 로드 비용.

## 서버
- 폴링 루프: 매장 수 × 주기, 영업 외 시간 감속, 수동 새로고침 쿨다운. 쿼터 계산이 맞나.
- 공개 페이지 스크래핑(`PublicLiveProbe`)의 동시성·타임아웃.
- 캐시(`ChannelAvatarCache`, `EndedBroadcastCache`)의 크기 제한·만료.
- `/api/live` 응답 생성 비용(매 요청 투영), 직렬화 크기.

## 보고 시 주의
- "느릴 수 있다"가 아니라 규모를 쓴다: 몇 개 타일, 몇 초 주기, 몇 MB.
- 측정 없이 판단한 것은 확신도를 "가능성 높음" 이하로.
