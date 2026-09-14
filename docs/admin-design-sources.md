# 관리자 디자인 출처

관리자 UI는 [Nuxt UI Dashboard](https://github.com/nuxt-ui-templates/dashboard)의 레이아웃과 시각 체계를 현재 Next.js/React 구조에 맞춰 재구성했다.

- 참조 커밋: `7f62b754af4c9e34aa7521ed44371ac95332c8cc`
- 라이선스: MIT. 원문은 [third-party/nuxt-dashboard-LICENSE](../third-party/nuxt-dashboard-LICENSE)에 보존했다.
- `app/layouts/default.vue`: 접이식 사이드바, 페이지 헤더, 메뉴 검색 구조.
- `app/assets/css/main.css`, `app/app.config.ts`: green 포인트와 zinc 중립 색상.
- `app/pages/index.vue`, `app/components/home/*`: 연결된 요약 지표, 날짜 도구 모음, 선 그래프.
- `app/pages/customers.vue`, `app/pages/settings.vue`: 목록 헤더, 행 구분선, 설정 화면의 간격과 입력 스타일.

적용 코드는 `components/admin/shell.tsx`, `components/admin/page-header.tsx`, `components/admin/theme.tsx`, `components/admin/consultation-chart.tsx`, `components/admin/crm/*`, `app/admin/admin.css`와 관리자 페이지에 있다. 스타일은 관리자 영역으로 한정한다. 그래프와 요약에는 기존 DB 데이터를 사용하며 원본 데모 수치나 고객 정보는 가져오지 않았다.

아이콘은 원본과 같은 Lucide 계열의 공식 `lucide-react` 패키지를 사용한다. 패키지의 라이선스는 해당 배포물에 포함되어 있다.
