import { NextRequest, NextResponse } from "next/server";

type SchemaNode = Record<string, any>;

function values(value: any): any[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function typeNames(node: SchemaNode): string[] {
  return values(node["@type"] || node.type).map((value) => String(value).toLowerCase());
}

function isType(node: SchemaNode, expected: string) {
  return typeNames(node).some((value) => value.endsWith(expected.toLowerCase()));
}

function textValue(value: any): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.name || value.text || "").trim();
  return "";
}

function collectNodes(input: any, output: SchemaNode[] = [], seen = new Set<any>()) {
  if (!input || typeof input !== "object" || seen.has(input)) return output;
  seen.add(input);
  if (!Array.isArray(input) && (input["@type"] || input.type)) output.push(input);
  if (Array.isArray(input)) {
    for (const item of input) collectNodes(item, output, seen);
  } else {
    for (const [key, value] of Object.entries(input)) {
      if (key === "hasMenu" || key === "hasMenuSection" || key === "hasMenuItem" || key === "menu" || key === "@graph" || key === "mainEntity" || key === "itemListElement") {
        collectNodes(value, output, seen);
      }
    }
  }
  return output;
}

function extractPrice(item: SchemaNode): { price?: number; currency?: string } {
  const offers = values(item.offers || item.offer)[0] || {};
  const raw = offers.price ?? offers.lowPrice ?? item.price;
  if (raw == null || raw === "") return {};
  const numeric = Number(String(raw).replace(/[^0-9.]/g, ""));
  return {
    ...(Number.isFinite(numeric) ? { price: numeric } : {}),
    ...(offers.priceCurrency || item.priceCurrency ? { currency: String(offers.priceCurrency || item.priceCurrency) } : {})
  };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "Menu discovery is not configured. Add BRAVE_SEARCH_API_KEY to Vercel Environment Variables and redeploy."
    }, { status: 503 });
  }

  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    if (!name) return NextResponse.json({ error: "Business name is required." }, { status: 400 });

    const query = [`"${name}"`, address, "restaurant menu dishes prices menu PDF"].filter(Boolean).join(" ").slice(0, 600);
    const response = await fetch("https://api.search.brave.com/res/v1/web/search", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Subscription-Token": apiKey
      },
      body: JSON.stringify({
        q: query,
        country: "IN",
        search_lang: "en",
        count: 20,
        safesearch: "strict",
        result_filter: ["web"]
      }),
      signal: AbortSignal.timeout(20000)
    });

    const result = await response.json();
    if (!response.ok) {
      const message = result?.error?.detail || result?.message || "Menu search provider returned an error.";
      console.error("Brave menu search failed", { status: response.status, message });
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const results = result.web?.results || [];
    const sourceUrls: string[] = [];
    const sections = new Map<string, Map<string, any>>();

    for (const page of results) {
      const sourceUrl = typeof page.url === "string" && page.url.startsWith("https://") ? page.url : "";
      if (!sourceUrl) continue;
      const titleAndDescription = `${page.title || ""} ${page.description || ""}`.toLowerCase();
      const looksMenuRelated = /menu|food|dish|price|order|restaurant|cuisine/.test(titleAndDescription) || sourceUrl.toLowerCase().includes("menu");
      if (looksMenuRelated) sourceUrls.push(sourceUrl);

      const schemas = collectNodes(page.schemas || []);
      const menuSections = schemas.filter((node) => isType(node, "MenuSection"));
      const menuItems = schemas.filter((node) => isType(node, "MenuItem"));

      for (const section of menuSections) {
        const sectionName = textValue(section.name) || "Menu";
        if (!sections.has(sectionName)) sections.set(sectionName, new Map());
        const sectionItems = values(section.hasMenuItem || section.itemListElement);
        for (const entry of sectionItems) {
          const item = entry.item || entry;
          if (!item || typeof item !== "object") continue;
          const itemName = textValue(item.name);
          if (!itemName) continue;
          const price = extractPrice(item);
          const key = `${itemName.toLowerCase()}|${price.price ?? ""}`;
          sections.get(sectionName)!.set(key, {
            name: itemName,
            description: textValue(item.description) || null,
            ...price,
            imageUrl: textValue(item.image) || null,
            sourceUrl,
            verified: false
          });
        }
      }

      if (menuSections.length === 0 && menuItems.length > 0) {
        if (!sections.has("Menu items")) sections.set("Menu items", new Map());
        for (const item of menuItems) {
          const itemName = textValue(item.name);
          if (!itemName) continue;
          const price = extractPrice(item);
          const key = `${itemName.toLowerCase()}|${price.price ?? ""}`;
          sections.get("Menu items")!.set(key, {
            name: itemName,
            description: textValue(item.description) || null,
            ...price,
            imageUrl: textValue(item.image) || null,
            sourceUrl,
            verified: false
          });
        }
      }
    }

    const menu = [...sections.entries()].map(([sectionName, items]) => ({
      name: sectionName,
      items: [...items.values()]
    }));
    const itemCount = menu.reduce((count, section) => count + section.items.length, 0);
    const uniqueSources = [...new Set(sourceUrls)];

    return NextResponse.json({
      menu: {
        status: itemCount > 0 ? "partial" : "not_found",
        sections: menu,
        sourceUrls: uniqueSources,
        notes: itemCount > 0
          ? ["Menu items were extracted from structured data on public search-result pages.", "Items are unverified. Confirm the business identity and current prices with the business before publishing."]
          : ["No machine-readable menu items were found in the returned public search results.", "Candidate source links are included when available. Upload a menu image or PDF for OCR to extract items that are not published as structured data."]
      },
      searchedSources: uniqueSources.length,
      itemCount,
      query
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Menu discovery failed.";
    console.error("Menu discovery failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
