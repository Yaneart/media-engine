import type { ExternalIds, MediaSummary } from "../api";

export function MediaPoster({
  item,
  size = "regular",
}: {
  item: MediaSummary;
  size?: "regular" | "large";
}) {
  return (
    <div className={`poster poster--${size}`}>
      {item.poster?.url ? <img alt="" src={item.poster.url} /> : <span>{item.type}</span>}
    </div>
  );
}

export function DetailValue({ label, value }: { label: string; value?: string }) {
  return (
    <div className="detail-value">
      <span>{label}</span>
      <strong>{value ?? "Not available"}</strong>
    </div>
  );
}

export function MetaList({ ids }: { ids?: ExternalIds }) {
  const entries = Object.entries(ids ?? {}).filter(([, value]) => Boolean(value));

  if (entries.length === 0) {
    return <span className="muted">No external IDs</span>;
  }

  return (
    <div className="meta-list">
      {entries.slice(0, 4).map(([key, value]) => (
        <span key={key}>
          {key}: {value}
        </span>
      ))}
    </div>
  );
}
