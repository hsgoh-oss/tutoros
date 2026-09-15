import { studentContactPhoneFromRow } from "@/supabase/functions/_shared/student-contact";
export { studentContactPhoneFromRow, type StudentContactRow } from "@/supabase/functions/_shared/student-contact";

/** 성인 본인 납부는 학생 연락처, 미성년자는 보호자 연락처를 안내·청구 수신자로 쓴다. */
export function studentContactPhone(student: {
  isAdult: boolean;
  parentPhone: string | null;
  studentPhone: string | null;
}): string | null {
  return studentContactPhoneFromRow({
    is_adult: student.isAdult,
    parent_phone: student.parentPhone,
    student_phone: student.studentPhone,
  });
}

export function normalizeContactPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  return digits;
}
