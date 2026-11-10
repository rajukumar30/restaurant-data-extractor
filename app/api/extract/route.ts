import { NextRequest, NextResponse } from "next/server";

const FIELD_MASK = [
  "id", "displayName", "formattedAddress", "nationalPhoneNumber", "internationalPhoneNumber",
  "websiteUri", "googleMapsUri", "rating", "userRatingCount", "regularOpeningHours",
  "location", "types", "primaryTypeDisplayName", "priceLevel", "businessStatus",
  "photos", "reviews"
].join(",");

function cleanText(value: string) {
  return value.replace(/\+/g, " ").replace(/%20/g, " ").replace(/\s+/g, " ").trim();
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
    const response = await fetch(url.toString(), { redirect: "follow", signal: AbortSignal.timeout(9000), headers: { "User-Agent": "Mozilla/5.0 PlaceExtract/1.0" } });
    resolved = new URL(response.url || url.toString());
  } catch { /* use the original short link if redirect resolution is unavailable */ }

  const params = resolved.searchParams;
  let query = params.get("q") || params.get("query") || params.get("destination") || "";
  if (!query) {
    const data = params.get("data") || "";
    const placeMatch = data.match(/!1s([^!]+)/);
    if (placeMatch) query = decodeURIComponent(placeMatch[1].replace(/\+/g, " "));
  }
  if (!query) {
    const path = decodeURIComponent(resolved.pathname).replace(/\/(data|search|place)\//g, " ").replace(/@[-\d.,zma]+/g, " ");
    query = path.split("/").filter(Boolean).join(" ").replace(/\+/g, " ");
  }
  query = cleanText(query);
  if (!query || query.length < 2) throw new Error("Could not identify the restaurant from this link. Try a full Google Maps place URL.");
  return { query, originalUrl: input };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Google Places API key is not configured. Add GOOGLE_MAPS_API_KEY to .env.local and restart the app." }, { status: 503 });
  try {
    const body = await request.json();
    const mapsUrl = String(body.mapsUrl || "").trim();
    if (!mapsUrl) return NextResponse.json({ error: "A Google Maps URL is required." }, { status: 400 });
    const { query, originalUrl } = await resolveMapsInput(mapsUrl);

    const searchResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": `places.${FIELD_MASK}` },
      body: JSON.stringify({ textQuery: query, maxResultCount: 5, languageCode: "en", regionCode: "IN" }),
      signal: AbortSignal.timeout(15000)
    });
    const searchJson = await searchResponse.json();
    if (!searchResponse.ok) {
      const message = searchJson?.error?.message || "Google Places could not search this restaurant.";
      return NextResponse.json({ error: message }, { status: searchResponse.status });
    }
    const places = searchJson.places || [];
    if (!places.length) return NextResponse.json({ error: "No matching place was found. Try copying the restaurant's full Google Maps URL." }, { status: 404 });

    // Prefer a result whose name or address is present in the resolved Maps URL query.
    const normalized = query.toLowerCase();
    const place = places.find((p: any) => normalized.includes((p.displayName?.text || "").toLowerCase()) || (p.displayName?.text || "").toLowerCase().includes(normalized)) || places[0];

    const origin = new URL(request.url).origin;
    const photos = (place.photos || []).map((p: any) => ({
      name: p.name,
      url: `${origin}/api/photo?name=${encodeURIComponent(p.name)}`,
      width: p.widthPx,
      height: p.heightPx,
      attribution: (p.authorAttributions || []).map((a: any) => a.displayName).filter(Boolean)
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
      mapsUrl: place.googleMapsUri || originalUrl,
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
      menuNote: "Google Places does not provide a complete restaurant menu or item prices. Check the restaurant website or an authorized menu source."
    };
    return NextResponse.json({ restaurant, matchedSearch: query }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected extraction error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
