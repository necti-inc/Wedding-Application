import Link from "next/link";

export default function Home() {
  return (
    <main className="landing">
      <div className="landing__content">
        <h1 className="landing__title">Close Family Cowboy & Cocktail Evening</h1>
        <p className="landing__subtitle">Share your photos and browse everyone’s memories.</p>
        <div className="landing__actions">
          <Link href="/upload" className="landing__btn landing__btn--primary">
            <span>Upload Photos</span>
            <span className="landing__arrow" aria-hidden>→</span>
          </Link>
          <Link href="/gallery" className="landing__btn landing__btn--secondary">
            <span>View Gallery</span>
            <span className="landing__arrow" aria-hidden>→</span>
          </Link>
        </div>
        <p className="landing__hint">
          Add photos from your device or view and download the full gallery.
        </p>
      </div>
    </main>
  );
}
