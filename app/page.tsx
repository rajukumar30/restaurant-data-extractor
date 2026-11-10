"use client";

import { useMemo, useState } from "react";
import { Search, MapPin, Star, Clock3, Phone, Globe, Camera, MessageSquareText, Utensils, Download, Copy, ExternalLink, Loader2, AlertCircle, CheckCircle2, FileSpreadsheet, Link2, Plus, BookOpen } from "lucide-react";

type Restaurant = {
  id: string; name: string; address?: string; phone?: string; website?: string;
  mapsUrl?: string; rating?: number; reviewCount?: number; hours: string[];
  latitude?: number; longitude?: number; types: string[]; priceLevel?: string;
  photos: { name: string; url: string; previewUrl?: string; sourceUrl?: string; source?: string; sourceType?: string; reuseStatus?: string; confidence?: string; width?: number; height?: number; attribution?: string[] }[];
  reviews: { rating?: number; text?: string; author?: string; publishedAt?: string; relativeTime?: string }[];
  menu: {
    status: "not_available_from_places_api" | "not_searched" | "not_found" | "partial" | "found";
    sections: { name: string; items: { name: string; description?: string | null; price?: number | null; currency?: string; imageUrl?: string | null; sourceUrl?: string | null; verified?: boolean }[] }[];
    sourceUrls: string[];
    notes: string[];
  };
  menuNote: string;
  businessStatus?: string;
};

export default function Home() {
  const [mapsUrl, setMapsUrl] = useState("");
  const [data, setData] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [copied, setCopied] = useState(false);
  const [discoveredPhotos, setDiscoveredPhotos] = useState<Restaurant["photos"]>([]);
  const [visibleExtraCount, setVisibleExtraCount] = useState(0);
  const [photoSearchDone, setPhotoSearchDone] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState("");

  const extract = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setData(null); setDiscoveredPhotos([]); setVisibleExtraCount(0); setPhotoSearchDone(false); setPhotoError(""); setMenuError("");
    if (!mapsUrl.trim()) { setError("Paste a Google Maps restaurant link first."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapsUrl: mapsUrl.trim() }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extraction failed.");
      setData(json.restaurant);
      setTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setLoading(false); }
  };

  const allPhotos = useMemo(() => [...(data?.photos || []), ...discoveredPhotos], [data, discoveredPhotos]);
  const visiblePhotos = useMemo(() => [...(data?.photos || []), ...discoveredPhotos.slice(0, visibleExtraCount)], [data, discoveredPhotos, visibleExtraCount]);
  const jsonText = useMemo(() => data ? JSON.stringify({ ...data, photos: allPhotos }, null, 2) : "", [data, allPhotos]);

  const loadMorePhotos = async () => {
    if (!data || photoLoading) return;
    setPhotoError("");
    if (photoSearchDone) {
      setVisibleExtraCount((count) => Math.min(count + 10, discoveredPhotos.length));
      return;
    }
    setPhotoLoading(true);
    try {
      const response = await fetch("/api/photos/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name, address: data.address })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not discover additional photos.");
      const existing = new Set(data.photos.map((photo) => photo.url));
      const unique = (result.photos || []).filter((photo: Restaurant["photos"][number]) => photo.url && !existing.has(photo.url));
      setDiscoveredPhotos(unique);
      setVisibleExtraCount(Math.min(10, unique.length));
      setPhotoSearchDone(true);
      if (!unique.length) setPhotoError("No additional matching images were found. Try again after checking the business name and location.");
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Additional photo search failed.");
    } finally {
      setPhotoLoading(false);
    }
  };
  const searchMenu = async () => {
    if (!data || menuLoading) return;
    setMenuLoading(true);
    setMenuError("");
    try {
      const response = await fetch("/api/menu/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name, address: data.address })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Menu search failed.");
      setData((current) => current ? {
        ...current,
        menu: result.menu,
        menuNote: result.menu.notes.join(" ")
      } : current);
    } catch (err) {
      setMenuError(err instanceof Error ? err.message : "Menu search failed.");
    } finally {
      setMenuLoading(false);
    }
  };

  const download = (kind: "json" | "csv") => {
    if (!data) return;
    let content = jsonText, mime = "application/json", filename = `${slug(data.name)}-restaurant-data.json`;
    if (kind === "csv") {
      const rows = [
        ["field", "value"], ["name", data.name], ["place_id", data.id], ["address", data.address || ""],
        ["phone", data.phone || ""], ["website", data.website || ""], ["rating", data.rating ?? ""],
        ["review_count", data.reviewCount ?? ""], ["google_maps_url", data.mapsUrl || ""],
        ["latitude", data.latitude ?? ""], ["longitude", data.longitude ?? ""],
        ["opening_hours", (data.hours || []).join(" | ")], ["categories", (data.types || []).join(", ")],
        ["photo_urls", allPhotos.map(p => p.url).join(" | ")],
        ["reviews", data.reviews.map(r => `${r.rating ?? ""}/5 ${r.author || ""}: ${r.text || ""}`).join(" | ")],
        ["menu_note", data.menuNote]
      ];
      content = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      mime = "text/csv;charset=utf-8"; filename = `${slug(data.name)}-restaurant-data.csv`;
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  };
  const copyJson = async () => { if (!jsonText) return; await navigator.clipboard.writeText(jsonText); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-icon"><MapPin size={19}/></span><span>Place<span className="brand-accent">Extract</span></span></a>
        <span className="top-note"><span className="status-dot"/> Google Places powered</span>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-line"/> RESTAURANT DATA TOOL</div>
        <h1>Turn a Maps link into<br/><span>structured restaurant data.</span></h1>
        <p className="hero-copy">Collect business details, available photos, reviews and structured menu data. Preview everything, then download it as JSON or CSV.</p>
        <form className="search-card" onSubmit={extract}>
          <label htmlFor="maps-url">GOOGLE MAPS RESTAURANT URL</label>
          <div className="input-row">
            <Link2 size={19} className="input-icon"/>
            <input id="maps-url" value={mapsUrl} onChange={e => setMapsUrl(e.target.value)} placeholder="https://maps.app.goo.gl/..." />
            <button className="extract-btn" disabled={loading}>{loading ? <><Loader2 size={17} className="spin"/> Extracting</> : <><Search size={17}/> Extract details</>}</button>
          </div>
          <div className="search-foot"><span><CheckCircle2 size={14}/> One restaurant per extraction</span><span>Short and full Maps links supported</span></div>
        </form>
        {error && <div className="error"><AlertCircle size={17}/>{error}</div>}
      </section>

      {!data && !loading && <section className="empty-state">
        <div className="empty-art"><div className="art-pin"><MapPin size={32}/></div><div className="art-card art-card-one"><Star size={13} fill="currentColor"/> 4.5</div><div className="art-card art-card-two"><Camera size={15}/> Photos</div></div>
        <h2>Your restaurant report will appear here</h2>
        <p>Paste a restaurant's Google Maps URL above to get started.</p>
        <div className="feature-row"><span><MapPin size={15}/> Business details</span><span><Camera size={15}/> Photo links</span><span><MessageSquareText size={15}/> Reviews</span></div>
      </section>}

      {loading && <div className="loading-panel"><Loader2 className="spin" size={25}/><b>Finding restaurant information…</b><span>This can take a few seconds.</span></div>}

      {data && <section className="results">
        <div className="result-heading"><div><div className="eyebrow">EXTRACTION COMPLETE</div><h2>Your restaurant report</h2><p>Review the available data and export what you need.</p></div>
          <div className="export-actions"><button className="secondary-btn" onClick={copyJson}><Copy size={15}/>{copied ? "Copied" : "Copy JSON"}</button><button className="primary-btn" onClick={() => download("json")}><Download size={15}/> JSON</button><button className="primary-btn dark-btn" onClick={() => download("csv")}><FileSpreadsheet size={15}/> CSV</button></div>
        </div>
        <div className="restaurant-card">
          <div className="restaurant-main"><div className="restaurant-symbol"><Utensils size={24}/></div><div><h3>{data.name}</h3><p>{data.address || "Address not available"}</p><div className="meta-pills">{data.rating != null && <span className="rating-pill"><Star size={14} fill="currentColor"/> {data.rating.toFixed(1)} {data.reviewCount != null ? `· ${data.reviewCount.toLocaleString()} reviews` : ""}</span>}<span className="neutral-pill">{data.businessStatus || "Business status unavailable"}</span></div></div></div>
          <a className="map-link" href={data.mapsUrl || mapsUrl} target="_blank" rel="noreferrer">Open Maps <ExternalLink size={14}/></a>
        </div>
        <nav className="tabs">
          {[["overview","Overview"],["photos",`Photos (${allPhotos.length})`],["menu",`Menu (${data.menu.sections.reduce((n, section) => n + section.items.length, 0)})`],["reviews",`Reviews (${data.reviews.length})`],["json","Raw JSON"]].map(([id,label]) => <button key={id} className={tab===id?"tab active":"tab"} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        {tab === "overview" && <div className="detail-grid">
          <div className="detail-card"><div className="detail-title"><Phone size={16}/> Contact</div><p>{data.phone || "Not listed"}</p><div className="detail-title sub"><Globe size={16}/> Website</div>{data.website ? <a href={data.website} target="_blank" rel="noreferrer">{data.website}</a> : <p>Not listed</p>}</div>
          <div className="detail-card"><div className="detail-title"><Clock3 size={16}/> Opening hours</div>{data.hours.length ? <ul className="hours-list">{data.hours.map((h,i)=><li key={i}>{h}</li>)}</ul> : <p>Hours not available</p>}</div>
          <div className="detail-card"><div className="detail-title"><MapPin size={16}/> Location & categories</div><p>{data.latitude != null && data.longitude != null ? `${data.latitude}, ${data.longitude}` : "Coordinates not available"}</p><div className="tags">{data.types.length ? data.types.map(t=><span key={t}>{t.replaceAll("_"," ")}</span>) : <span>Categories unavailable</span>}</div></div>
          <div className="detail-card"><div className="detail-title"><Utensils size={16}/> Menu availability</div><p>{data.menu.notes.join(" ") || data.menuNote}</p>{data.menu.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url} <ExternalLink size={13}/></a>)}{data.website && <a href={data.website} target="_blank" rel="noreferrer">Check restaurant website <ExternalLink size={13}/></a>}</div>
        </div>}
        {tab === "photos" && <><div className="photo-grid">{visiblePhotos.length ? visiblePhotos.map((p,i)=><div className="photo-card" key={p.url}><img src={p.previewUrl || p.url} alt={p.name || `${data.name} photo ${i+1}`}/><div><span>{p.source || (p.sourceType === "web_image_search" ? "Web image" : "Google Places")}</span><button onClick={() => navigator.clipboard.writeText(p.url)}><Copy size={13}/> Copy URL</button></div>{p.sourceUrl && <a className="photo-source" href={p.sourceUrl} target="_blank" rel="noreferrer">View source <ExternalLink size={12}/></a>}</div>) : <div className="no-data">No public photos were returned for this listing.</div>}</div><div className="photo-more"><button className="secondary-btn" onClick={loadMorePhotos} disabled={photoLoading || (photoSearchDone && visibleExtraCount >= discoveredPhotos.length)}>{photoLoading ? <><Loader2 size={15} className="spin"/> Searching images</> : photoSearchDone ? visibleExtraCount < discoveredPhotos.length ? <><Plus size={15}/> Show 10 more photos</> : "All discovered photos loaded" : <><Plus size={15}/> Load more photos</>}</button><p>Google Places photos are limited to 10. Additional results come from web image search and must be checked for business match and reuse permission.</p>{photoError && <div className="photo-error"><AlertCircle size={14}/>{photoError}</div>}</div></>}
        {tab === "menu" && <div className="menu-panel"><div className="menu-panel-heading"><div><div className="detail-title"><BookOpen size={16}/> Structured menu data</div><p>Search public pages for machine-readable menu items and prices. Results are unverified until checked with the business.</p></div><button className="secondary-btn" onClick={searchMenu} disabled={menuLoading}>{menuLoading ? <><Loader2 size={15} className="spin"/> Searching menu</> : "Search menu online"}</button></div>{menuError && <div className="photo-error"><AlertCircle size={14}/>{menuError}</div>}{data.menu.sections.length ? data.menu.sections.map((section,i)=><section className="menu-section" key={i}><h3>{section.name}</h3>{section.items.map((item,j)=><div className="menu-item" key={j}><b>{item.name}</b><span>{item.price != null ? `${item.currency || "INR"} ${item.price}` : "Price not listed"}</span>{item.description && <p>{item.description}</p>}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source page <ExternalLink size={11}/></a>}</div>)}</section>) : <div className="no-data">{data.menu.status === "not_searched" ? "No menu search has been run yet. Select Search menu online to look for publicly indexed menus." : `0 structured menu items were extracted from ${data.menu.sourceUrls.length} candidate source pages. This does not mean the restaurant has no menu; many menu pages publish their content as images, PDFs or scripts that this search cannot read yet.`}</div>}{data.menu.sourceUrls.length > 0 && <div className="menu-sources"><b>Potential menu sources</b>{data.menu.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url} <ExternalLink size={11}/></a>)}</div>}<pre className="json-view">{JSON.stringify(data.menu, null, 2)}</pre></div>}
        {tab === "reviews" && <div className="review-list">{data.reviews.length ? data.reviews.map((r,i)=><article className="review-card" key={i}><div className="review-top"><b>{r.author || "Google user"}</b><span className="rating-pill"><Star size={13} fill="currentColor"/> {r.rating ?? "—"}</span></div><p>{r.text || "No review text provided."}</p><small>{r.relativeTime || r.publishedAt || ""}</small></article>) : <div className="no-data">No reviews were returned for this listing.</div>}</div>}
        {tab === "json" && <pre className="json-view">{jsonText}</pre>}
      </section>}

      <footer><span>PlaceExtract</span><span>Only publicly available fields are shown. Missing data is not fabricated.</span></footer>
    </main>
  );
}
function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "restaurant"; }
