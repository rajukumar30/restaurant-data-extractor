# PlaceExtract — Restaurant Data Extractor

A basic single-restaurant web app. Paste a Google Maps URL, look up the place with Google Places API (New), preview available details/photos/reviews, and download JSON or CSV.

## What it extracts

- Place ID and name
- Formatted address, phone, website and Google Maps URL
- Rating and total rating count
- Opening hours, coordinates, categories and business status
- Photo references displayed through a server-side image proxy
- Reviews returned by the Places API (Google may return only a limited selection)

## Important limitations

- Places API does **not** provide a complete restaurant menu or menu item prices. The app explains this and links to the business website when one is listed. Menu data would need a separate authorized source or a restaurant-provided menu.
- Google Places returns a limited set of photos and reviews, not every photo or every review on Maps.
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
5. Run `npm run dev`.
6. Open http://localhost:3000.

Never put the key in frontend code or a `NEXT_PUBLIC_` variable.

## Deploy on Vercel

1. Import this GitHub repository into Vercel.
2. In **Project → Settings → Environment Variables**, add:
   - **Name:** `GOOGLE_MAPS_API_KEY`
   - **Value:** your Google Maps Platform API key
   - **Environments:** Production, Preview and Development (as needed)
3. Deploy or redeploy the project.

Keep the key server-side. Do not use a `NEXT_PUBLIC_` prefix, and do not commit your real key to GitHub.

## API endpoints

- `POST /api/extract` with JSON body `{ "mapsUrl": "https://maps.app.goo.gl/..." }`
- `GET /api/photo?name=places%2FPLACE_ID%2Fphotos%2FPHOTO_RESOURCE`

## Next improvements

1. Add a separate authorized menu source.
2. Add manual Place ID confirmation when multiple similar search results are found.
3. Add CSV columns for one row per photo/review/menu item.
4. Add request quotas, rate limiting and usage monitoring before public deployment.
