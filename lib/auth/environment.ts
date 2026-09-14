type AuthEnvironment = { NODE_ENV?: string; VERCEL_ENV?: string; AUTH_DEV_MODE?: string; AUTH_SECRET?: string };

export function isProductionAuth(env: AuthEnvironment = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

export function devOtpEnabled(env: AuthEnvironment = process.env): boolean {
  return !isProductionAuth(env) && env.AUTH_DEV_MODE === "true";
}

export function assertProductionAuth(env: AuthEnvironment = process.env): void {
  if (!isProductionAuth(env)) return;
  if (env.AUTH_DEV_MODE === "true") throw new Error("운영 환경에서는 AUTH_DEV_MODE를 사용할 수 없습니다.");
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || env.AUTH_SECRET === "dev-only-secret-change-me") {
    throw new Error("운영 AUTH_SECRET은 32자 이상의 무작위 값이어야 합니다.");
  }
}
