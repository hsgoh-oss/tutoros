import Image from "next/image";

const ITEMS = [
  { src: "/img/thumb-score-real.jpg", caption: "성적 증빙 자료" },
  { src: "/img/thumb-card-real.jpg", caption: "튜터 인증 자료" },
  { src: "/img/thumb-profile.jpg", caption: "프로필 사진" },
] as const;

export function ProofGallery() {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {ITEMS.map((item) => (
        <figure
          key={item.src}
          className="overflow-hidden rounded-card border border-line bg-white shadow-card"
        >
          <Image
            src={item.src}
            alt={item.caption}
            width={440}
            height={440}
            className="aspect-square w-full object-cover"
          />
          <figcaption className="p-4 text-center text-sm font-bold tracking-tight text-muted">
            {item.caption}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
