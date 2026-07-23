# Supabase 원샷 셋업 가이드

> 갑 명의 Supabase 프로젝트가 준비되면 **아래 3단계로 전체 셋업이 끝난다.**
> 마이그레이션(20테이블+RLS) · 시딩 · Storage 버킷 · pg_cron 확장 · 검증까지 스크립트 하나로 처리.

## 준비물 (Supabase 대시보드에서 복사)

| 값 | 위치 |
|----|------|
| `SUPABASE_URL` | Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role (secret) |
| `SUPABASE_DB_URL` | Settings → Database → Connection string (URI, 세션 모드 5432) |

## 셋업 3단계

```bash
# ① 환경변수 파일 준비
cp scripts/env.template .env.local
#    → SUPABASE_* 3개 채우기 (나머지는 키 나올 때마다 추가)

# ② 원샷 셋업 (마이그레이션+시딩+버킷+확장+검증)
pnpm db:setup -- --seed
#    또는: bash scripts/setup-supabase.sh --seed

# ③ dev 재시작 후 E2E 확인
pnpm dev
```

- 스크립트는 **멱등**: 적용된 마이그레이션은 `_applied_migrations`로 스킵, 시딩은 tenants가 비어 있을 때만, 버킷은 존재 시 통과.
- 새 마이그레이션 파일을 추가하면 같은 명령을 다시 실행하면 된다.

## 셋업 후 E2E 검증 체크리스트

1. `pnpm dev` → `/consult` 상담 제출 → `/admin/consultations` 목록에 표시
2. 상담 상세 → "학생 전환" → `/admin/students`에 생성 확인
3. 시간당 단가는 `site_settings.rates`(DB) 값이 공개 `/classes` 계산기·수업료 표·구조화 데이터에 연동된다. 관리자 편집 UI는 없으므로 값 변경은 DB에서 직접 수행한다(페이지 편집 기능 제거됨)
4. `/admin/dday` 수정 → 공개 사이트 배너 반영
5. 자료 업로드(`/admin/materials`) → Storage `materials` 버킷에 파일 생성
6. RLS 교차 접근 0건: SQL Editor에서
   ```sql
   -- anon 키로 taenant A 데이터가 조회되지 않아야 함 (service_role은 우회가 정상)
   set role authenticated; set request.jwt.claims = '{"tenant_id":"<다른 테넌트 uuid>"}';
   select count(*) from students; -- 0이어야 정상
   ```
7. 알림/결제/AI는 각 키(`SOLAPI_*`, `TOSS_SECRET_KEY`, `ANTHROPIC_API_KEY`) 입력 후 활성화 — 키 없인 화면·로그만 동작(안전 폴백)

## 운영 전환 시 추가 작업 (수동 1회)

- [ ] Vercel 환경변수에 `.env.local` 내용 등록 (Preview/Production 분리)
- [ ] `AUTH_DEV_MODE` 제거 또는 false 확인 (프로덕션에서 true 금지)
- [ ] Supabase 대시보드 → Database → Backups: PITR(시점 복원) 활성화
- [ ] Edge Functions 배포: `supabase functions deploy` (Supabase CLI 설치 필요)
- [ ] 크론 정의서(docs/cron-definitions.md)대로 잡 등록 확인: `select * from cron.job;`
