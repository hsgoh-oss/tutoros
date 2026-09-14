// Supabase 미연결 시 각 CRM 페이지 상단에 표시하는 공용 안내 배너.
export function DbBanner() {
  return (
    <div role="status" className="mb-5 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      데이터베이스가 연결되지 않아 데이터를 조회하거나 저장할 수 없습니다.
    </div>
  );
}
