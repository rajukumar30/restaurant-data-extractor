import { NextRequest, NextResponse } from "next/server";

const FIELD_MASK = [
  "id", "displayName", "formattedAddress", "nationalPhoneNumber", "internationalPhoneNumber",
  "websiteUri", "googleMapsUri", "rating", "userRatingCount", "regularOpeningHours",
  "location", "types", "primaryTypeDisplayName", "priceLevel", "businessStatus",
  "photos", "reviews"
].map((field) => `places.${field}`).join(",");

function safeDecode(value: string) {
  try { return decodeURIComponent(value.replace(/\+/g, " ")); }
  catch { return value.replace(/\+/g, " "); }
}

function cleanText(value: string) {
  return safeDecode(value).replace(/\s+/g, " ").trim();
}

async function resolveMapsInput(input: string): Promise<{ query: string; originalUrl: string }> {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Please enter a valid Google Maps URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP or HTTPS Maps links are supported.");
  if (!/(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|(^|\.)googleusercontent\.com$/.test(url.hostname)) {
    throw new Error("Please paste a Google Maps link (maps.app.goo.gl, google.com/maps, or maps.google.com).");
  }

  let resolved = url;
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 PlaceExtract/1.0" }
    });
    resolved = new URL(response.url || url.toString());
  } catch { /* use the original URL when redirect resolution is temporarily unavailable */ }

  if (url.hostname === "maps.app.goo.gl" && resolved.hostname === url.hostname) {
    throw new Error("Google Maps short link could not be expanded. Open the link in Google Maps, choose Share, then copy the full Maps URL and try again.");
  }

  const params = resolved.searchParams;
  let query = params.get("q") || params.get("query") || params.get("destination") || "";

  if (!query) {
    const placePath = resolved.pathname.match(/\/place\/([^/?#]+)/i);
    if (placePath?.[1]) query = placePath[1];
  }

  if (!query) {
    const data = params.get("data") || "";
    const placeMatch = data.match(/!1s([^!]+)/);
    const candidate = placeMatch?.[1] || "";
    if (candidate && !/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(candidate) && !/^[0-9a-f]{20,}$/i.test(candidate)) {
      query = candidate;
    }
  }

  if (!query) {
    const path = safeDecode(resolved.pathname)
      .replace(/\/(maps|data|search|place|preview)\//gi, " ")
      .replace(/@[-\d.,zma]+/gi, " ")
      .replace(/\/(data|search|place)\/?/gi, " ");
    const parts = path.split("/").filter(Boolean).filter(part => !/^(maps|preview)$/i.test(part));
    query = parts.join(" ");
  }

  query = cleanText(query);
  if (!query || query.length < 2 || /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(query)) {
    throw new Error("Could not read a restaurant name from this Maps link. Open the restaurant in Google Maps, tap Share, and copy its full link.");
  }
  return { query, originalUrl: input };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Google Places API key is not configured. Add GOOGLE_MAPS_API_KEY to Vercel Environment Variables and redeploy." }, { status: 503 });

  let query = "";
  try {
    const body = await request.json();
    const mapsUrl = String(body.mapsUrl || "").trim();
    if (!mapsUrl) return NextResponse.json({ error: "A Google Maps URL is required." }, { status: 400 });
    const resolved = await resolveMapsInput(mapsUrl);
    query = resolved.query;

    const searchResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 5, languageCode: "en", regionCode: "IN" }),
      signal: AbortSignal.timeout(15000)
    });

    const searchJson = await searchResponse.json();
    if (!searchResponse.ok) {
      const googleError = searchJson?.error || {};
      const message = googleError.message || "Google Places could not search this restaurant.";
      const diagnostic = {
        status: searchResponse.status,
        code: googleError.code,
        message,
        query,
        details: googleError.details ?? [],
        fieldViolations: (googleError.details ?? []).flatMap((item: any) => item.fieldViolations ?? [])
      };
      console.error("Google Places Text Search failed: " + JSON.stringify(diagnostic));
      return NextResponse.json({
        error: message,
        source: "Google Places API",
        googleStatus: searchResponse.status,
        query,
        details: diagnostic.details,
        fieldViolations: diagnostic.fieldViolations
      }, { status: searchResponse.status });
    }

    const places = searchJson.places || [];
    if (!places.length) return NextResponse.json({ error: "No matching place was found. Try copying the restaurant's full Google Maps URL." }, { status: 404 });

    const normalized = query.toLowerCase();
    const place = places.find((p: any) =>
      normalized.includes((p.displayName?.text || "").toLowerCase()) ||
      (p.displayName?.text || "").toLowerCase().includes(normalized)
    ) || places[0];

    const origin = new URL(request.url).origin;
    const photos = (place.photos || []).map((p: any) => ({
      name: p.name,
      url: `${origin}/api/photo?name=${encodeURIComponent(p.name)}`,
      width: p.widthPx,
      height: p.heightPx,
      attribution: (p.authorAttributions || []).map((a: any) => a.displayName).filter(Boolean),
      source: "Google Places",
      sourceType: "google_places",
      reuseStatus: "google_maps_platform_terms_apply"
    }));
    const reviews = (place.reviews || []).map((r: any) => ({
      rating: r.rating,
      text: r.text?.text || r.originalText?.text || "",
      author: r.authorAttribution?.displayName || "",
      publishedAt: r.publishTime || "",
      relativeTime: r.relativePublishTimeDescription || ""
    }));
    const restaurant = {
      id: place.id || "",
      name: place.displayName?.text || "Unnamed restaurant",
      address: place.formattedAddress || "",
      phone: place.nationalPhoneNumber || place.internationalPhoneNumber || "",
      website: place.websiteUri || "",
      mapsUrl: place.googleMapsUri || resolved.originalUrl,
      rating: place.rating,
      reviewCount: place.userRatingCount,
      hours: place.regularOpeningHours?.weekdayDescriptions || [],
      latitude: place.location?.latitude,
      longitude: place.location?.longitude,
      types: place.types || [],
      priceLevel: place.priceLevel || "",
      businessStatus: place.businessStatus || "",
      photos,
      reviews,
      menu: {
        status: "not_searched",
        sections: [],
        sourceUrls: [],
        notes: [
          "Google Places does not return a complete structured restaurant menu or item prices.",
          "No menu items have been inferred or invented. Use the separate menu search to look for publicly indexed structured menu data."
        ]
      },
      menuNote: "A complete menu is not available from the Google Places response."
    };
    return NextResponse.json({ restaurant, matchedSearch: query }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected extraction error.";
    console.error("Restaurant extraction failed", { message, query, stack: error instanceof Error ? error.stack : undefined });
    return NextResponse.json({ error: message, ...(query ? { query } : {}) }, { status: 400 });
  }
}
