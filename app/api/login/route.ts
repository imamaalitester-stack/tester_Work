import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface AttemptRecord {
  count: number;
  firstAttempt: number;
}

const attemptsByKey = new Map<string, AttemptRecord>();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

function isRateLimited(key: string): boolean {
  const record = attemptsByKey.get(key);
  if (!record) return false;
  if (Date.now() - record.firstAttempt > WINDOW_MS) {
    attemptsByKey.delete(key);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordAttempt(key: string) {
  const record = attemptsByKey.get(key);
  if (!record || Date.now() - record.firstAttempt > WINDOW_MS) {
    attemptsByKey.set(key, { count: 1, firstAttempt: Date.now() });
  } else {
    record.count += 1;
  }
}

export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const { email, password } = await request.json();

  const ip = getClientIp(request);
  const emailKey = `email:${String(email).toLowerCase()}`;
  const ipKey = `ip:${ip}`;

  if (isRateLimited(emailKey) || isRateLimited(ipKey)) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, email, full_name")
    .eq("email", email)
    .single();

  if (error || !data) {
    recordAttempt(emailKey);
    recordAttempt(ipKey);
    return NextResponse.json({ error: "No such account" }, { status: 401 });
  }

  if (password !== "shopflow") {
    recordAttempt(emailKey);
    recordAttempt(ipKey);
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  attemptsByKey.delete(emailKey);
  attemptsByKey.delete(ipKey);

  return NextResponse.json({ user: data });
}
