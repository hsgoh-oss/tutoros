#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# TUTOR OS — RLS 교차 접근 0건 검증 (계약 제14장 멀티테넌트 인수 항목)
#
# 로컬 Postgres에 스키마를 처음부터 적용하고, 테넌트 3개를 시딩한 뒤
# 계정별 18개 테이블 전부에 타테넌트 행을 심고 교차 접근이 0건인지 증명한다.
#
# 사용법:
#   bash scripts/verify-rls.sh                # 기본 DB 이름(tutoros_rls_verify)로 실행
#   VERIFY_DB=mydb bash scripts/verify-rls.sh
#
# 요구: 로컬 PostgreSQL 14+ (superuser 접속 — 역할 생성/전환에 필요)
#
# 이 스크립트는 로컬 검증 전용이다. Supabase 클라우드에는 auth.jwt()와
# anon/authenticated/service_role 역할이 이미 있으므로 00_shim.sql은 적용하지 않는다.
# ─────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${VERIFY_DB:-tutoros_rls_verify}"
TESTS="$ROOT/supabase/tests/rls"

if ! psql -d postgres -tAc "select 1" >/dev/null 2>&1; then
  echo "❌ 로컬 PostgreSQL에 접속할 수 없습니다. (brew services start postgresql@16)" >&2
  exit 1
fi

is_super="$(psql -d postgres -tAc "select usesuper from pg_user where usename = current_user")"
if [ "$is_super" != "t" ]; then
  echo "❌ superuser 권한이 필요합니다 (set role authenticated / 역할 생성)." >&2
  exit 1
fi

echo "═══ 1/5 테스트 DB 재생성: $DB ═══"
psql -d postgres -q -c "drop database if exists \"$DB\";" -c "create database \"$DB\";"

run() { psql -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

echo "═══ 2/5 Supabase 런타임 shim (auth.jwt · 역할) ═══"
run -f "$TESTS/00_shim.sql" 2>&1 | grep -viE "notice|already exists" || true

echo "═══ 3/5 마이그레이션 + 권한 + 시드 ═══"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  ▶ $(basename "$f")"
  run -f "$f" 2>&1 | grep -viE "notice|skipping" || true
done
run -f "$TESTS/90_grants.sql"
run -f "$ROOT/supabase/seed.sql"

echo "═══ 4/5 타테넌트 픽스처 (18개 테이블 전부) ═══"
run -f "$TESTS/50_fixture.sql"

echo "═══ 5/5 교차 접근 검증 ═══"
output="$(psql -d "$DB" -v ON_ERROR_STOP=1 -f "$TESTS/99_rls_test.sql" 2>&1)"
echo "$output"

# 판정은 요약행의 결론 마커로 한다 — rls_result는 temp table이라 세션 종료 후 조회할 수 없다.
if echo "$output" | grep -q "❌"; then
  echo ""
  echo "❌ RLS 위반이 발견되었습니다. 위 표의 FAIL 행을 확인하세요."
  exit 1
fi
if echo "$output" | grep -q "⚠️"; then
  echo ""
  echo "⚠️  위반은 없으나 일부 테이블이 타테넌트 데이터 부재로 증명되지 않았습니다."
  exit 2
fi

echo ""
echo "✅ RLS 교차 접근 0건 — 계약 제14장 멀티테넌트 인수 기준 충족"
echo "   (검증 DB는 $DB 에 남아 있습니다. 정리: dropdb $DB)"
