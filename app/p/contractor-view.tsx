// 계약자 역할 뷰 — 자리 표시 (P-05·M2).
//
// 계약 엔티티(계약서·귀속·정산 대상)는 M2에서 들어온다. 지금 이 역할이 존재하는 이유는
// 관계 모델이 역할별로 독립이라는 사실을 데이터에서 미리 성립시켜 두기 위해서다(검수 16) —
// 계약자로 초대된 사람도 로그인은 되고, 열리는 화면이 아직 없을 뿐이다.
//
// 없는 데이터를 흉내 내지 않는다: 가짜 계약 목록·빈 표를 그리는 대신 "준비 중"이라는 사실만
// 말한다. 이 뷰는 어떤 조회도 하지 않는다.
export function ContractorView({ studentName }: { studentName: string }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-black tracking-tight text-ink">
        계약 정보
      </h2>
      <div className="rounded-card border border-line bg-white p-10 text-center shadow-card">
        <p className="text-sm font-bold tracking-tight text-ink">
          계약 정보는 준비 중입니다.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {studentName} 학생의 계약 관련 화면은 아직 열리지 않았습니다. 문의는 담당
          선생님께 부탁드립니다.
        </p>
      </div>
    </section>
  );
}
