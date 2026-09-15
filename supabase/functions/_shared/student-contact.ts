// Next.js와 자동화 작업이 같은 수신자 규칙을 사용한다. 런타임 의존성을 추가하지 않는다.
export interface StudentContactRow {
  is_adult: boolean;
  parent_phone: string | null;
  student_phone: string | null;
}

export function studentContactPhoneFromRow(student: StudentContactRow): string | null {
  return student.is_adult ? student.student_phone : student.parent_phone;
}
