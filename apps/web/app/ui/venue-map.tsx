import { ExternalLink, MapPin } from "lucide-react";
import type { NormalizedListing } from "@ticket-agent/contracts";

export default function VenueMap({ listing }: { listing: NormalizedListing | null }) {
  return (
    <section className="venue-map" aria-label="Truist Park seat location">
      <header className="venue-map-head">
        <div>
          <span><MapPin size={14} /> TRUIST PARK SEAT MAP</span>
          <strong>{listing ? `Section ${listing.section}${listing.row ? `, Row ${listing.row}` : ""}` : "Select a listing to inspect its section"}</strong>
        </div>
        <a href="https://braves.io-media.com/web/index.html" target="_blank" rel="noreferrer">
          OFFICIAL 3D VENUE <ExternalLink size={13} />
        </a>
      </header>
      <div className="venue-map-canvas">
        <p style={{ padding: "2rem" }}>Use the official venue link to inspect the seating chart. The chart image is not distributed with this source edition.</p>
      </div>
      <footer><span>Marketplace section labels should be checked against the official venue map.</span></footer>
    </section>
  );
}
