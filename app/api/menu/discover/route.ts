import { NextRequest, NextResponse } from "next/server";

type NodeData = Record<string, any>;
type SearchResult = { title?: string; url?: string; description?: string; schemas?: any[] };

function asArray(value: any): any[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function normalize(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim(); }
function businessTokens(name: string) {
  const ignored = new Set(["the","and","restaurant","restaurants","cafe","cafes","hotel","bar","kitchen","food","shop","india"]);
  return normalize(name).split(/\s+/).filter((token) => token.length > 2 && !ignored.has(token));
}
function localityTokens(address: string) {
  const ignored = new Set(["near","road","rd","street","sector","block","noida","uttar","pradesh","india","pin","bank"]);
  return normalize(address).split(/\s+/).filter((token) => token.length > 2 && !ignored.has(token) && !/^\d+$/.test(token));
}
function identityMatches(text: string, nameParts: string[], placeParts: string[]) {
  const normalized = normalize(text);
  const nameMatch = nameParts.length > 0 && nameParts.every((token) => normalized.includes(token));
  const placeMatch = placeParts.length === 0 || placeParts.some((token) => normalized.includes(token));
  return nameMatch && placeMatch;
}
function nodeTypes(node: NodeData): string[] {
  return asArray(node["@type"] || node.type).map((value) => String(value).toLowerCase());
}
function isType(node: NodeData, type: string) {
  return nodeTypes(node).some((value) => value.endsWith(type.toLowerCase()));
}
function textValue(value: any): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") return String(value.name || value.text || value["@id"] || "").trim();
  return "";
}
function collectNodes(input: any, output: NodeData[] = [], seen = new Set<any>()) {
  if (!input || typeof input !== "object" || seen.has(input)) return output;
  seen.add(input);
  if (!Array.isArray(input) && (input["@type"] || input.type)) output.push(input);
  if (Array.isArray(input)) {
    for (const child of input) collectNodes(child, output, seen);
  } else {
    // Walk the entire JSON-LD graph, not just a hard-coded subset of schema properties.
    for (const child of Object.values(input)) collectNodes(child, output, seen);
  }
  return output;
}
function safePublicHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "0.0.0.0" || host === "::1") return null;
    return url;
  } catch { return null; }
}
async function fetchPublicHtml(startUrl: string): Promise<string> {
  let current = safePublicHttpsUrl(startUrl);
  if (!current) return "";
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(current.toString(), {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PlaceExtract/1.0; +https://example.com/bot)", "Accept": "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(9000)
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return "";
      current = safePublicHttpsUrl(new URL(location, current).toString());
      if (!current) return "";
      continue;
    }
    if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) return "";
    const html = await response.text();
    return html.slice(0, 1_500_000);
  }
  return "";
}
function jsonLdFromHtml(html: string): any[] {
  const found: any[] = [];
  const scripts = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const raw = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try { found.push(JSON.parse(raw)); } catch { /* Ignore malformed JSON-LD blocks. */ }
  }
  return found;
}
function priceFields(item: NodeData) {
  const offer = asArray(item.offers || item.offer)[0] || {};
  const raw = offer.price ?? offer.lowPrice ?? item.price;
  if (raw == null || raw === "") return {};
  const number = Number(String(raw).replace(/[^0-9.]/g, ""));
  return {
    ...(Number.isFinite(number) ? { price: number } : {}),
    ...(offer.priceCurrency || item.priceCurrency ? { currency: String(offer.priceCurrency || item.priceCurrency) } : {})
  };
}
function addItem(sectionMap: Map<string, Map<string, any>>, sectionName: string, item: NodeData, sourceUrl: string) {
  const name = textValue(item.name);
  if (!name) return;
  if (!sectionMap.has(sectionName)) sectionMap.set(sectionName, new Map());
  const price = priceFields(item);
  const key = name.toLowerCase() + "|" + String((price as any).price ?? "");
  sectionMap.get(sectionName)!.set(key, {
    name,
    description: textValue(item.description) || null,
    ...price,
    imageUrl: textValue(item.image) || null,
    sourceUrl,
    verified: false
  });
}
function parseSchemas(schemas: any[], sourceUrl: string, sections: Map<string, Map<string, any>>) {
  const nodes = collectNodes(schemas);
  const menuSections = nodes.filter((node) => isType(node, "MenuSection"));
  for (const section of menuSections) {
    const sectionName = textValue(section.name) || "Menu";
    const before = sections.get(sectionName)?.size || 0;
    const items = collectNodes(section.hasMenuItem || section.itemListElement || []);
    const direct = asArray(section.hasMenuItem || section.itemListElement);
    for (const entry of direct) {
      const item = entry?.item || entry;
      if (item && typeof item === "object" && isType(item, "MenuItem")) addItem(sections, sectionName, item, sourceUrl);
    }
    // Some publishers omit @type on nested item nodes but retain name and offers.
    if (!direct.length) for (const item of items) if (isType(item, "MenuItem")) addItem(sections, sectionName, item, sourceUrl);
    void before;
  }
  if (!menuSections.length) {
    for (const item of nodes.filter((node) => isType(node, "MenuItem"))) addItem(sections, "Menu items", item, sourceUrl);
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Menu discovery is not configured. Add BRAVE_SEARCH_API_KEY to Vercel Environment Variables and redeploy." }, { status: 503 });

  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    if (!name) return NextResponse.json({ error: "Business name is required." }, { status: 400 });

    const queries = [
      [`"${name}"`, address, "menu"].filter(Boolean).join(" "),
      [`"${name}"`, address, "food menu price list dishes"].filter(Boolean).join(" "),
      [`"${name}"`, address, "filetype:pdf menu"].filter(Boolean).join(" ")
    ];
    const allResults: SearchResult[] = [];
    for (const query of queries) {
      const params = new URLSearchParams({ q: query, country: "IN", search_lang: "en", count: "20" });
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
        headers: { "Accept": "application/json", "X-Subscription-Token": apiKey },
        signal: AbortSignal.timeout(15000)
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.detail || json?.message || `Menu search returned HTTP ${response.status}`);
      allResults.push(...(json.web?.results || []));
    }

    const uniqueResults = [...new Map(allResults.filter((r) => r.url).map((r) => [r.url, r])).values()];
    const nameParts = businessTokens(name);
    const placeParts = localityTokens(address);
    const candidateResults = uniqueResults.filter((r) => {
      const identity = `${r.title || ""} ${r.description || ""} ${r.url || ""}`;
      return identityMatches(identity, nameParts, placeParts) &&
        /menu|food|dish|order|restaurant|cuisine|pdf/i.test(identity);
    }).slice(0, 12);
    const sections = new Map<string, Map<string, any>>();
    const sourceUrls: string[] = [];
    let fetchedPages = 0;

    for (const page of candidateResults) {
      const sourceUrl = String(page.url || "");
      const safeUrl = safePublicHttpsUrl(sourceUrl);
      if (!safeUrl) continue;
      sourceUrls.push(safeUrl.toString());
      // Brave may expose extracted Schema.org data directly on web results.
      parseSchemas(page.schemas || [], safeUrl.toString(), sections);
      // Also inspect the public page's JSON-LD. Search result objects do not contain
      // the complete page schema, so relying on page.schemas alone misses many menus.
      try {
        const html = await fetchPublicHtml(safeUrl.toString());
        if (html) {
          fetchedPages++;
          parseSchemas(jsonLdFromHtml(html), safeUrl.toString(), sections);
        }
      } catch {
        // Some publishers block automated requests. Keep the source link for manual review.
      }
    }

    const menuSections = [...sections.entries()].map(([sectionName, items]) => ({
      name: sectionName,
      items: [...items.values()]
    }));
    const itemCount = menuSections.reduce((count, section) => count + section.items.length, 0);
    const uniqueSources = [...new Set(sourceUrls)];
    return NextResponse.json({
      menu: {
        status: itemCount > 0 ? "partial" : "not_found",
        sections: menuSections,
        sourceUrls: uniqueSources,
        notes: itemCount > 0
          ? ["Menu items were extracted from structured data on public search-result pages. Results are unverified; confirm menu items and current prices with the business."]
          : ["No machine-readable menu items were found in the accessible public pages. This does not mean the restaurant has no menu.", "Open the candidate source links or provide a menu photo/PDF for OCR. Menu image/PDF OCR is not included in this version."]
      },
      searchedSources: uniqueSources.length,
      fetchedPages,
      itemCount,
      queries
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Menu discovery failed.";
    console.error("Menu discovery failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
