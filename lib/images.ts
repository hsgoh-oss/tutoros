import sharp from "sharp";

// 서버 전용 — 이미지 업로드 시 WebP로 변환한다(기획 7-7 "형식 자동 변환").
// 변환 실패(손상 파일·미지원 등) 시 null을 반환하고 호출부가 원본을 그대로 저장한다(graceful).

export interface WebpResult {
  buffer: Buffer;
  ext: "webp";
  contentType: "image/webp";
}

export async function toWebp(file: File): Promise<WebpResult | null> {
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const buffer = await sharp(input).webp({ quality: 82 }).toBuffer();
    return { buffer, ext: "webp", contentType: "image/webp" };
  } catch (e) {
    console.error("[images] webp 변환 실패 — 원본 유지", e);
    return null;
  }
}
