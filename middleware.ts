import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Rewrite POST /login to /api/login so form action="/login" or stray POSTs don't hit the page (Server Action error)
export function middleware(req: NextRequest) {
  if (req.method === "POST" && req.nextUrl.pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/api/login";
    return NextResponse.rewrite(url);
  }

  const res = NextResponse.next();
  if (process.env.NODE_ENV === "production") {
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("X-XSS-Protection", "1; mode=block");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp)$).*)"],
};
