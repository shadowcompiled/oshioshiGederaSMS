import { NextRequest, NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/auth";

function redirectHome(req: NextRequest) {
  return NextResponse.redirect(new URL("/", req.nextUrl.origin));
}

export async function GET(req: NextRequest) {
  await clearAdminSession();
  return redirectHome(req);
}

export async function POST(req: NextRequest) {
  await clearAdminSession();
  return redirectHome(req);
}
