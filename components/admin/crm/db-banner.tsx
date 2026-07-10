// Supabase 미연결 시 각 CRM 페이지 상단에 표시하는 공용 안내 배너.
export function DbBanner() {
  return (
    <div className="mb-6 rounded-panel border border-amber-100 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-700">
      Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.
    </div>
  );
}
