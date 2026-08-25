# 결제선생(Payssam) API V2 연동 정의서

> 결제선생 파트너 API V2(페이민트) 연동의 환경·샌드박스 검수·운영 전환 절차 정본.
> 전송 계층은 `lib/payssam/client.ts`(응답 타입 `lib/payssam/types.ts`), 샌드박스 실측은
> `scripts/payssam-smoke.mjs`(`pnpm payssam:smoke`). 스펙 원문: developers.payssam.kr (API V2).
>
> 업무 상태(`payments.status`)와 외부 승인 스냅샷은 분리한다(flow-canon M0 분리 원칙) —
> 이 문서는 "외부(결제선생)와 무엇을, 어떤 절차로 주고받는가"만 다루고, 수납 반영·상태 전이·
> 감사는 호출부(관리자 결제 화면·콜백 라우트)의 책임이다.

## 0. 정본 매핑 (docs/flow-canon)

| 정본 ID | 이름 | 이 연동에서의 위치 |
|---------|------|--------------------|
| B-00 | 결제선생 API 운영 준비 | §3 검수 5종 BILL-ID 수집 → §5 검수 제출 → §6 운영 전환 |
| B-02 | API 청구·결제 확정 | `/bill` 발송 → 승인 콜백 수신 → **통보를 그대로 믿지 않고 `/bill/read` 대조** → 수납 반영 |
| B-03 | 수기 청구·결제 확인 | 개통 전·장애 시 유지되는 기존 경로. API가 대체하지 않는다 — 수기로 발송·완납한 청구를 API로 재발송하지 않는다(검수 39) |
| B-04 | 수기에서 API로 전환 | §6 체크리스트 — 전환 기준시점 고정, 기존 청구 수기 유지·신규만 API |

핵심 불변식(번호는 flow-canon/03_scenarios_133.md 검수 항목):

- 중복 통보는 한 결제로 수렴한다 — 멱등(36).
- 외부 결과 불명은 성공이 아니다 — 콜백·API 응답을 그대로 믿지 않고 `/bill/read`로 대조 후 수납 반영(37·128). 클라이언트가 `NETWORK`(결과 불명)를 명시 거절과 구분해 반환하는 이유다.
- 수납된 청구를 단순 파기하지 않는다 — 취소·환불 먼저(42). `/bill/destroy`는 승인 전(W)만.
- 환불 성공 후 청구·현금영수증 증빙이 같은 결과로 수렴한다(45).
- 금전 전환은 `runCritical`(category `money`) fail-closed 감사, 예외·불일치는 `createWorkItem`으로 수렴 — 모두 호출부 책임(이 연동의 전송 계층은 DB를 만지지 않는다).

## 1. 환경변수

`.env.local`(로컬)·Vercel(운영)에 등록한다. 템플릿: `scripts/env.template`. 코드에서는
`process.env`로만 접근하며 키 하드코딩은 금지.

| 변수 | 필수 | 값 | 비고 |
|------|------|-----|------|
| `PAYSSAM_API_KEY` | ✅ | 파트너 고유키(최대 32자) | **샌드박스 키와 운영 키가 다르다** — 검수 완료 후 운영 키 별도 수령 |
| `PAYSSAM_MEMBER_ID` | ✅ | 파트너 사용자 코드 | 요청 봉투의 `member` |
| `PAYSSAM_MERCHANT_ID` | ✅ | 파트너 매장 코드 | 요청 봉투의 `merchant` |
| `PAYSSAM_BASE_URL` | ✅ | 샌드박스 `https://sandbox.paymint.co.kr/partner` | 운영 URL은 검수 완료 후 별도 제공. **코드에 기본값을 두지 않는다** — 기본값이 샌드박스/운영을 뒤바꾸는 사고 방지 |
| `PAYSSAM_CALLBACK_URL` | 옵션 | 승인 콜백 수신 URL | 비우면 `NEXT_PUBLIC_SITE_URL + /api/payssam/callback`. 공개 URL이어야 한다(§4) |

필수 4종이 **전부** 있어야 `isPayssamConfigured()`가 참 — 일부만 채우면 게이트가 닫혀 호출
자체를 하지 않는다(발송 시도가 전부 실패로 쌓이는 것보다 안 켜지는 편이 낫다).

방화벽을 직접 운영한다면 페이민트 IP(52.78.118.82 · 52.78.236.125 · 52.79.214.146 ·
3.36.243.225 · 3.39.97.44 · 13.209.0.172 · 13.209.248.179)를 허용하고, TLS 1.2 이상을 쓴다
(스펙 preparation/environment).

## 2. 통신 규약 요약

- 전 엔드포인트 POST JSON. 봉투는 `{apiKey, member, merchant, bill:{...}}` — 현금영수증 계열만
  키가 `cashReceipt:{...}`, 포인트 조회(`/read/remain_count`)는 `{apiKey}`만.
- 응답은 `{code, message, data}` — **HTTP 200이어도 `code !== "0000"`이면 거절**이다. code를
  읽을 수 없는 응답(HTML 에러 페이지·타임아웃)은 거절 확정이 아니라 결과 불명 → `/bill/read` 대조.
- `hash`: SHA-256 hex — phone이 있으면 `"{billId},{phone},{price}"`, 없으면 `"{billId},{price}"`.
  여기서 "phone이 있으면"은 **그 요청 자체에 phone 필드가 있는 경우**다: `/bill` 발송은 phone
  필수라 항상 3요소 hash, **파기·취소·현금영수증 요청에는 phone 필드가 없으므로
  `"{billId},{price}"`로 해시한다.** 샌드박스 실측(2026-08-24): `/bill/destroy`에 발송 때의
  phone을 포함한 hash는 `VALIDATION_002`("해싱값을 확인하시기 바랍니다")로 거절되고 phone 없는
  hash가 `0000` 성공.
- `billId`: 파트너가 생성, 최대 20자, 중복 불가(`generateBillId()`).
- `apprState`: `F` 승인 / `W` 미결제 / `C` 취소 / `D` 파기. `/bill/destroy`는 승인 전(W)만,
  `/bill/cancel`은 결제 완료 건 전액 취소(`cancelReason` 첨부).
- 승인 동기화 콜백은 `apprState=F`(승인)만 온다. 수신 서버는 `{"code":"0000"}`으로 응답한다.

## 3. 샌드박스 검수 — BILL-ID 5종 수집 절차

연동 검수는 샌드박스에서 실거래 5종을 만들어 그 BILL-ID를 페이민트에 제출하는 방식이다.
`scripts/payssam-smoke.mjs`가 이 5종을 만드는 도구다.

> **검수 실무 메모** (페이민트 온보딩 안내, 2026-08-25 수신)
> - 검수 기간: 메일 발송 후 **운영일 기준 1~2일** (업무시간 월~목 09:30~18:30 · 금 09:30~13:30)
> - 샌드박스 테스트 결제는 **현대·국민·신한카드만** 가능 — 「결제승인」 BILL-ID를 만들 때 이 세 카드사 중 하나로 결제할 것
> - 샌드박스 테스트 결제는 **자동 취소된다** — 「승인취소」 BILL-ID는 자동 취소를 기다리지 말고 결제 직후 `pnpm payssam:smoke cancel <BILL-ID>`로 **우리가 직접 취소한 건**으로 제출(자동 취소는 우리 API 호출 이력이 아니라 검수 로그에 남지 않을 수 있음)
> - 문의: 기술 partner_dev@paymint.co.kr · 정책/계약 partner@paymint.co.kr

```bash
# 0) 잔액 확인 (쌤포인트 부족이면 발송이 거절된다)
pnpm payssam:smoke point

# 1) 테스트 청구서 발송 — URL 타입(카카오톡 미발송), 1,000원. BILL-ID·shortUrl이 출력된다
pnpm payssam:smoke send --phone 010xxxxxxxx

# 2) 청구서 조회 — 검수 항목 「청구서 조회」
pnpm payssam:smoke read <BILL-ID>
```

| 검수 항목 | 만드는 방법 |
|-----------|-------------|
| 결제승인 | `send`로 발송 → 출력된 **shortUrl을 브라우저에서 열어 테스트 결제** → `read`로 `apprState=F` 확인 |
| 승인취소 | 결제승인(F)까지 간 건에 `pnpm payssam:smoke cancel <BILL-ID> --reason "연동 테스트"` |
| 청구서 파기 | `send`만 하고 결제하지 않은(W) 건에 `pnpm payssam:smoke destroy <BILL-ID>` |
| 청구서 조회 | 아무 건이나 `pnpm payssam:smoke read <BILL-ID>` |
| 승인 동기화 | 결제승인 건의 콜백에 서버가 `{"code":"0000"}` 응답 — 페이민트 쪽에서 "0000" 수신을 확인하면 완료(§4) |

주의:

- 승인취소·청구서 파기는 **서로 다른 청구서**가 필요하다(취소는 F 건만, 파기는 W 건만).
  `send`를 여러 번 실행해 각각 만든다.
- `destroy`/`cancel`/`receipt`의 hash는 `"{billId},{price}"`다(§2 — 요청에 phone 필드가 없는
  계열은 phone을 hash에 넣지 않는다. 넣으면 `VALIDATION_002` 거절, 샌드박스 실측).
- 현금영수증(`receipt`)·잔액(`point`)은 검수 5종에는 없지만 B-07(증빙)·운영 준비 확인용으로
  같은 스크립트에서 실행할 수 있다: `pnpm payssam:smoke receipt <BILL-ID> --trader 0 --number <휴대폰>`
- 스크립트의 hash·봉투 규칙은 `lib/payssam/client.ts`와 동일해야 한다(스크립트는 Next 밖 단독
  실행이라 자체 구현 — client.ts 변경 시 함께 갱신). client.ts의 `destroyBill`/`cancelBill`/
  현금영수증 계열은 실측 규칙대로 2필드 hash를 사용한다(2026-08-25 수정 완료 — phone 파라미터 제거).
- 현금영수증 `issue`의 `supplyPrice`·`tax`는 스펙 표기상 필수이나 설명문은 "생략 시 사업장
  면·과세 정책"이라 모순 — 승인(F) 건 확보 후 생략 발급 1회로 실측 확정 필요(거절 시
  면세 기준 supplyPrice=price·tax=0 명시 전송으로 전환).

## 4. 콜백 URL 요건

- 승인 동기화 콜백은 **결제선생 서버가 우리 서버를 호출**한다 — `callbackUrl`은 공개 URL이어야
  하며 `localhost`·사설망 주소는 받을 수 없다.
- 수신 경로는 `/api/payssam/callback`(기본). 콜백을 받으면 그대로 수납 반영하지 않고
  `/bill/read`로 대조 후 반영한다(검수 37·128 — B-02의 "결제 통보 검증").
- **로컬 개발에서는 콜백이 도달하지 않는다.** 이때는 관리자 결제 화면의 **"동기화" 버튼**이
  대체 경로다 — 버튼이 `/bill/read`를 호출해 외부 승인 상태를 당겨와 같은 검증·수납 반영
  경로를 태운다(콜백은 push, 동기화 버튼은 pull일 뿐 반영 로직은 동일).
- 검수 항목 「승인 동기화」는 콜백 "0000" 응답을 페이민트가 확인해야 하므로, 검수 시점에는
  배포된 공개 URL(운영 도메인 또는 프리뷰 배포)로 `PAYSSAM_CALLBACK_URL`을 잡고 진행한다.

## 5. 검수 제출

수집한 BILL-ID 5종을 결제선생 기술지원팀 **<partner_dev@paymint.co.kr>** 로 회신한다.

```
결제승인    : <BILL-ID>
승인취소    : <BILL-ID>
청구서 파기 : <BILL-ID>
청구서 조회 : <BILL-ID>
승인 동기화 : (결제승인 건에 대해 페이민트 쪽에서 "0000" 응답 수신 확인되면 검수 완료)
```

검수 완료 확인 후 페이민트가 운영 정보(운영 API Key·운영 발송 URL)를 제공한다.

## 6. 검수 통과 후 운영 전환 체크리스트 (B-00 · B-04)

- [ ] **운영 정보 교체** — `PAYSSAM_API_KEY`를 운영 키로, `PAYSSAM_BASE_URL`을 운영 발송 URL로
  교체(Vercel 환경변수). 샌드박스 값이 운영에 남아 있으면 안 된다 — 4종 게이트가 있으므로
  절반만 바꾸면 연동이 아예 꺼진다(그편이 안전).
- [ ] **콜백 URL 확정** — `PAYSSAM_CALLBACK_URL`(또는 `NEXT_PUBLIC_SITE_URL`)이 운영 도메인을
  가리키는지 확인.
- [ ] **전환 기준시점 고정(B-04)** — 기준 전에 만든 **기존 청구는 수기 흐름으로 끝까지 정산**하고,
  기준 후 **신규 청구만 API로 발송**한다. 같은 청구를 두 경로로 보내지 않는다(이중 발송 금지,
  검수 39).
- [ ] **비용·잔액 운영** — API 청구서 발송 1건 55P(공식 안내 기준, flow-canon 04 §11).
  쌤포인트 소진 시 발송이 거절되므로 **자동충전 설정을 권장**하고, 잔액이 **5,500P(100건분)
  이하**로 내려가면 충전 경고로 본다. 잔액은 `pnpm payssam:smoke point` 또는 응답의
  `chargeUrl`로 확인·충전.
- [ ] **전환 초기 대사** — 일정 기간 전체 승인·취소·환불을 `/bill/read`로 대조해 누락 없음을
  확인한 뒤 API 주 경로를 유지한다. 결과 불명·불일치는 `work_items`로 수렴시킨다.
- [ ] **수기 복구 경로 유지** — API 장애·부분환불 등 미지원 업무는 수기 경로로 처리하고 원
  경로를 기록한다(B-03·B-04 예외 분기).
