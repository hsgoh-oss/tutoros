#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# TUTOR OS — Supabase 원샷 셋업
# 마이그레이션 → (선택) 시딩 → Storage 버킷 → 확장 → 검증까지 한 번에.
#
# 사용법:
#   SUPABASE_DB_URL="postgresql://postgres:[비밀번호]@db.[ref].supabase.co:5432/postgres" \
#   SUPABASE_URL="https://[ref].supabase.co" \
#   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
#   bash scripts/setup-supabase.sh [--seed]
#
#   (.env.local에 위 3개가 이미 있으면 자동으로 읽는다)
#
# 옵션:
#   --seed          테스트 테넌트·콘텐츠 시딩 (tenants가 비어 있을 때만)
#   --skip-buckets  Storage 버킷 생성 생략
# ─────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED=false
SKIP_BUCKETS=false
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=true ;;
    --skip-buckets) SKIP_BUCKETS=true ;;
    *) echo "알 수 없는 옵션: $arg" >&2; exit 1 ;;
  esac
done

# .env.local 폴백 로드 (셸 환경변수가 우선)
if [ -f "$ROOT/.env.local" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL)
        if [ -z "${!k:-}" ] && [ -n "$v" ]; then export "$k=$v"; fi ;;
    esac
  done < <(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL)=' "$ROOT/.env.local" || true)
fi

missing=()
[ -z "${SUPABASE_DB_URL:-}" ] && missing+=("SUPABASE_DB_URL")
[ -z "${SUPABASE_URL:-}" ] && missing+=("SUPABASE_URL")
[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && missing+=("SUPABASE_SERVICE_ROLE_KEY")
if [ ${#missing[@]} -gt 0 ]; then
  echo "❌ 환경변수 누락: ${missing[*]}"
  echo "   Supabase 대시보드 → Settings → Database(연결 문자열) / API(URL·service_role 키)에서 복사해 주세요."
  echo "   참고: scripts/env.template"
  exit 1
fi

PSQL=(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q)

echo "═══ 1/5 확장 활성화 (pg_cron·pg_net — 자동화 8종용) ═══"
"${PSQL[@]}" -c "create extension if not exists pg_cron;" \
  || echo "⚠️  pg_cron 활성화 실패 — Supabase 대시보드 → Database → Extensions에서 수동 활성화 필요"
"${PSQL[@]}" -c "create extension if not exists pg_net;" \
  || echo "⚠️  pg_net 활성화 실패 — 대시보드에서 수동 활성화 필요"

echo "═══ 2/5 마이그레이션 적용 (중복 적용 자동 스킵) ═══"
"${PSQL[@]}" -c "create table if not exists public._applied_migrations (
  name text primary key, applied_at timestamptz not null default now());"

applied=0; skipped=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  exists="$("${PSQL[@]}" -tAc "select 1 from public._applied_migrations where name = '$name'")"
  if [ "$exists" = "1" ]; then
    echo "  ↷ 스킵(적용됨): $name"; skipped=$((skipped+1)); continue
  fi
  echo "  ▶ 적용: $name"
  "${PSQL[@]}" -f "$f"
  "${PSQL[@]}" -c "insert into public._applied_migrations (name) values ('$name');"
  applied=$((applied+1))
done
echo "  마이그레이션: ${applied}개 적용, ${skipped}개 스킵"

echo "═══ 3/5 시딩 ═══"
if [ "$SEED" = true ]; then
  tenant_count="$("${PSQL[@]}" -tAc "select count(*) from public.tenants")"
  if [ "$tenant_count" = "0" ]; then
    echo "  ▶ seed.sql 적용 (테스트 테넌트·콘텐츠)"
    "${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
  else
    echo "  ↷ 스킵: tenants ${tenant_count}건 존재 (중복 시딩 방지)"
  fi
else
  echo "  ↷ 생략 (--seed 옵션으로 활성화)"
fi

echo "═══ 4/5 Storage 버킷 (materials=비공개·서명URL / photos·reviews=공개 읽기) ═══"
if [ "$SKIP_BUCKETS" = true ]; then
  echo "  ↷ 생략 (--skip-buckets)"
else
  for bucket in materials photos reviews; do
    # materials는 학생 PII 자료 — 비공개(서명 URL로만 접근). photos·reviews는 공개 사이트 자산.
    if [ "$bucket" = "materials" ]; then pub=false; else pub=true; fi
    code="$(curl -s -o /tmp/bucket_resp.json -w "%{http_code}" \
      -X POST "$SUPABASE_URL/storage/v1/bucket" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"$bucket\",\"name\":\"$bucket\",\"public\":$pub,\"file_size_limit\":10485760}")"
    case "$code" in
      200|201) echo "  ✔ 생성: $bucket" ;;
      400|409)
        if grep -q "already exists\|Duplicate" /tmp/bucket_resp.json 2>/dev/null; then
          echo "  ↷ 존재함: $bucket"
        else
          echo "  ⚠️  $bucket 생성 실패 ($code): $(cat /tmp/bucket_resp.json)"
        fi ;;
      *) echo "  ⚠️  $bucket 생성 실패 ($code): $(cat /tmp/bucket_resp.json)" ;;
    esac
  done
fi

echo "═══ 5/5 검증 ═══"
"${PSQL[@]}" -P pager=off <<'SQL'
select '테이블 수' as 항목, count(*)::text as 값
  from pg_tables where schemaname = 'public' and tablename <> '_applied_migrations'
union all
select 'RLS 활성 테이블', count(*)::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
union all
select 'tenants', count(*)::text from public.tenants
union all
select 'cron 잡', coalesce((select count(*)::text from cron.job), '0');
SQL

bucket_list="$(curl -s "$SUPABASE_URL/storage/v1/bucket" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[].name' 2>/dev/null | paste -sd', ' -)"
echo "  Storage 버킷: ${bucket_list:-조회 실패}"

echo ""
echo "✅ 셋업 완료. 다음 단계:"
echo "  1) scripts/env.template 참고해 .env.local 채우기 (SUPABASE_URL·SERVICE_ROLE_KEY 필수)"
echo "  2) pnpm dev 재시작 → 관리자 로그인(테넌트 이메일 OTP) → 상담 제출→CRM 반영 확인"
echo "  3) docs/supabase-setup.md 체크리스트로 E2E 검증"
