# PlaceExtract — Restaurant Data Extractor

A basic single-restaurant web app. Paste a Google Maps URL, look up the place with Google Places API (New), preview available details/photos/reviews, and download JSON or CSV.

## What it extracts

- Place ID and name
- Formatted address, phone, website and Google Maps URL
- Rating and total rating count
- Opening hours, coordinates, categories and business status
- Up to 10 Google Places photo references displayed through a server-side image proxy
- Optional additional web image discovery through Brave Image Search (results are unverified and displayed in batches)
- Reviews returned by the Places API (Google may return only a limited selection)
- A structured `menu` object in JSON with sections, items, source URLs and notes

## Important limitations

- Places API does **not** provide a complete restaurant menu or menu item prices. The exported JSON includes a structured `menu` object, but its sections are currently empty until a separate authorized menu source or restaurant-provided menu is connected.
- Google Places returns a maximum of 10 photo references per place and a limited selection of reviews, not every photo or every review on Maps.
- The **Load more photos** button uses Brave Image Search when `BRAVE_SEARCH_API_KEY` is configured. It retrieves web image results in a batch and reveals them 10 at a time; it does not fetch photo 11 from Google Places. Search results may depict the wrong business and their reuse rights are not verified. Check the source and permission before using an image on a client website.
- Photos are served through `/api/photo` so the API key remains server-side. The exported photo URLs point to this app, so they work while the app is deployed and the API key is configured; they are not permanent Google image URLs.
- Google Maps short links may not always resolve in server environments. If a short link fails, copy the full place URL from Google Maps and try again.
- Use Google Maps Platform in accordance with its terms, attribution, storage and display requirements. Do not treat the result as a permanent data dump or resell restricted Google content.

## Requirements

- Node.js 20+
- Google Maps Platform project with billing enabled
- Places API (New) enabled
- API key restricted to the Places API (New) service; use suitable server-side restrictions for your hosting environment

## Run locally

1. Clone this repository.
2. Open a terminal in the project folder and run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Set `GOOGLE_MAPS_API_KEY=your_real_key` in `.env.local`.
5. Optionally set `BRAVE_SEARCH_API_KEY=your_brave_key` to enable additional web image discovery.
6. Run `npm run dev`.
6. Open http://localhost:3000.

Never put the key in frontend code or a `NEXT_PUBLIC_` variable.

## Deploy on Vercel

1. Import this GitHub repository into Vercel.
2. In **Project → Settings → Environment Variables**, add:
   - **Name:** `GOOGLE_MAPS_API_KEY`
   - **Value:** your Google Maps Platform API key
   - **Environments:** Production, Preview and Development (as needed)
3. Optionally add **`BRAVE_SEARCH_API_KEY`** with your Brave Search API key to enable the Load more photos feature.
4. Deploy or redeploy the project.

Keep the key server-side. Do not use a `NEXT_PUBLIC_` prefix, and do not commit your real key to GitHub.

## API endpoints

- `POST /api/extract` with JSON body `{ "mapsUrl": "https://maps.app.goo.gl/..." }`
- `GET /api/photo?name=places%2FPLACE_ID%2Fphotos%2FPHOTO_RESOURCE`
- `POST /api/photos/discover` with `{ "name": "Business name", "address": "Business address" }` (requires `BRAVE_SEARCH_API_KEY`)

## Next improvements

1. Add a separate authorized menu source.
2. Add manual Place ID confirmation when multiple similar search results are found.
3. Add CSV columns for one row per photo/review/menu item.
4. Add request quotas, rate limiting and usage monitoring before public deployment.
