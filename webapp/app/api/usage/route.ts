import { NextRequest, NextResponse } from "next/server";
import { hourly, dailyAverages } from "@/lib/history";

/**
 * Usage history for one charging location, from the pipeline's history.db.
 *
 *   GET /api/usage?loc=<locationId>&range=24h|7d|30d|1y
 *
 * 24h/7d/30d -> { range, days: [{ date, occ: [24 x %|null] }] }
 * 1y         -> { range, daily: { "YYYY-MM-DD": avg% } }
 *
 * Replaces fetching whole per-gemeente day files client-side (up to 30 files of
 * every location in the gemeente just to plot one location).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES = { "24h": 1, "7d": 7, "30d": 30, "1y": 365 } as const;
type Range = keyof typeof RANGES;

function amsterdamToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: NextRequest) {
  const loc = request.nextUrl.searchParams.get("loc");
  const range = (request.nextUrl.searchParams.get("range") ?? "24h") as Range;
  if (!loc || loc.length > 200 || !(range in RANGES)) {
    return NextResponse.json({ error: "expected ?loc=<locationId>&range=24h|7d|30d|1y" }, { status: 400 });
  }

  const today = amsterdamToday();
  const body =
    range === "1y"
      ? { range, daily: dailyAverages(loc, today, RANGES[range]) }
      : { range, days: hourly(loc, today, RANGES[range]) };

  // New samples land hourly; a few minutes of caching is plenty.
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
  });
}
