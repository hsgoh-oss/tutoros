"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { convertToStudent } from "./actions";

// 학생 전환은 성공 시 새로 생성된 학생 id로 이동해야 해서 ActionButton의 고정 redirectTo로는
// 표현이 안 돼 이 모듈 전용 클라이언트 버튼으로 분리.
export function ConvertButton({ consultationId }: { consultationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        if (!window.confirm("이 상담을 학생으로 전환하시겠습니까?")) return;
        setPending(true);
        const result = await convertToStudent(consultationId);
        setPending(false);
        if (result.ok && result.studentId) {
          router.push(`/admin/students/${result.studentId}`);
        } else {
          window.alert(result.error ?? "전환에 실패했습니다.");
        }
      }}
      className={buttonClass("primary", "sm")}
    >
      {pending ? "전환 중..." : "학생으로 전환"}
    </button>
  );
}
