"use server";

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient, hasDb } from "@/lib/supabase/server";
import type { ClassType, Student } from "@/lib/types";
import type { CrmActionResult } from "@/components/admin/crm/types";

const DB_ERROR = "Supabase 미연결 — 환경변수 설정 후 사용할 수 있습니다.";
const VALID_CLASS_TYPES: ClassType[] = ["inperson", "video"];
const VALID_STATUSES: Student["status"][] = ["trial", "active", "paused", "ended"];

interface StudentFormPayload {
  name: string;
  parentPhone: string;
  studentPhone: string | null;
  studentPhoneConsent: boolean;
  school: string | null;
  grade: string | null;
  classType: ClassType;
  subjectType: string | null;
  status: Student["status"];
}

function parseStudentForm(formData: FormData): StudentFormPayload | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const parentPhone = String(formData.get("parentPhone") ?? "").trim();
  if (!name) return { error: "이름을 입력해 주세요." };
  if (!parentPhone) return { error: "학부모 연락처를 입력해 주세요." };

  const studentPhoneRaw = String(formData.get("studentPhone") ?? "").trim();
  const studentPhoneConsent = formData.get("studentPhoneConsent") === "on";
  if (studentPhoneRaw && !studentPhoneConsent) {
    return { error: "학생 연락처를 입력하려면 수집 동의 확인이 필요합니다." };
  }

  const classTypeRaw = String(formData.get("classType") ?? "inperson");
  const classType: ClassType = VALID_CLASS_TYPES.includes(classTypeRaw as ClassType)
    ? (classTypeRaw as ClassType)
    : "inperson";

  const statusRaw = String(formData.get("status") ?? "trial");
  const status: Student["status"] = VALID_STATUSES.includes(statusRaw as Student["status"])
    ? (statusRaw as Student["status"])
    : "trial";

  return {
    name,
    parentPhone,
    studentPhone: studentPhoneRaw || null,
    studentPhoneConsent,
    school: String(formData.get("school") ?? "").trim() || null,
    grade: String(formData.get("grade") ?? "").trim() || null,
    classType,
    subjectType: String(formData.get("subjectType") ?? "").trim() || null,
    status,
  };
}

async function recordStudentPhoneConsent(
  tenantId: string,
  studentId: string,
): Promise<void> {
  const db = createServiceClient()!;
  const { error } = await db.from("consents").insert({
    tenant_id: tenantId,
    subject_type: "student",
    subject_id: studentId,
    item: "student_phone",
    via: "admin",
  });
  if (error) console.error("[students] student_phone consent insert failed", error);
}

export async function createStudent(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const parsed = parseStudentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  const { data: student, error } = await db
    .from("students")
    .insert({
      tenant_id: session.tenantId,
      name: parsed.name,
      parent_phone: parsed.parentPhone,
      student_phone: parsed.studentPhone,
      school: parsed.school,
      grade: parsed.grade,
      class_type: parsed.classType,
      subject_type: parsed.subjectType,
      status: parsed.status,
    })
    .select("id")
    .single();
  if (error || !student) {
    console.error("[students] insert failed", error);
    return { ok: false, error: "학생 등록 중 오류가 발생했습니다." };
  }

  if (parsed.studentPhone && parsed.studentPhoneConsent) {
    await recordStudentPhoneConsent(session.tenantId, student.id);
  }

  revalidatePath("/admin/students");
  return { ok: true };
}

export async function updateStudent(formData: FormData): Promise<CrmActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "잘못된 요청입니다." };

  const parsed = parseStudentForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const db = createServiceClient()!;
  const { error } = await db
    .from("students")
    .update({
      name: parsed.name,
      parent_phone: parsed.parentPhone,
      student_phone: parsed.studentPhone,
      school: parsed.school,
      grade: parsed.grade,
      class_type: parsed.classType,
      subject_type: parsed.subjectType,
      status: parsed.status,
    })
    .eq("tenant_id", session.tenantId)
    .eq("id", id);
  if (error) {
    console.error("[students] update failed", error);
    return { ok: false, error: "학생 정보 수정 중 오류가 발생했습니다." };
  }

  if (parsed.studentPhone && parsed.studentPhoneConsent) {
    await recordStudentPhoneConsent(session.tenantId, id);
  }

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${id}`);
  return { ok: true };
}

export interface BulkStudentRow {
  name: string;
  parentPhone: string;
  school?: string;
  grade?: string;
  classType?: string;
}

export async function bulkCreateStudents(
  rows: BulkStudentRow[],
): Promise<CrmActionResult & { created?: number; skipped?: number }> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "인증이 필요합니다." };
  if (!hasDb()) return { ok: false, error: DB_ERROR };

  const valid = rows.filter((r) => r.name?.trim() && r.parentPhone?.trim());
  const skipped = rows.length - valid.length;
  if (valid.length === 0) {
    return { ok: false, error: "등록할 수 있는 유효한 행이 없습니다(이름·학부모 연락처 필수)." };
  }

  const db = createServiceClient()!;
  const { error } = await db.from("students").insert(
    valid.map((r) => ({
      tenant_id: session.tenantId,
      name: r.name.trim(),
      parent_phone: r.parentPhone.trim(),
      school: r.school?.trim() || null,
      grade: r.grade?.trim() || null,
      class_type: VALID_CLASS_TYPES.includes(r.classType as ClassType)
        ? (r.classType as ClassType)
        : "inperson",
      status: "trial",
    })),
  );
  if (error) {
    console.error("[students] bulk insert failed", error);
    return { ok: false, error: "CSV 일괄 등록 중 오류가 발생했습니다." };
  }

  revalidatePath("/admin/students");
  return { ok: true, created: valid.length, skipped };
}
