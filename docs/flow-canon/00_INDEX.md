# TutorOS Flow Canon — 정본 반영 체크리스트

> **정본 3문서** (공통 SHA-256 `03BC551C77D062733022EB511C4AF3DDDE46379DE3386AB6624DFC076AFD8301`, 기준일 2026-08-24):
> `TutorOS_Visual_Flow_Atlas.docx`(109 플로우·133 검수) · `TutorOS_Site_Flow_Overview.docx`(18p 사이트 흐름) · `TutorOS_Integrated_Flow_Overview.pptx`(20장 회의용)
> **원칙**: FLOW-ONLY / ONE-SHOT BUILD · 문서 경계는 화면·필드·DB·API 명세 제외 · 현행 코드와 충돌 시 **정본 우선**.

## 체크 규칙

- 아틀라스·사이트·불변식 체크박스: **체크 = 해당 흐름이 코드로 실제 동작함(구현 완료)**
- 검수 시나리오 체크박스: **체크 = 테스트·QA로 실증됨**
- PPTX 체크박스: **체크 = 슬라이드의 주장·결정이 구현/합의에 반영됨**
- 갭 범례: ✅ 있음 · 🔶 부분 · ❌ 없음 · ⚠️ 충돌(정본 우선)

## 파일 구성 (체크박스 총 1,193개)

| 파일 | 내용 | 규모 |
|---|---|---|
| [01_atlas_01_intake.md](01_atlas_01_intake.md) | 유입 — 개통·상담·시범·정규등록 (O·C·T·R) | 22 플로우 · 112박스 |
| [01_atlas_02_portal_lessons.md](01_atlas_02_portal_lessons.md) | 계정·포털·수업·일정 (P·L) | 21 플로우 · 106박스 |
| [01_atlas_03_learning.md](01_atlas_03_learning.md) | 과제·시험·진도 (H·A·G) | 16 플로우 · 88박스 |
| [01_atlas_04_money_notify.md](01_atlas_04_money_notify.md) | 알림·결제·환불·잔액종료 (N·B·F·E) | 26 플로우 · 135박스 |
| [01_atlas_05_content_ops_privacy.md](01_atlas_05_content_ops_privacy.md) | 콘텐츠·운영·개인정보 (S·W·D) | 24 플로우 · 131박스 |
| [02_invariants.md](02_invariants.md) | 공통 수렴 규칙 10 · 행위자 8 · Appendix A/B/D | 113박스 |
| [03_scenarios_133.md](03_scenarios_133.md) | 검수 시나리오 1–133 (완결성 게이트) | 133박스 |
| [04_site_overview.md](04_site_overview.md) | 사이트 흐름 §1–17 (페이지·메뉴·여정 설계 기준) | 264박스 |
| [05_pptx_decisions.md](05_pptx_decisions.md) | 슬라이드 20장 합의·의사결정 | 111박스 |
| [06_gap_summary.md](06_gap_summary.md) | 도메인×상태 매트릭스 · ⚠️ 충돌 17 목록(해소 3 · 미해소 14) | 판정 결과 |
| [07_rollout_plan.md](07_rollout_plan.md) | ONE-SHOT 의존성 순서 M0–M10 · 열린 결정 5 | 계획 |

## 현재 위치 (2026-08-25 실측)

**109 플로우: ✅ 4 · 🔶 54 · ❌ 37 · ⚠️ 14** — 충돌 17 중 3 해소(P-10·P-11·N-02, 커밋 8d10e5f). 상세는 [06_gap_summary.md](06_gap_summary.md).
**구현 완료 체크 5/109 플로우**(H-01·H-02·H-03·H-07·B-02) · 체크박스 총 12/1,193(아틀라스 9 · 검수 시나리오 3: №27·36·67).
마일스톤: **M0 완료**(커밋 8d10e5f) · **M4 부분**(B 코어·검수 준비 완료 — 대사 잔여, 커밋 c690804·541ab7e) · **M5 일부**(H-01~04·06·07 구축, 커밋 4ec60e4 — A·G 잔여). 상세는 [07_rollout_plan.md](07_rollout_plan.md).
결제선생: 샌드박스 실거래 전 과정 검증(발송→파기→실 카드 승인→콜백 수납→전액 환불)·검수 5종 BILL-ID 수집 완료 — 검수 제출(메일)·운영 API Key 수령 전이라 API 주 경로 미개통(개통 전 수기 경로가 정본 경로).

## 읽는 순서

1. 전체 구조 합의: [04_site_overview.md](04_site_overview.md) → [05_pptx_decisions.md](05_pptx_decisions.md)
2. 구현 착수: [07_rollout_plan.md](07_rollout_plan.md)의 마일스톤 → 해당 도메인의 01_atlas 파일 → 예외·상태가 필요할 때 정본 아틀라스 원문 ID 조회
3. 항상 적용: [02_invariants.md](02_invariants.md) — 모든 마일스톤의 수용 조건
4. 완료 게이트: [03_scenarios_133.md](03_scenarios_133.md) 전수 통과

## 유지 규칙

- 이 디렉터리는 정본 문서의 **파생물**이다. 정본 docx/pptx가 갱신되면(SHA 변경) 체크리스트를 재생성하고 체크 상태를 이관한다.
- 플로우 ID·시나리오 번호는 정본과 1:1 — 임의 추가·삭제·병합 금지.
- 체크는 근거(커밋·테스트·file:line)와 함께 커밋 메시지에 남긴다.
