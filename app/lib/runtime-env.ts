export type RuntimeEnv = {
  DB: any;
  UPLOADS: any;
  ADMIN_EMAILS?: string;
};

let cachedEnv: RuntimeEnv | null = null;

export async function getRuntimeEnv(): Promise<RuntimeEnv> {
  if (cachedEnv) return cachedEnv;
  const workers = await import("cloudflare:workers");
  cachedEnv = workers.env as RuntimeEnv;
  return cachedEnv;
}
