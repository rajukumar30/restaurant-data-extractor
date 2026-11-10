import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const name = request.nextUrl.searchParams.get("name");
  if (!apiKey || !name || !name.startsWith("places/")) {
    return new Response("Missing or invalid photo reference.", { status: 400 });
  }
  try {
    const upstream = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&key=${encodeURIComponent(apiKey)}`, {
      redirect: "follow", signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) return new Response("Photo unavailable.", { status: upstream.status });
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    return new Response(upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return new Response("Could not retrieve photo.", { status: 502 });
  }
}
