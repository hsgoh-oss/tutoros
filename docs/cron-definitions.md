# 자동화 크론 정의서 (인프라 8종 + 기획 7-9 추가 4종)

> **2026-07 갱신:** 기존 8종은 인프라 중심 세트다. 기획서 7-9가 명시한 8종 중 누락됐던
> ④후기요청·⑥월간리포트·⑦D-day재계산·⑧발송실패재시도를 `00005_automation_extra.sql`로 추가했다
> (모두 automation 엣지 잡, §2 표 9~12). 이로써 기획 7-9의 8종을 모두 커버한다.

> **2026-08 갱신(00013 M0):** 잡 12종 자체는 그대로다. 발송 경로와 실패 수렴이 바뀌었다 —
> ① flush(5)가 발송 직전 `queued→sending` 클레임으로 이중 발송을 막고, 실패 시 `retry_count` +1은
> `dispatchQueued`에서만 한다. ② notify_retry(12)는 재큐잉만 하며(이중 증가 제거), 10분 이상
> `sending`에 머문 행(결과 불명)을 `work_items`로 수렴시킨다. ③ schedule_autoclean(8)은 알림과
> 무관하게 `work_items`(오늘 업무)를 적재한다 — 연락처 미설정으로 알림이 못 나가도 업무는 남는다.

> **주의: 기획서 원문(TUTOR_OS_기능기획서_v2.1) 자동화 8종 상세 절이 이 세션에 제공되지 않아,
> 아래 8종은 계약서 §14 검수 기준 문구("D-3 예정 안내만 자동", "청구 발송은 수동", "Make·구글시트
> 금지 — pg_cron+엣지 함수")만 확인한 상태에서 작성한 "계약 확정 전 초안"이다.**
> 발주처 검수 전 원문과 반드시 대조할 것 — 특히 알림 문구·발송 시각·대상 조건은 협의 대상.

## 0. 구조 결정 (왜 이렇게 나눴는가)

세 갈래로 나눴다 — DB 조인/멱등 판단이 필요한 잡은 엣지 함수, DB 내부 연산만으로 끝나는 잡은 순수
SQL, 실 Solapi 발송이 필요한 잡은 Next API. 이유:

| 갈래 | 대상 잡 | 이유 |
|------|---------|------|
| **엣지 함수 1개 (`automation`, `?job=` 라우팅)** | 1 lesson_reminder · 2 payment_d3 · 4 payment_overdue_notice · 6 weekly_report_draft | 학생/결제 조인 + 멱등 체크(중복 방지) + 메시지 조합이 필요. 잡별 함수 대신 함수 하나로 묶어 배포·시크릿 관리를 단순화(Supabase Functions 배포 1회, pg_cron은 `?job=` 파라미터만 다르게 호출) |
| **순수 SQL 함수 (마이그레이션 내 plpgsql)** | 3 payment_overdue_flag · 7 content_backup_daily · 8 schedule_autoclean | 조건부 UPDATE/INSERT/DELETE만으로 끝남 — 엣지 함수 왕복 없이 DB 안에서 완결. 배포 단계가 하나 줄어 더 안전 |
| **Next API (`app/api/cron/flush`)** | 5 notify_queue_flush | 실제 Solapi HTTP 호출(알림톡→SMS 폴백 + 상태 갱신)은 `lib/notify/send.ts`의 `dispatchQueued`에만 있고, 이건 Node 전용(Node `crypto`) 코드라 Deno 엣지 함수가 import할 수 없다. 그래서 엣지 함수는 `notifications`에 `status='queued'`로 적재까지만 하고, 실제 재시도 발송은 pg_cron이 **엣지 함수를 거치지 않고 Next API를 직접** `CRON_SECRET`으로 호출해 처리한다 |

엣지 함수(1·2·4·6)와 flush(5)가 큐잉하는 `notifications` 행은 전부 `status='queued'`로 남고,
실제 Solapi 발송은 오직 두 경로로만 일어난다: ① `lib/notify/send.ts`의 `sendNotification()`이
호출 즉시 디스패치(관리자 화면 액션 등에서 사용), ② 이 문서의 job 5(`notify_queue_flush`)가
남아있는 queued 행을 재시도. 엣지 함수 자신은 Solapi를 절대 호출하지 않는다.

두 경로 모두 `dispatchQueued`를 거치며, 00013 이후 발송 직전 `queued→sending` 조건부 클레임을
먼저 잡는다 — 같은 행을 두 워커(즉시 발송과 flush 크론 등)가 집어도 한쪽만 발송하고, 다른 쪽은
skipped로 비켜난다(성공도 실패도 아님). 결과에 따라 `sending→sent|failed`로 확정하고, 발송은
됐는데 확정 갱신이 실패하면 행을 `sending`에 그대로 둔다 — **결과 불명은 성공이 아니므로**
재발송하지 않고 job 12가 오늘 업무로 수렴시킨다(§2 표 12). 리포트 알림(`report_id` 보유)은
전달 결과가 `ai_reports.delivery_status`로 역전파된다(N-02 — 업무 상태와 전달 상태의 분리).

## 1. 배포 전 준비 (수동, 1회)

마이그레이션은 아래 시크릿이 없어도 **에러 없이 적용**된다. 다만 시크릿이 비어 있으면 크론
실행 시점에 `automation_call_edge_function`/`automation_call_flush`가 **예외를 던져
`cron.job_run_details.status='failed'`로 남는다**(00012).

> 이전에는 `NOTICE`만 남기고 조용히 스킵했다. NOTICE는 `job_run_details`에 남지 않아
> 크론 12잡이 전부 `succeeded`인데 `net._http_response`는 0건인 상태가 12일간 방치됐다.
> 실패를 실패로 보고하도록 바꿨으므로, **시크릿 등록 전에는 크론이 실패하는 것이 정상**이다.

운영 전환 전 Supabase SQL Editor에서 1회 실행:

```sql
-- pg_cron/pg_net 미활성이면 (scripts/setup-supabase.sh 1단계가 보통 처리)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 엣지 함수(automation) 호출용
select vault.create_secret('https://<project-ref>.supabase.co', 'automation_base_url');
select vault.create_secret('<service-role-key>', 'automation_service_role_key');

-- Next API(/api/cron/flush) 호출용 — CRON_SECRET은 .env.local(Vercel)과 반드시 동일 값
select vault.create_secret('https://<production-domain>', 'app_base_url');
select vault.create_secret('<CRON_SECRET 값>', 'cron_secret');
```

그리고:
1. `supabase functions deploy automation` (Supabase CLI) — 엣지 함수 배포
2. Vercel 환경변수에 `CRON_SECRET` 등록 (`.env.local`과 동일 값 — `scripts/env.template` 참조)
3. `select * from cron.job;`로 12개 잡이 등록됐는지 확인 (docs/supabase-setup.md 체크리스트에도 포함됨)

### 배포 후 실동작 검증

크론이 `succeeded`라는 것만으로는 아무것도 증명되지 않는다(위 사고의 교훈). 아래 3단으로 본다:

```sql
-- ① 강제 1회 발사 — 시크릿이 없으면 여기서 바로 예외가 난다
select public.automation_call_edge_function('dday_recalc');

-- ② 발사 기록 — request_id가 남아야 실제로 쐈다는 증거다(automation_runs, 00012)
select job_name, request_id, created_at
  from public.automation_runs order by created_at desc limit 5;

-- ③ 응답 — 200이어야 엣지 함수가 정상 수신했다는 뜻
--    net._http_response는 TTL(기본 6시간)로 지워지므로 발사 직후에 볼 것
select status_code, left(content, 200)
  from net._http_response order by created desc limit 5;
```

엣지 함수만 따로 확인하려면 (anon 키로도 게이트 통과 여부를 볼 수 있다):

```bash
curl -s -X POST -H "Authorization: Bearer <anon-key>" \
  "https://<project-ref>.supabase.co/functions/v1/automation?job=dday_recalc"
# → {"ok":true,"job":"dday_recalc","hidden":0}
# 인증 없이 호출하면 401, 없는 job이면 400 + 사용 가능한 job 목록
```

## 2. 잡 정의

시간은 KST(Asia/Seoul) 기준으로 서술하고 괄호에 UTC를 병기한다(pg_cron 기본 타임존=UTC).

| # | 잡 이름 | 목적 | 스케줄 KST(UTC) | 대상 | 발송/기록 | 멱등성 |
|---|---------|------|------------------|------|-----------|--------|
| 1 | `lesson_reminder` | 내일 수업 리마인더 | 매일 18:00 (09:00) | `schedules.status='planned' AND reminder_sent=false AND scheduled_at ∈ 내일(KST)` | `notifications` 큐잉(type=`lesson_reminder`) + `schedules.reminder_sent=true` | `reminder_sent` 플래그로 재실행 시 자동 제외 |
| 2 | `payment_d3` | 결제 D-3 예정 안내(계약: 자동은 이것만) | 매일 10:00 (01:00) | `payments.status='pending' AND due_date = 오늘+3(KST)` | `notifications` 큐잉(type=`payment_d3`) | 오늘(KST) 동일 학생·타입 알림 존재 시 스킵 |
| 3 | `payment_overdue_flag` | 연체 상태 전환 | 매일 00:30 (전일 15:30) | `payments.status='pending' AND due_date < 오늘(KST)` | `UPDATE payments SET status='overdue'` (알림 없음, 순수 SQL) | `status` 전환은 자연히 멱등(이미 overdue면 재대상 아님) |
| 4 | `payment_overdue_notice` | 미납 안내 | 매일 10:30 (01:30) | `payments.status='overdue'` 전체 | `notifications` 큐잉(type=`payment_overdue`) | 최근 7일 내 동일 학생·타입 알림 존재 시 스킵(주 1회) |
| 5 | `notify_queue_flush` | 큐잉된 알림 실제 재발송 | 매시 10분 | `notifications.status='queued'` (야간엔 `is_ad=false`만) 최대 50건 | `lib/notify/send.ts`의 `dispatchQueued` 재사용 — `queued→sending` 클레임 후 발송, `sent`/`failed`로 확정(00013). 실패 시 `retry_count` +1은 **이 지점에서만** 하고, 상한(3) 소진 시 `work_items`(kind=`notify_exhausted`, 결제 계열은 priority=`money`) 적재. `report_id` 보유 행은 결과를 `ai_reports.delivery_status`로 역전파 | 상태 전환형이라 재실행해도 이미 처리된 행은 대상에서 빠짐 + `sending` 클레임으로 두 워커가 같은 행을 집어도 한쪽만 발송(다른 쪽은 skipped 집계) |
| 6 | `weekly_report_draft` | 주간 리포트 생성 대기열 | 매주 월 09:00 (월 00:00) | `students.status='active'` 중 지난주(KST 월~일) `lessons` 존재 | `ai_reports` draft 행 삽입(내용은 비움 — AI 생성은 Next 서버가 별도 트리거) | 이번주(KST 이번주 월요일 이후) 동일 학생·`type='weekly'` draft 존재 시 스킵 |
| 7 | `content_backup_daily` | 설정 일일 백업 | 매일 03:00 (전일 18:00) | tenant별 `site_settings` 전 키 | `backups`(target=`settings:daily`) 스냅샷 1건/tenant + 12개 초과분 삭제 | 순수 SQL, 매일 새 스냅샷 추가 후 정리라 재실행해도 안전 |
| 8 | `schedule_autoclean` | 미처리 일정 집계 → 오늘 업무 + 알림 | 매일 04:00 (전일 19:00) | `schedules.status='planned' AND scheduled_at < 오늘(KST)` | tenant별 미처리 건수 집계 → **알림과 무관하게** `work_items`(kind=`schedule_unresolved`, source_id=실행일자 KST) 적재(00013) + `notifications`(type=`schedule_unresolved`, channel=`sms`) 큐잉 | **연락처(`site_settings.site_info.phone`) 미설정 tenant는 자동 알림만 스킵하고 `NOTICE`를 남긴다 — 업무(`work_items`)는 그래도 적재되므로 사건이 은폐되지 않는다(N-02: 업무 성공과 알림 전달 성공의 분리).** 업무는 실행일자 기준 하루 한 건(같은 사건의 열린 업무가 있으면 미생성 — 한 사건 한 업무). 일정 자체의 상태는 변경하지 않음(자동 취소·삭제 없음) |
| 9 | `review_request` | 후기 요청(기획 7-9 ④) | 매일 11:00 (02:00) | `students.status='active'` 중 첫 수업 `lesson_date`가 28일 이전 | `notifications` 큐잉(type=`review_request`) | 학생당 `review_request` 존재 시 스킵(1회성) |
| 10 | `monthly_report_draft` | 월간 리포트 초안(기획 7-9 ⑥) | 매월 1일 09:00 (1일 00:00) | active 학생 중 지난 30일 `lessons` 존재 | `ai_reports` draft(type=`monthly`) 삽입 | 이번 달(KST 1일 이후) 동일 학생·`type='monthly'` draft 존재 시 스킵 |
| 11 | `dday_recalc` | 경과 시험 자동 숨김(기획 7-9 ⑦) | 매일 00:20 (전일 15:20) | `ddays.exam_date < 오늘(KST) AND is_visible=true` | `UPDATE ddays SET is_visible=false` | 이미 숨김이면 재대상 아님(임박 강조는 렌더 시점 계산) |
| 12 | `notify_retry` | 발송 실패 재큐잉 + 결과 불명 수렴(기획 7-9 ⑧) | 매시 40분 | `notifications.status='failed' AND retry_count<3` / 10분 이상 `status='sending'` 체류 행 | `status='queued'`로만 되돌린다 → flush가 재발송. **`retry_count`는 건드리지 않는다** — 실패 확정 시 `dispatchQueued`가 이미 +1 했고, 여기서 또 올리면 이중 증가로 상한 3이 실제 시도 1~2회로 준다(00013 개정). 추가로 `sending` 장기 체류 행(발송 결과 불명)은 상태를 그대로 두고 `work_items`(kind=`notify_unknown_result`) 적재 — failed로 내리면 재큐잉→이중 발송, sent로 올리면 미발송 은폐 | 상태 전환형 + `retry_count` 상한(3 = 실제 시도 3회). 결과 불명 업무는 `work_items` 부분 유니크가 중복 생성 차단(23505 무시) |

## 3. 알려진 한계 (정직하게 명시)

- **job 8의 알림은 여전히 부분 구현이다.** 원 지시에는 "선생님 내부 알림"을 보내라고 되어 있으나, DB에는
  선생님 본인의 통지용 연락처가 별도로 없다(`tenants`엔 email만 있고, `site_settings.site_info.phone`은
  공개 사이트 대표번호 필드라 항상 채워져 있다는 보장이 없다). 그래서 해당 필드가 비어 있으면
  **알림을 억지로 만들어 보내지 않고(빈 문자열 phone 삽입 금지) 스킵 + NOTICE**로 처리했다.
  다만 00013 이후로는 이 경우에도 `work_items`(오늘 업무)에는 적재되므로, 예전처럼 NOTICE로만
  남아 은폐되지는 않는다 — 관리자 대시보드의 오늘 업무에서 확인된다. 알림까지 필요하면
  tenants에 내부 연락처 컬럼을 추가하는 CR을 권한다.
- **job 12의 결과 불명(`sending` 체류) 판정은 `created_at` 기준 근사다.** `notifications`에
  `updated_at`이 없어 클레임 시각을 정확히 알 수 없다 — 클레임은 적재 직후~다음 flush(매시) 안에
  일어나므로 "적재 10분 경과 + 여전히 sending"을 결과 불명으로 본다.
- **job 6은 리포트를 생성하지 않는다.** `ai_reports`에 `status='draft'`, `content=''` 행만
  넣는다 — 실제 AI 호출(`lib/ai/adapter.ts`)은 관리자 승인 플로우 쪽에서 이 draft를 집어 처리하는
  구조를 전제한다(가명화·모델 라우팅 등은 그쪽 계약 범위).
- **엣지 함수의 메시지 템플릿(`supabase/functions/_shared/templates.ts`)은 `lib/notify/templates.ts`와
  별개 파일이다.** Deno 런타임이 Next 전용 코드(Node `crypto` 등)를 import할 수 없어 3종 문구만
  수동으로 복제했다 — 문구를 바꿀 때는 두 파일을 함께 갱신해야 한다.

## 4. 시각 조작 테스트 절차

모든 절차는 Supabase SQL Editor(또는 `psql "$SUPABASE_DB_URL"`)에서 실행한다. 서버 시간을 바꿀
수 없으므로 **데이터의 날짜/시각을 조작**해 크론이 실제로 집을 대상을 만든 뒤, 함수를 수동으로
1회 호출해 검증한다(`cron.schedule`로 등록된 잡은 `select public.automation_xxx();`로 동일하게
수동 실행 가능 — 스케줄을 기다릴 필요 없음).

### job 1: lesson_reminder
```sql
-- 학생 1명의 내일(KST) 수업 일정을 만든다
insert into public.schedules (tenant_id, student_id, scheduled_at, status, reminder_sent)
values ('<tenant_id>', '<student_id>',
        (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') + interval '1 day 18 hours',
        'planned', false);
```
```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/automation?job=lesson_reminder" \
  -H "Authorization: Bearer <service-role-key>"
```
검증: `select * from public.notifications where type='lesson_reminder' order by created_at desc limit 1;`
(status='queued' 확인) 및 `select reminder_sent from public.schedules where id='<위 id>';` (true 확인).

### job 2: payment_d3
```sql
update public.payments set status='pending',
  due_date = (now() at time zone 'Asia/Seoul')::date + 3
where id = '<payment_id>';
```
엣지 함수 `?job=payment_d3` 수동 호출 후 `notifications`에 `type='payment_d3'` 신규 행 확인.
같은 호출을 한 번 더 실행해 **중복 삽입되지 않음**(멱등)을 확인.

### job 3: payment_overdue_flag
```sql
update public.payments set status='pending', due_date = (now() at time zone 'Asia/Seoul')::date - 1
where id = '<payment_id>';
select public.automation_payment_overdue_flag();
select status from public.payments where id = '<payment_id>'; -- 'overdue' 확인
```

### job 4: payment_overdue_notice
```sql
update public.payments set status='overdue' where id = '<payment_id>';
```
엣지 함수 `?job=payment_overdue_notice` 수동 호출 → `notifications`(type=`payment_overdue`) 확인.
같은 학생·타입 알림을 하나 만든 뒤 다시 호출해 **7일 이내 중복이 스킵**되는지 확인.

### job 5: notify_queue_flush
```sql
-- 임의 queued 행 하나 확보(위 테스트들에서 생성된 행 사용 가능)
select id, status from public.notifications where status='queued' limit 1;
```
```bash
curl -s -X POST "https://<production-domain>/api/cron/flush" -H "Authorization: Bearer <CRON_SECRET>"
```
검증: 해당 행의 `status`가 `sent`(Solapi 키 설정 시) 또는 `failed`(미설정 시, `retry_count` 증가)로
바뀌는지 확인 — 발송 중에는 잠깐 `sending`으로 클레임된다(00013). `Authorization` 헤더 없이 호출 시
401 확인(보호 동작 검증). `retry_count`가 3에 이른 행은 `work_items`(kind=`notify_exhausted`)에
업무가 생겼는지도 함께 확인.

### job 6: weekly_report_draft
```sql
insert into public.lessons (tenant_id, student_id, lesson_date, content)
values ('<tenant_id>', '<student_id>',
        (now() at time zone 'Asia/Seoul')::date - 3, '테스트 수업');
```
엣지 함수 `?job=weekly_report_draft` 수동 호출 → `ai_reports`(type='weekly', status='draft') 신규 행 확인.
다시 호출해 **같은 주 중복 draft가 생기지 않음**을 확인.

### job 7: content_backup_daily
```sql
select public.automation_content_backup_daily();
select target, created_at from public.backups where target='settings:daily' order by created_at desc;
```
13회 연속 실행 후 `count(*)`가 tenant당 12를 넘지 않는지 확인.

### job 8: schedule_autoclean
```sql
insert into public.schedules (tenant_id, student_id, scheduled_at, status)
values ('<tenant_id>', '<student_id>', now() - interval '2 days', 'planned');
select public.automation_schedule_autoclean();
```
공통(연락처 유무 무관): `work_items`에 kind=`schedule_unresolved` 업무가 생겼는지 확인하고,
같은 날 한 번 더 실행해 **중복 업무가 생기지 않음**(실행일자 기준 하루 한 건)을 확인.
```sql
select kind, title, source_id, status from public.work_items
 where kind='schedule_unresolved' order by created_at desc limit 3;
```
`site_settings(key='site_info').value->>'phone'`이 있는 테넌트: `notifications`(type=`schedule_unresolved`)
신규 행 확인. 없는 테넌트: 알림 미생성 + SQL Editor 로그에 `NOTICE`(오늘 업무 적재 안내 문구) 확인.

### job 12: notify_retry (00013 개정분)
```sql
-- 결과 불명 행: 10분 넘게 sending에 머문 것처럼 만든다
update public.notifications
   set status='sending', created_at = now() - interval '15 minutes'
 where id = '<notification_id>';
```
엣지 함수 `?job=notify_retry` 수동 호출 후 확인:
- 해당 행의 `status`는 **여전히 `sending`**(자동으로 failed/sent로 뒤집지 않음 — 결과 불명은 사람 확인 대상).
- `work_items`에 kind=`notify_unknown_result`, source_id=해당 알림 id 업무 신규 1건.
- 같은 호출을 한 번 더 실행해 **중복 업무가 생기지 않음**(부분 유니크) 확인.
- `status='failed' AND retry_count<3`인 행은 `queued`로 돌아가되 **`retry_count`가 그대로**임을 확인
  (+1은 다음 flush의 실패 확정 시점에만 일어난다).
