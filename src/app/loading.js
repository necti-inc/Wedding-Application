export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-spinner page-loading__spinner" aria-hidden />
      <p className="page-loading__text">Loading…</p>
    </div>
  );
}
