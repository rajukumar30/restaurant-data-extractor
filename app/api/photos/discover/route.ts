import { NextRequest, NextResponse } from "next/server";

type SearchResult = { title?: string; url?: string; description?: string };
type ImageResult = {
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
  } catch { return ""; }
}
function hostOf(value?: string) {
  try { return value ? new URL(value).hostname.replace(/^www\./, "").toLowerCase() : ""; }
  catch { return ""; }
}
function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}
function nameTokens(name: string) {
  const ignored = new Set(["the","and","restaurant","restaurants","cafe","cafes","hotel","bar","kitchen","food","shop","india"]);
  return normalize(name).split(/\s+/).filter((token) => token.length > 2 && !ignored.has(token));
}
function locationTokens(address: string) {
  const ignored = new Set(["near","road","rd","street","sector","block","uttar","pradesh","india","pin","hdfc","bank"]);
  return normalize(address).split(/\s+/).filter((token) => token.length > 2 && !ignored.has(token) && !/[0-9]/.test(token));
}
function hasLocationMatch(text: string, tokens: string[]) {
  if (!tokens.length) return true;
  const normalized = normalize(text);
  return tokens.some((token) => normalized.includes(token));
}
function hasBusinessMatch(text: string, tokens: string[]) {
  const normalized = normalize(text);
  return tokens.length > 0 && tokens.every((token) => normalized.includes(token));
}
async function braveSearch(url: string, apiKey: string) {
  const response = await fetch(url, {
    headers: { "Accept": "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(15000)
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.detail || json?.message || `Search provider returned HTTP ${response.status}`);
  return json;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Additional photo discovery is not configured. Add BRAVE_SEARCH_API_KEY to Vercel and redeploy." }, { status: 503 });

  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    if (!name) return NextResponse.json({ error: "Business name is required." }, { status: 400 });

    const tokens = nameTokens(name);
    const locality = locationTokens(address);
    if (!tokens.length) return NextResponse.json({ photos: [], count: 0, notice: "The business name is too generic to verify additional images safely. Use owner-provided photos instead." });

    // First find pages that mention this exact business identity. Only images from these
    // candidate pages, or images whose titles match the business name, are eligible.
    const identityQuery = [`"${name}"`, address].filter(Boolean).join(" ");
    const webParams = new URLSearchParams({ q: identityQuery, country: "IN", search_lang: "en", count: "20" });
    const webJson = await braveSearch(`https://api.search.brave.com/res/v1/web/search?${webParams}`, apiKey);
    const webResults: SearchResult[] = webJson.web?.results || [];
    const matchedHosts = new Set<string>();
    const matchedPages: string[] = [];
    for (const result of webResults) {
      const combined = `${result.title || ""} ${result.description || ""}`;
      if (hasBusinessMatch(combined, tokens) && hasLocationMatch(`${combined} ${result.url || ""}`, locality)) {
        const host = hostOf(result.url);
        if (host) matchedHosts.add(host);
        const sourceUrl = httpsUrl(result.url);
        if (sourceUrl) matchedPages.push(sourceUrl);
      }
    }

    const imageQuery = [`"${name}"`, address, "restaurant"].filter(Boolean).join(" ");
    const imageParams = new URLSearchParams({ q: imageQuery, country: "IN", search_lang: "en", count: "100", safesearch: "strict" });
    const imageJson = await braveSearch(`https://api.search.brave.com/res/v1/images/search?${imageParams}`, apiKey);
    const seen = new Set<string>();
    const photos = ((imageJson.results || []) as ImageResult[]).flatMap((item) => {
      const previewUrl = httpsUrl(item.thumbnail?.src);
      const originalUrl = httpsUrl(item.properties?.url);
      const sourceUrl = httpsUrl(item.url);
      const imageHost = hostOf(sourceUrl);
      const titleMatches = hasBusinessMatch(item.title || "", tokens) && hasLocationMatch(item.title || "", locality);
      const pageMatches = Boolean(imageHost && matchedHosts.has(imageHost));
      // Fail closed: do not show unrelated food stock images just to increase the count.
      if (!titleMatches && !pageMatches) return [];
      const key = originalUrl || previewUrl;
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{
        name: item.title || `Image from ${imageHost}`,
        url: originalUrl || previewUrl,
        previewUrl: previewUrl || originalUrl,
        sourceUrl,
        source: item.source || imageHost || "Web search",
        width: item.properties?.width || item.thumbnail?.width,
        height: item.properties?.height || item.thumbnail?.height,
        confidence: item.confidence || "unknown",
        sourceType: "web_image_search",
        identityMatch: titleMatches ? "business_name_in_image_title" : "business_name_in_source_page",
        reuseStatus: "permission_not_verified"
      }];
    });

    return NextResponse.json({
      source: "Brave Image Search",
      query: imageQuery,
      photos,
      count: photos.length,
      matchedSourcePages: [...new Set(matchedPages)].slice(0, 20),
      notice: photos.length
        ? "Images passed a business-name/source-page relevance filter, but still require visual confirmation and reuse permission."
        : "No additional images could be confidently matched to this exact business. No unrelated images were added. Try a more distinctive business name or provide owner-approved photos."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo discovery failed.";
    console.error("Additional photo discovery failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
