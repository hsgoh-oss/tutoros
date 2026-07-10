// lib/notify/solapi.ts의 defaultChannel()과 동일 로직의 Deno 버전(Deno.env 사용).

export function defaultChannel(): "alimtalk" | "sms" {
  return Deno.env.get("SOLAPI_KAKAO_CHANNEL_ID") ? "alimtalk" : "sms";
}
