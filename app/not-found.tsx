import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm font-extrabold tracking-tight text-brand-600">
        404 NOT FOUND
      </p>
      <h1 className="text-3xl font-black tracking-[-0.04em] md:text-4xl">
        페이지를 찾을 수 없습니다
      </h1>
      <p className="text-[15px] leading-relaxed text-muted">
        주소가 바뀌었거나 삭제된 페이지입니다.
        <br />
        아래 버튼으로 메인으로 돌아가실 수 있습니다.
      </p>
      <Link href="/" className={buttonClass("primary", "md")}>
        메인으로 돌아가기
      </Link>
    </div>
  );
}
