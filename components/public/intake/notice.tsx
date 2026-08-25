// 신청폼 링크 안내 화면 — 작성할 수 없는 링크로 들어왔을 때 보여 주는 유일한 결과.
//
// 존재 비노출(T-01·R-01, /p의 SignedOutNotice와 같은 규율): 없는 토큰·닫힌 폼(결과 변경·상담
// 종결·재발급)·기한 지난 링크·이미 제출된 폼·다른 테넌트가 전부 같은 문구로 수렴한다.
// 이유를 구분해 보여 주면 토큰을 던져 보는 것만으로 "이 상담은 존재하고 지금 이런 상태다"를
// 알아낼 수 있기 때문이다. 문구는 고정 문자열이며 URL에서 온 텍스트를 그리지 않는다.
export function IntakeNotice({ brandName }: { brandName: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-5 py-12">
      <div className="w-full rounded-card border border-line bg-white p-8 text-center shadow-card">
        <p className="text-sm font-extrabold tracking-tight text-brand-600">
          신청서
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          지금은 이 링크로 신청서를 작성할 수 없습니다. 이미 제출하셨다면 접수된
          내용으로 확인 중이니 기다려 주세요. 아직 작성하지 못하셨다면 담당
          선생님께 새 링크를 요청해 주세요.
        </p>
        <p className="mt-6 text-xs font-bold tracking-tight text-muted">
          {brandName}
        </p>
      </div>
    </main>
  );
}
