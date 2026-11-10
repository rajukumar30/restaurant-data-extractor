import { NextRequest, NextResponse } from "next/server";

type BraveImageResult = {
  title?: string;
  url?: string;
  source?: string;
  thumbnail?: { src?: string; width?: number; height?: number };
  properties?: { url?: string; width?: number; height?: number };
  confidence?: string;
};

function httpsUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "Additional photo discovery is not configured. Add BRAVE_SEARCH_API_KEY to your Vercel Environment Variables and redeploy."
    }, { status: 503 });
  }

  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    if (!name) return NextResponse.json({ error: "Business name is required." }, { status: 400 });

    const query = [name, address, "restaurant food interior exterior photos"].filter(Boolean).join(" ").slice(0, 400);
    const params = new URLSearchParams({
      q: query,
      country: "IN",
      search_lang: "en",
      count: "100",
      safesearch: "strict"
    });

    const response = await fetch(`https://api.search.brave.com/res/v1/images/search?${params.toString()}`, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey
      },
      signal: AbortSignal.timeout(20000)
    });

    const result = await response.json();
    if (!response.ok) {
      const message = result?.error?.detail || result?.message || "Image search provider returned an error.";
      console.error("Brave image search failed", { status: response.status, message });
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const seen = new Set<string>();
    const photos = ((result.results || []) as BraveImageResult[]).map((item) => {
      const previewUrl = httpsUrl(item.thumbnail?.src);
      const originalUrl = httpsUrl(item.properties?.url);
      const sourceUrl = httpsUrl(item.url);
      const key = originalUrl || previewUrl;
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return {
        name: item.title || "Web image result",
        url: originalUrl || previewUrl,
        previewUrl: previewUrl || originalUrl,
        sourceUrl,
        source: item.source || (sourceUrl ? new URL(sourceUrl).hostname : "Web search"),
        width: item.properties?.width || item.thumbnail?.width,
        height: item.properties?.height || item.thumbnail?.height,
        confidence: item.confidence || "unknown",
        sourceType: "web_image_search",
        reuseStatus: "permission_not_verified"
      };
    }).filter(Boolean);

    return NextResponse.json({
      source: "Brave Image Search",
      query,
      photos,
      count: photos.length,
      notice: "Search results are unverified. Check that each image depicts this business and that you have permission to reuse it before publishing."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo discovery failed.";
    console.error("Additional photo discovery failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
