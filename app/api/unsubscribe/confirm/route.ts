import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/security";
import { deactivateByPhone } from "@/lib/unsubscribe";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

/**
 * Performs the removal the unsubscribe page asks about. POST-only, so nothing
 * that merely follows the link in an SMS can take a member off the list.
 *
 * The token is re-verified here rather than trusted from the form: the page
 * having checked it says nothing about this request, which an attacker can
 * craft by hand. Both phone spellings are accepted because older links carry
 * the digits-only form while the row may be stored as +E.164.
 */
export async function POST(req: NextRequest) {
  const home = () => NextResponse.redirect(new URL("/", req.url), 303);

  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "unsubscribe_confirm", LIMITS.unsubscribe.max);
  if (!ok) return home();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return home();
  }

  const phoneRaw = ((formData.get("phone") as string) ?? "").trim();
  const token = ((formData.get("token") as string) ?? "").trim();

  const clean = phoneRaw.replace(/[^\d+]/g, "").slice(0, 20);
  const withPlus = clean.startsWith("+") ? clean : "+" + clean;
  const digitsOnly = clean.replace("+", "");

  if (!token || !digitsOnly) return home();
  if (!verifyToken(withPlus, token) && !verifyToken(digitsOnly, token)) return home();

  try {
    await deactivateByPhone(withPlus);
  } catch (e) {
    console.error("Unsubscribe error:", e);
  }

  // 303 so the browser follows with a GET — a refresh of the "removed" page
  // must not re-submit the form.
  const url = new URL(`/unsubscribe/${digitsOnly}`, req.url);
  url.searchParams.set("token", token);
  url.searchParams.set("done", "1");
  return NextResponse.redirect(url, 303);
}
