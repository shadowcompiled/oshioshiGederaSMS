import { NextRequest, NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/auth";

function redirectHome(req: NextRequest) {
  // 303 so a POST from the logout button lands on the home page as a GET; a
  // 307 would replay the POST against "/".
  return NextResponse.redirect(new URL("/", req.nextUrl.origin), 303);
}

/**
 * True for requests a browser or Next.js makes speculatively — link prefetch,
 * router prefetch, speculation rules. Those must never end a session; see
 * app/LogoutButton.tsx for how one was logging users out.
 */
function isPrefetch(req: NextRequest): boolean {
  const h = req.headers;
  return (
    h.has("next-router-prefetch") ||
    /prefetch/i.test(h.get("purpose") ?? "") ||
    /prefetch/i.test(h.get("sec-purpose") ?? "")
  );
}

// GET still logs out for a typed or bookmarked /api/logout, but not for a
// prefetch. The buttons on the site POST.
export async function GET(req: NextRequest) {
  if (isPrefetch(req)) return new NextResponse(null, { status: 204 });
  await clearAdminSession();
  return redirectHome(req);
}

export async function POST(req: NextRequest) {
  await clearAdminSession();
  return redirectHome(req);
}
