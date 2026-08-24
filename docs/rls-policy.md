# RLS 정책 문서 — 멀티테넌트 격리

> 계약 제14장 인수 항목: **"테스트 테넌트 2~3개 시딩, 교차 접근 0건 + RLS 정책 문서"**
> 검증 실행: `pnpm verify:rls` (종료 코드 0 = 통과)
> 최종 검증: 2026-08-24 · **64개 검사 전부 PASS · 교차 노출 0건** (00013 M0 반영 — 검사 45→64종)

---

## 1. 역할별 접근 범위

| 역할 | RLS | 접근 범위 | 실제 사용처 |
|------|-----|-----------|-------------|
| `service_role` | **우회(BYPASSRLS)** | 전 테넌트 전 행 | **앱 서버 전체** (`lib/supabase/server.ts`) |
| `authenticated` | 적용 | JWT `tenant_id` 클레임과 일치하는 행만 | 현재 미사용 (Phase 2 대비) |
| `anon` | 적용 (정책 없음) | **전면 차단** | 미사용 — 공개 사이트는 서버 렌더 경유 |

## 2. ⚠️ 가장 중요한 사실: RLS는 앱 경로를 지키지 않는다

앱 서버는 `service_role` 키로 Supabase에 접속한다. 이 역할은 **BYPASSRLS 속성을 가지므로 RLS 정책이 전혀 평가되지 않는다.**

즉 **실질적인 테넌트 방어선은 RLS가 아니라 앱 레이어의 `tenant_id` 스코프**다. 모든 쿼리가 스스로 `.eq("tenant_id", session.tenantId)`를 걸어야 하며, 하나라도 빠뜨리면 RLS는 그것을 막아주지 못한다.

RLS가 실제로 방어하는 것은 다음 두 가지다.

1. **키 유출 시 피해 축소** — `anon` 키가 노출되어도 어떤 행도 읽히지 않는다 (정책 없음 = 전면 차단).
2. **Phase 2 대비** — 학부모/학생이 `authenticated`로 직접 접속하게 되면 그때부터 RLS가 1차 방어선이 된다.

따라서 `verify-rls.sh`의 64/64 PASS는 **"RLS 정책이 올바르다"는 증명이지, "앱이 안전하다"는 증명이 아니다.** 앱 레이어 스코프는 별도로 감사해야 한다 (§5).

## 3. 정책 정의

`supabase/migrations/00001_init.sql` 하단에서 시작하며, 이후 테이블을 추가한 마이그레이션(00006·00007·00012·00013)이 같은 방침을 이어받는다. 현재 **26개 public 테이블 전부 RLS 활성** — 테넌트 격리 정책 21개(§3-1) + `tenants` 자기조회(§3-2) + 정책 없는 service_role 전용 4개(§3-3).

### 3-1. 계정별 21개 테이블 — 테넌트 격리

```sql
create policy tenant_isolation on public.<table>
  for all to authenticated
  using (tenant_id = public.jwt_tenant_id())
  with check (tenant_id = public.jwt_tenant_id());
```

대상: `site_settings` `theme_settings` `ddays` `recruit_status` `page_contents` `students` `reviews` `faqs` `lessons` `ai_reports` `schedules` `grade_records` `lesson_materials` `payments` `consultations` `consents` `notifications` `backups` — 여기까지 00001의 18개 — 그리고 같은 정책 계열인 `activity_log`(00006) `adjustments` `work_items`(00013)

- `using` — 읽기/수정/삭제 대상 행을 자기 테넌트로 한정
- `with check` — 쓰기 시 타테넌트 `tenant_id`를 넣지 못하게 차단 (행 탈취 방지)

### 3-2. `tenants` — 본인 행만 조회

```sql
create policy tenant_self_read on public.tenants
  for select to authenticated
  using (id = public.jwt_tenant_id());
```

INSERT/UPDATE/DELETE 정책 없음 = `service_role`만 가능.

### 3-3. 정책 없음 = service_role 전용 — `admin_otps` `admin_accounts` `automation_runs` `admin_sessions`

RLS를 켜되 정책을 부여하지 않으면 `authenticated`·`anon` 모두 전면 차단되고 `service_role`(앱 서버)만 접근한다. 인증 **이전** 단계라 `authenticated` 컨텍스트가 애초에 존재하지 않거나, 앱 사용자가 볼 이유가 없는 플랫폼 내부 테이블이 이 계열이다.

| 테이블 | 도입 | 사유 |
|--------|------|------|
| `admin_otps` | 00001 | OTP 검증은 로그인 이전 단계 |
| `admin_accounts` | 00007 (RLS는 00010) | 로그인 자격 판정도 로그인 이전 단계 |
| `automation_runs` | 00012 | 크론 발사 기록 — 앱 사용자 접근 불필요 |
| `admin_sessions` | 00013 | 세션 토큰 해시의 저장·검증 — 인증 그 자체의 재료 |

`admin_otps`의 PK는 **`(tenant_id, email)` 복합키**다. `email` 단독 PK로 두면 한 사람이 같은 이메일로 두 테넌트를 운영할 때 OTP가 서로를 덮어쓰고(upsert), 60초 재발송 제한과 5회 시도 카운터가 테넌트 간에 공유된다.

`admin_sessions`는 원문 토큰을 저장하지 않는다 — `token_hash`(HMAC, unique)만 저장하고, 회수는 행 삭제가 아니라 `revoked_at` 갱신으로 한다(이력 보존).

### 3-4. 자동화 함수 — PUBLIC 실행 권한 회수

`automation_call_edge_function`·`automation_call_flush`는 `security definer`로 Vault 시크릿(service_role 키, `CRON_SECRET`)을 읽고 HTTP 호출을 한다. Postgres 기본값은 **`EXECUTE TO PUBLIC`**이므로, 회수하지 않으면 PostgREST가 노출하는 RPC(`POST /rest/v1/rpc/<name>`)로 `anon`·`authenticated`가 직접 호출할 수 있다 — 오프스케줄 대량 발송·AI 토큰 비용 유발이 가능하다.

`00002_automation.sql` 말미에서 자동화 함수 5종의 EXECUTE를 PUBLIC에서 회수한다. 크론 잡은 소유자 권한으로 실행되므로 영향받지 않는다.

**REVOKE가 실효 있음을 뮤테이션으로 확인했다**: REVOKE 5줄을 제거하고 검증을 돌리면 5개 함수 전부 `authenticated`가 실행 가능(`실행 가능(위반)` FAIL)으로 나온다.

> 현재 브라우저에서 Supabase를 직접 호출하지 않아(`createBrowserClient` 미사용) anon 키가 노출되지 않으므로 즉시 악용 가능성은 낮다. 다만 Phase 2에서 학부모/학생이 `authenticated`로 접속하면 실현되므로 미리 닫아 둔다.

00013은 여기에 `admin_replace_operator`를 더한다 — `security definer`로 운영자 지위 이전·세션 회수·OTP 폐기를 수행하므로, RPC로 노출되면 키 하나로 운영자 탈취가 가능한 경로다. 00013 말미에서 이 함수와 재정의된 `automation_schedule_autoclean`, 트리거 함수 2종(`activity_log_append_only`·`append_only_reject`)의 EXECUTE를 PUBLIC·anon·authenticated에서 회수한다(`create or replace`는 proacl을 초기화해 PUBLIC EXECUTE가 되살아나므로, 함수를 재정의할 때마다 재회수가 필수). 이로써 함수 실행 차단 검사는 6종이다.

### 3-5. `jwt_tenant_id()` — fail-closed

```sql
create or replace function public.jwt_tenant_id()
returns uuid language sql stable as $$
  select case
    when coalesce(auth.jwt() ->> 'tenant_id', '')
      ~* '^[0-9a-f]{8}-...-[0-9a-f]{12}$'
    then (auth.jwt() ->> 'tenant_id')::uuid
  end
$$;
```

클레임이 없거나 UUID 형식이 아니면 `NULL`을 반환한다. `tenant_id = NULL`은 항상 거짓이므로 **전 행이 차단**된다. 정규식 없이 바로 `::uuid` 캐스팅하면 오염된 클레임이 cast 에러를 일으켜 요청이 500으로 죽는다 — 그래서 형식 검사를 먼저 한다.

### 3-6. RLS 밖의 DB 불변식 — append-only 트리거·부분 유니크 (00013)

RLS는 "누가 어느 행을 보는가"만 다룬다. 00013은 "어떤 전환만 허용되는가"를 트리거와 부분 유니크로 DB에 박았고, 하네스가 함께 검증한다. **트리거는 `service_role`(BYPASSRLS)에도 적용된다** — RLS가 아닌 무결성 규칙이라 우회 경로가 없다. 하네스도 owner(RLS 우회 동급) 시점으로 실행해 이를 증명한다.

| 대상 | 규칙 | 하네스 검사 |
|------|------|-------------|
| `activity_log` | UPDATE는 phase `pending`→`committed`·`aborted` 확정(+`reason` 기재)만 허용, 그 외 컬럼 변경·DELETE 전면 거부 | 감사 append-only 4종 |
| `adjustments` | UPDATE·DELETE 전면 거부 — 정정·취소·철회는 새 이력 행으로만 | 감사 append-only 2종 |
| `admin_accounts` | 부분 유니크 `admin_accounts_one_active_per_tenant` — 테넌트당 `status='active'` 1행만 | 단일 활성 운영자 1종 + 원자적 승계(`admin_replace_operator`) 4종 |
| `work_items` | 부분 유니크 `work_items_open_dedup` — 같은 사건(kind·source)의 열린 업무는 1건, 완결 후 재발 시 재생성 허용 | 오늘 업무 dedup 2종 |

## 4. 검증 방법과 결과

`scripts/verify-rls.sh`가 로컬 Postgres에 스키마를 처음부터 적용하고 검증한다.

| 단계 | 내용 |
|------|------|
| 1 | 테스트 DB 재생성 |
| 2 | Supabase 런타임 shim (`auth.jwt()`, 3개 역할) — `supabase/tests/rls/00_shim.sql` |
| 3 | 마이그레이션 전체(00001~00013) + 권한 + `seed.sql` (테넌트 3개) |
| 4 | **타테넌트 픽스처** — 계정별 21개 테이블 전부에 T2 소유 행을 심는다 |
| 5 | 교차 접근 검증 64종 |

**4단계가 핵심이다.** 타테넌트 행이 없으면 "0건 노출"은 RLS 덕분인지 데이터가 없어서인지 구별되지 않는다. 하네스는 각 테이블마다 owner 시점(RLS 우회)의 실제 행 수를 먼저 세고, **행이 존재할 때만 PASS로 인정**한다. 없으면 `INCONCLUSIVE`로 남긴다.

### 검사 항목 (64종)

| 시나리오 | 건수 | 내용 |
|----------|------|------|
| baseline | 3 | 타테넌트 행이 실제로 존재함을 먼저 확인 |
| 교차노출 스캔 | 21 | 계정별 전 테이블에서 타테넌트 행 노출 0건 (00013로 `activity_log`·`adjustments`·`work_items` 추가) |
| 자기 테넌트 조회 | 1 | 과잉 차단이 아님 (자기 데이터는 보여야) |
| 테넌트 전환 | 2 | T2 클레임 → T2 데이터만 |
| 쓰기 차단 | 6 | 타테넌트로 INSERT/UPDATE/DELETE, `tenant_id` 탈취, UPSERT(`on conflict do update`), `UPDATE … RETURNING` 유출 |
| fail-closed | 2 | 클레임 누락 / 오염된 클레임 |
| anon 차단 | 3 | anon은 전 테이블 0건 |
| tenants 격리 | 2 | 본인 테넌트 행만 |
| OTP 보호 | 2 | authenticated 차단 + `tenant_id` 컬럼 존재 |
| 세션 보호 | 2 | `admin_sessions`를 authenticated·anon 모두 0건 (정책 없음 차단, 00013) |
| 함수 실행 차단 | 6 | authenticated가 `automation_*` 5종 + `admin_replace_operator`를 RPC로 실행 불가 |
| 감사 append-only | 6 | `activity_log` 일반 UPDATE·DELETE·phase 역전 차단 + pending→committed 허용 / `adjustments` UPDATE·DELETE 차단 (owner 시점 — service_role조차 못 뚫음을 증명) |
| 오늘 업무 dedup | 2 | 같은 사건의 열린 업무 중복 INSERT 차단 + 완결 후 재발 시 재생성 허용 |
| 단일 활성 운영자 | 1 | 한 테넌트에 두 번째 active 운영자 INSERT 차단 |
| 원자적 승계 | 4 | 승계 후 활성 1인·이전 운영자 세션 전량 회수·감사 기록(permission·committed) 존재·inactive 운영자 재승계 차단 |
| RLS 전면 적용 | 1 | RLS 미활성 테이블 0개 |

### 하네스 자체의 유효성 (뮤테이션 테스트)

"64/64 PASS"가 의미를 가지려면 하네스가 위반을 **잡을 수 있어야** 한다. 정책을 일부러 파괴해 확인했다.

| 주입한 결함 | 하네스 반응 |
|-------------|-------------|
| `payments` 정책을 `using (true)`로 교체 | 교차노출 스캔에서 `1건 노출` → **FAIL** |
| `faqs` RLS 비활성화 | 교차노출 `13건 노출` + fail-closed·anon·RLS전면적용 등 **8건 FAIL** |
| 자동화 함수 `REVOKE` 5줄 제거 | 함수 실행 차단 **5건 전부 FAIL** (`실행 가능(위반)`) |

## 5. 앱 레이어 테넌트 스코프 감사 (§2의 실질 방어선)

`service_role`이 RLS를 우회하므로, `pnpm audit:scope`가 앱의 `.from()` 호출을 전수 검사한다 (누락 시 종료 코드 1).

| 분류 | 건수 | 판정 |
|------|------|------|
| `tenant_id`를 **필터**로 사용 (`.eq`/`.match`/`.in` 등) | 125 | 정상 |
| INSERT/UPSERT **payload**에 `tenant_id` 포함 | 31 | 정상 — 새 행의 소유 테넌트를 지정 |
| `tenant-scope-ok:` 주석으로 명시 허용 | 8 | 정상 — 아래 참조 |

총 168건(`tenants` 제외), 2026-08-24 실행 기준 — **누락·미해소 0건.**

### `admin_sessions` 조회의 테넌트 스코프 (00013)

`lib/auth/session.ts`의 세션 검증(`getAdminSession`)과 로그아웃 단건 회수(`revokeSessionByToken`)는
쿠키 토큰 해시(`token_hash`, unique)에 더해 **현재 Host에서 리졸브한 테넌트로 스코프**한다
(`resolveTenant()` → `.eq("tenant_id", …)`). 세션은 발급된 테넌트의 호스트에서만 유효하고, 타
테넌트 호스트에서 재생된 쿠키는 무효가 된다 — 예외 주석 없이 감사 규칙을 정면으로 충족한다.
추가로 `getAdminSession`은 세션 행 확인 후 `admin_accounts`의 `status='active'`를 재확인해,
승계·비활성화 직후의 잔존 세션(P-10 레이스)을 차단한다(활성 관리자 0명 비상 상태의 소유자만
로그인 인가와 동일한 예외).

`lib/data/activity.ts`의 `commitCriticalActivity`·`abortCriticalActivity`도 `tenant_id` 필터를
함께 사용한다 — id는 `beginCriticalActivity`가 방금 insert하고 반환한 내부 생성 uuid이고,
`.eq("phase", "pending")` 조건과 append-only 트리거(§3-6)가 그 외 변조를 이중으로 차단한다.

### 감사 규칙에서 주의할 두 가지 함정

1. **`select` 컬럼 목록의 `tenant_id`는 스코프가 아니다.** 초기 규칙은 체인 문자열 어디든 `tenant_id`가 있으면 통과시켰는데, `.select("id, tenant_id, name")`처럼 **조회만** 해도 매치된다. 실제로 `api/cron/flush`의 필터 없는 큐 조회가 이 때문에 "안전"으로 오판됐다. 지금은 `.eq()`/`.match()` 등 **필터 위치**에 있을 때만 인정한다.

2. **`.eq("id", ...)` 단독은 자동 통과시키지 않는다.** 전역 UUID PK라 "다른 행을 실수로 건드리지 않음"은 보장되지만, `id`가 사용자 입력에서 오면 UUID만 알아도 타테넌트 행에 접근하는 IDOR이 된다. 감사는 이런 케이스를 **수동 검토 목록**으로 분리해 출력한다.

### `tenant-scope-ok` 허용 목록 (8건, 전부 검토 완료)

| 위치 | 근거 |
|------|------|
| `lib/notify/send.ts` ×4 | `notificationId`는 내부 생성 uuid — 사용자 입력이 아니며, sending 클레임·sent/failed 확정 모두 단일 행만 갱신(00013로 갱신 지점이 3→4곳) |
| `lib/actions/consult.ts` ×2 | consent 행은 `tenant_id`를 담은 payload 스프레드 / 방금 insert한 상담 행의 보상 삭제 (`inserted.id`) |
| `lib/data/crm.ts` | `portal_token`은 추측 불가한 단일 학생 식별자 — 열람 링크 경로에 테넌트 컨텍스트가 없다(플랫폼 경로) |
| `app/api/cron/flush/route.ts` | 크론은 전 테넌트 큐를 처리하는 플랫폼 경로. 각 행의 `tenant_id`를 그대로 전달 |

## 5-1. 알림 타입 정합 감사

`notifications.type`에는 CHECK 제약이 없고, **앱 코드·SQL 마이그레이션·Deno 엣지 함수** 세 곳이 이 테이블에 행을 적재한다. 뒤의 둘은 TypeScript 타입 검사를 받지 않으므로, 여기서 넣은 타입이 `NotifyType` 유니온에 없으면 `api/cron/flush`가 알림톡 템플릿을 찾지 못한다.

`pnpm audit:notify`가 세 목록의 정합을 강제한다 (불일치 시 종료 코드 1).

실제로 이 게이트가 없어서 두 건이 누락돼 있었다.
- `exam_report` — 시험 리포트가 알림톡에 매핑되지 못하고 항상 SMS로만 발송
- `schedule_unresolved` — 자동화 job 8이 적재하는 선생님 내부 알림

## 6. 한계 — 이 문서가 증명하지 못하는 것

정직하게 남긴다.

1. **PostgREST 경유 앱 E2E 미검증.** 로컬 Postgres에는 PostgREST가 없어 `supabase-js` HTTP 경로는 돌려보지 못했다. Supabase 클라우드 프로젝트 연결 후 재검증 필요.
2. **Supabase Storage RLS 미검증.** `materials`·`photos`·`reviews` 버킷의 객체 수준 정책은 이 하네스 범위 밖이다.
3. **`auth.jwt()` shim은 Supabase 실제 구현을 재현한 것**이지 동일 코드가 아니다. 클라우드에서 1회 재검증 권장.
4. **pg_cron/pg_net 부재.** 로컬에 확장이 없어 크론 잡 등록 경로는 "NOTICE 남기고 스킵" 분기만 확인했다.
