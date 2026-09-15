import { normalizeContactPhone } from "@/lib/student-contact";
import type { PortalRelationView } from "./auth";

export interface SelfPayerStudent {
  id: string;
  is_adult: boolean;
  student_phone: string | null;
  status: string;
}

/**
 * 성인 본인 연락·납부 설정은 본인 학생 관계에 납부 권한을 포함한다.
 * 활성 학생 관계와 등록된 본인 번호가 모두 일치해야 하며 보호자 관계에는 적용하지 않는다.
 * 별도로 설정한 납부자 관계(초대 대기·회수 포함)는 운영자의 결정을 우선한다.
 * 학생 관계 회수, 본인 번호 변경, 성인 설정 해제는 다음 조회부터 함께 반영된다.
 */
export function includeSelfPayerRelations(
  relations: PortalRelationView[],
  students: SelfPayerStudent[],
  contactPhone: string,
  explicitPayerStudentIds: Set<string>,
): PortalRelationView[] {
  const phone = normalizeContactPhone(contactPhone);
  if (!phone) return relations;
  const ownStudents = new Set(students.filter((student) =>
    student.is_adult && student.status !== "ended" && student.student_phone &&
    normalizeContactPhone(student.student_phone) === phone,
  ).map((student) => student.id));
  const included = new Set(explicitPayerStudentIds);
  const result = [...relations];
  for (const relation of relations) {
    if (relation.role !== "student" || !ownStudents.has(relation.studentId) || included.has(relation.studentId)) continue;
    included.add(relation.studentId);
    result.push({ ...relation, relationId: `self-payer:${relation.relationId}`, role: "payer" });
  }
  return result;
}
