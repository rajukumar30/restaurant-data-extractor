"use client";

import { useMemo, useState } from "react";
import { Search, MapPin, Star, Clock3, Phone, Globe, Camera, MessageSquareText, Utensils, Download, Copy, ExternalLink, Loader2, AlertCircle, CheckCircle2, FileSpreadsheet, Link2 } from "lucide-react";

type Restaurant = {
  id: string; name: string; address?: string; phone?: string; website?: string;
  mapsUrl?: string; rating?: number; reviewCount?: number; hours?: string[];
  latitude?: number; longitude?: number; types?: string[]; priceLevel?: string;
  photos: { name: string; url: string; width?: number; height?: number; attribution?: string[] }[];
  reviews: { rating?: number; text?: string; author?: string; publishedAt?: string; relativeTime?: string }[];
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

  const extract = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setData(null);
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

  const jsonText = useMemo(() => data ? JSON.stringify(data, null, 2) : "", [data]);
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
        ["photo_urls", data.photos.map(p => p.url).join(" | ")],
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
        <p className="hero-copy">Extract public business details, opening hours, available photos and reviews. Preview everything, then download it as JSON or CSV.</p>
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
          {[["overview","Overview"],["photos",`Photos (${data.photos.length})`],["reviews",`Reviews (${data.reviews.length})`],["json","Raw JSON"]].map(([id,label]) => <button key={id} className={tab===id?"tab active":"tab"} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        {tab === "overview" && <div className="detail-grid">
          <div className="detail-card"><div className="detail-title"><Phone size={16}/> Contact</div><p>{data.phone || "Not listed"}</p><div className="detail-title sub"><Globe size={16}/> Website</div>{data.website ? <a href={data.website} target="_blank" rel="noreferrer">{data.website}</a> : <p>Not listed</p>}</div>
          <div className="detail-card"><div className="detail-title"><Clock3 size={16}/> Opening hours</div>{data.hours.length ? <ul className="hours-list">{data.hours.map((h,i)=><li key={i}>{h}</li>)}</ul> : <p>Hours not available</p>}</div>
          <div className="detail-card"><div className="detail-title"><MapPin size={16}/> Location & categories</div><p>{data.latitude != null && data.longitude != null ? `${data.latitude}, ${data.longitude}` : "Coordinates not available"}</p><div className="tags">{data.types.length ? data.types.map(t=><span key={t}>{t.replaceAll("_"," ")}</span>) : <span>Categories unavailable</span>}</div></div>
          <div className="detail-card"><div className="detail-title"><Utensils size={16}/> Menu availability</div><p>{data.menuNote}</p>{data.website && <a href={data.website} target="_blank" rel="noreferrer">Check restaurant website <ExternalLink size={13}/></a>}</div>
        </div>}
        {tab === "photos" && <div className="photo-grid">{data.photos.length ? data.photos.map((p,i)=><div className="photo-card" key={p.name}><img src={p.url} alt={`${data.name} photo ${i+1}`}/><div><span>Photo {i+1}</span><button onClick={() => navigator.clipboard.writeText(new URL(p.url, window.location.origin).toString())}><Copy size={13}/> Copy URL</button></div></div>) : <div className="no-data">No public photos were returned for this listing.</div>}</div>}
        {tab === "reviews" && <div className="review-list">{data.reviews.length ? data.reviews.map((r,i)=><article className="review-card" key={i}><div className="review-top"><b>{r.author || "Google user"}</b><span className="rating-pill"><Star size={13} fill="currentColor"/> {r.rating ?? "—"}</span></div><p>{r.text || "No review text provided."}</p><small>{r.relativeTime || r.publishedAt || ""}</small></article>) : <div className="no-data">No reviews were returned for this listing.</div>}</div>}
        {tab === "json" && <pre className="json-view">{jsonText}</pre>}
      </section>}

      <footer><span>PlaceExtract</span><span>Only publicly available fields are shown. Missing data is not fabricated.</span></footer>
    </main>
  );
}
function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "restaurant"; }
