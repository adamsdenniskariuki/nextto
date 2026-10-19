import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** POST-only so a stray <img src="/auth/signout"> can't log people out. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303 turns the POST into a GET for the redirect target.
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
}
