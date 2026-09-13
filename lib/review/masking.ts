// 공개용 마스킹 이름 — 정본 "공개 화면에는 학생 실명 대신 승인된 규칙으로 생성한 마스킹 이름"
// (이용약관 제13조 · 처리방침 11절). 규칙은 하나뿐이고 여기서만 정한다.
//
//   홍길동 → 홍*동 · 남궁민수 → 남**수 · 홍길 → 홍* · 홍 → 홍*
//   공백·영문은 그대로 두되 첫 글자와 마지막 글자만 남긴다.
//
// 이 값은 제출 시점에 reviews.public_name으로 저장되고, 운영자는 "공개용 마스킹·최소정보 확인"
// 단계에서 눈으로 확인만 한다(고치지 않는다 — 고쳐야 하면 작성자에게 수정 요청).

export function maskName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, "");
  if (name.length === 0) return "";
  if (name.length === 1) return `${name}*`;
  if (name.length === 2) return `${name[0]}*`;
  const middle = "*".repeat(name.length - 2);
  return `${name[0]}${middle}${name[name.length - 1]}`;
}

/** 공개 목록 표기 — "홍*동 학생". */
export function publicStudentLabel(publicName: string | null | undefined): string {
  return publicName ? `${publicName} 학생` : "수강생";
}
