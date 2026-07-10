# AXIOM MATH LAB 배포 에셋 (v4 · deploy)

전체 13.4MB → WebP 기준 0.5MB (96% 절감) · 원본 41 + WebP 22 = 63파일 · 2026-07-04

## 파일 목록

| 파일명 | 크기 | 원본 | WebP | 용도 |
|---|---|---|---|---|
| logo-footer-white.png | 428x38 | 3KB | — | 푸터 로고 (화이트) |
| logo-header-blue.png | 186x36 | 2KB | — | 헤더 로고 (블루 AXIOM) |
| symbol-white.png | 48x43 | 1KB | — | 심볼 단독 (화이트) |
| icon-class-offline-lg.png | 516x410 | 3KB | — | 대면 수업 아이콘 (대형) |
| icon-class-offline.png | 180x180 | 4KB | — | 대면 수업 아이콘 |
| icon-class-online.png | 180x180 | 3KB | — | 화상 수업 아이콘 |
| icon-consult.png | 44x44 | 0KB | — | 플로팅 상담 신청 클립보드 |
| icon-flow-01-diagnosis.png | 154x154 | 1KB | — | 수업 흐름 01 진단 |
| icon-flow-02-correction.png | 154x154 | 1KB | — | 수업 흐름 02 교정 |
| icon-flow-03-practice.png | 154x154 | 1KB | — | 수업 흐름 03 실전 |
| field-naesin.png | 210x239 | 3KB | — | 분야 그래픽 내신 (구 내신.png) |
| field-nonsul.png | 230x230 | 2KB | — | 분야 그래픽 수리논술 (구 수리논술.png) |
| field-suneung.png | 214x220 | 4KB | — | 분야 그래픽 수능 (구 수능 수학.png) |
| field-yaksul.png | 215x215 | 1KB | — | 분야 그래픽 약술형 (구 약술형 논술.png) |
| card-field-01-naesin.png | 328x280 | 1KB | — | 분야 카드 배경 1 |
| card-field-02-suneung.png | 328x280 | 1KB | — | 분야 카드 배경 2 |
| card-field-03-nonsul.png | 328x280 | 1KB | — | 분야 카드 배경 3 |
| card-field-04-yaksul.png | 328x280 | 1KB | — | 분야 카드 배경 4 |
| img-core-01-diagnosis.png | 896x800 | 418KB | 56KB | 수업 핵심 진단 |
| img-core-02-correction.png | 896x800 | 199KB | 68KB | 수업 핵심 교정 |
| img-core-03-practice.png | 896x800 | 474KB | 81KB | 수업 핵심 실전 |
| img-tuition-wave.png | 661x444 | 375KB | 66KB | 정규수업료 3D 웨이브 |
| bg-class-classform.png | 1920x880 | 2382KB | 21KB | 신청폼 배경 ※LCP-preload |
| bg-class-format.jpg | 1920x1050 | 361KB | 24KB | 진행 형태 |
| bg-class-hero.png | 1920x640 | 650KB | 7KB | 수업안내 히어로 ※LCP-preload |
| bg-class-pay.png | 1920x540 | 829KB | 6KB | 결제 방식 |
| bg-class-trial.jpg | 1920x750 | 103KB | 7KB | 시범수업 |
| bg-consult-hero.png | 1920x840 | 144KB | 4KB | 상담안내 히어로 ※LCP-preload |
| bg-consult-notice.png | 1920x280 | 181KB | 9KB | 하단 안내 바 |
| bg-consult-process.png | 1920x760 | 196KB | 6KB | 상담 진행 절차 |
| bg-footer.png | 1920x410 | 6KB | — | 푸터 배경 |
| bg-main-brand-2x.jpg | 3840x900 | 1224KB | 31KB | AXIOM⊢RESULT (3840 @2x) |
| bg-main-cta.png | 1920x950 | 797KB | 11KB | 메인 하단 CTA |
| bg-main-hero.png | 1920x950 | 672KB | 22KB | 메인 히어로 ※LCP-preload |
| bg-main-method.png | 1920x850 | 740KB | 6KB | 메인 수업 방식 블루 배너 |
| bg-main-student.png | 960x800 | 408KB | 13KB | 어떤 학생 (좌) |
| bg-main-tuition.jpg | 960x800 | 21KB | 1KB | 수업료 안내 (우) |
| bg-tutor-consult.png | 1920x640 | 477KB | 8KB | 튜터 하단 상담 CTA |
| bg-tutor-dark-abstract.png | 1920x900 | 910KB | 10KB | 튜터 다크 배경 |
| bg-tutor-field.png | 1920x980 | 1347KB | 26KB | 지도 분야 네이비 |
| bg-tutor-profile.jpg | 1920x1360 | 743KB | 12KB | 튜터 프로필 ※LCP-preload |

## 사용 규칙

1. **WebP가 있는 파일은 WebP를 기본으로, 원본은 폴백으로** 사용합니다. WebP가 없는 소형 에셋(로고·아이콘·카드·field)은 PNG를 그대로 씁니다.
2. **각 페이지 히어로 배경은 lazy 금지 + preload** — LCP 요소입니다. ※LCP-preload 표시 참고.
3. `bg-main-brand-2x`는 @2x 소스이므로 CSS 표시 폭은 1920 기준으로 지정합니다.

## CSS 배경 (image-set 폴백)

```css
/* 패턴: 1행 폴백 + 2행 image-set. 아래 목록의 클래스명은 예시 — 실제 셀렉터로 교체 */
.class_classform {
  background-image: url('/img/bg-class-classform.png');
  background-image: image-set(url('/img/bg-class-classform.webp') type('image/webp'), url('/img/bg-class-classform.png') type('image/png'));
}
.class_format {
  background-image: url('/img/bg-class-format.jpg');
  background-image: image-set(url('/img/bg-class-format.webp') type('image/webp'), url('/img/bg-class-format.jpg') type('image/jpeg'));
}
.class_hero {
  background-image: url('/img/bg-class-hero.png');
  background-image: image-set(url('/img/bg-class-hero.webp') type('image/webp'), url('/img/bg-class-hero.png') type('image/png'));
}
.class_pay {
  background-image: url('/img/bg-class-pay.png');
  background-image: image-set(url('/img/bg-class-pay.webp') type('image/webp'), url('/img/bg-class-pay.png') type('image/png'));
}
.class_trial {
  background-image: url('/img/bg-class-trial.jpg');
  background-image: image-set(url('/img/bg-class-trial.webp') type('image/webp'), url('/img/bg-class-trial.jpg') type('image/jpeg'));
}
.consult_hero {
  background-image: url('/img/bg-consult-hero.png');
  background-image: image-set(url('/img/bg-consult-hero.webp') type('image/webp'), url('/img/bg-consult-hero.png') type('image/png'));
}
.consult_notice {
  background-image: url('/img/bg-consult-notice.png');
  background-image: image-set(url('/img/bg-consult-notice.webp') type('image/webp'), url('/img/bg-consult-notice.png') type('image/png'));
}
.consult_process {
  background-image: url('/img/bg-consult-process.png');
  background-image: image-set(url('/img/bg-consult-process.webp') type('image/webp'), url('/img/bg-consult-process.png') type('image/png'));
}
.main_brand_2x {
  background-image: url('/img/bg-main-brand-2x.jpg');
  background-image: image-set(url('/img/bg-main-brand-2x.webp') type('image/webp'), url('/img/bg-main-brand-2x.jpg') type('image/jpeg'));
}
.main_cta {
  background-image: url('/img/bg-main-cta.png');
  background-image: image-set(url('/img/bg-main-cta.webp') type('image/webp'), url('/img/bg-main-cta.png') type('image/png'));
}
.main_hero {
  background-image: url('/img/bg-main-hero.png');
  background-image: image-set(url('/img/bg-main-hero.webp') type('image/webp'), url('/img/bg-main-hero.png') type('image/png'));
}
.main_method {
  background-image: url('/img/bg-main-method.png');
  background-image: image-set(url('/img/bg-main-method.webp') type('image/webp'), url('/img/bg-main-method.png') type('image/png'));
}
.main_student {
  background-image: url('/img/bg-main-student.png');
  background-image: image-set(url('/img/bg-main-student.webp') type('image/webp'), url('/img/bg-main-student.png') type('image/png'));
}
.main_tuition {
  background-image: url('/img/bg-main-tuition.jpg');
  background-image: image-set(url('/img/bg-main-tuition.webp') type('image/webp'), url('/img/bg-main-tuition.jpg') type('image/jpeg'));
}
.tutor_consult {
  background-image: url('/img/bg-tutor-consult.png');
  background-image: image-set(url('/img/bg-tutor-consult.webp') type('image/webp'), url('/img/bg-tutor-consult.png') type('image/png'));
}
.tutor_dark_abstract {
  background-image: url('/img/bg-tutor-dark-abstract.png');
  background-image: image-set(url('/img/bg-tutor-dark-abstract.webp') type('image/webp'), url('/img/bg-tutor-dark-abstract.png') type('image/png'));
}
.tutor_field {
  background-image: url('/img/bg-tutor-field.png');
  background-image: image-set(url('/img/bg-tutor-field.webp') type('image/webp'), url('/img/bg-tutor-field.png') type('image/png'));
}
.tutor_profile {
  background-image: url('/img/bg-tutor-profile.jpg');
  background-image: image-set(url('/img/bg-tutor-profile.webp') type('image/webp'), url('/img/bg-tutor-profile.jpg') type('image/jpeg'));
}
```

## 콘텐츠 이미지 (picture 폴백)

```html
<picture>
  <source srcset="/img/img-core-01-diagnosis.webp" type="image/webp">
  <img src="/img/img-core-01-diagnosis.png" alt="현재 상태 진단" width="896" height="800" loading="lazy" decoding="async">
</picture>
<picture>
  <source srcset="/img/img-core-02-correction.webp" type="image/webp">
  <img src="/img/img-core-02-correction.png" alt="약점 교정" width="896" height="800" loading="lazy" decoding="async">
</picture>
<picture>
  <source srcset="/img/img-core-03-practice.webp" type="image/webp">
  <img src="/img/img-core-03-practice.png" alt="실전 적용" width="896" height="800" loading="lazy" decoding="async">
</picture>
<picture>
  <source srcset="/img/img-tuition-wave.webp" type="image/webp">
  <img src="/img/img-tuition-wave.png" alt="" role="presentation" width="661" height="444" loading="lazy" decoding="async">
</picture>
```

## 히어로 preload (페이지별 <head>)

```html
<!-- 메인 -->
<link rel="preload" as="image" href="/img/bg-main-hero.webp" type="image/webp">
<!-- 상담안내 -->
<link rel="preload" as="image" href="/img/bg-consult-hero.webp" type="image/webp">
<!-- 수업안내 -->
<link rel="preload" as="image" href="/img/bg-class-hero.webp" type="image/webp">
<!-- 신청폼 -->
<link rel="preload" as="image" href="/img/bg-class-classform.webp" type="image/webp">
<!-- 튜터소개 -->
<link rel="preload" as="image" href="/img/bg-tutor-profile.webp" type="image/webp">
```

## 원본 대비 리네임 (한글 → 영문)

- `내신.png` → `field-naesin.png` / `수능 수학.png` → `field-suneung.png` / `수리논술.png` → `field-nonsul.png` / `약술형 논술.png` → `field-yaksul.png`

## 남은 권장 작업

- 로고 2종·심볼은 PNG 1x → 피그마 SVG 재추출 (레티나 대응)
- Apache(.htaccess)에 `AddType image/webp .webp` 확인 및 webp 캐시 헤더 적용