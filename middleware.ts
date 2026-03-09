import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optional: add security headers in production (similar to Flask-Talisman)
export function middleware(req: NextRequest) {
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
