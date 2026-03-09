import { headers } from "next/headers";

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const real = h.get("x-real-ip");
  if (forwarded) return forwarded.split(",")[0].trim();
  if (real) return real;
  return "127.0.0.1";
}
