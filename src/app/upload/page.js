"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { getSessionPhone } from "@/lib/session";
import PhoneGate from "@/components/PhoneGate";

const UPLOADS_PREFIX = "uploads/";
/** Number of files uploading at once; higher = faster for large batches (backend processes each file in parallel). */
const UPLOAD_CONCURRENCY = 20;

/** Turn Firebase Storage (and other) errors into a short, user-friendly message. */
function getUploadErrorMessage(err, photoIndex, total) {
  const code = err?.code || "";
  const msg = (err?.message || "Upload failed").toLowerCase();
  const prefix = total > 1 && photoIndex != null ? `Photo ${photoIndex} of ${total}: ` : "";

  if (code === "storage/unauthorized" || /permission|unauthorized/i.test(msg)) {
    return prefix + "Permission denied. Check that the app has access to storage and try again.";
  }
  if (code === "storage/quota-exceeded" || /quota|full/i.test(msg)) {
    return prefix + "Storage limit reached. Try fewer photos or try again later.";
  }
  if (code === "storage/retry-limit-exceeded" || /retry|timeout|deadline/i.test(msg)) {
    return prefix + "Upload timed out. Check your connection and try again.";
  }
  if (code === "storage/canceled" || /cancel/i.test(msg)) {
    return prefix + "Upload was canceled.";
  }
  if (code === "storage/unauthenticated") {
    return prefix + "Please sign in or enter your phone number and try again.";
  }
  if (/network|fetch|cors|connection|failed to fetch|load failed/i.test(msg)) {
    return prefix + "Connection problem. Check your network and try again.";
  }
  if (/storage|firebase/i.test(code) || code) {
    return prefix + "Upload failed. Try again or use fewer photos at once.";
  }
  return prefix + "Something went wrong. Try again.";
}

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const HamburgerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

/** Same confetti as gallery success – loads canvas-confetti on client. */
function fireUploadSuccessConfetti() {
  if (typeof window === "undefined") return;
  import("canvas-confetti").then(({ default: confetti }) => {
    const duration = 2000;
    const end = Date.now() + duration;
    const colors = ["#D6BB5B", "#E5CF7A", "#B89A3D", "#D4DCCD"];
    (function frame() {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  });
}

export default function UploadPage() {
  const pathname = usePathname();
  const [phone, setPhone] = useState(null);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const completedRef = useRef(0);
  const progressIntervalRef = useRef(null);

  useEffect(() => {
    setPhone(getSessionPhone());
  }, []);

  useEffect(() => {
    if (navOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [navOpen]);

  const handleSelect = useCallback((e) => {
    const chosen = Array.from(e.target.files || []);
    const images = chosen.filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...images]);
    setError(null);
    setDone(false);
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setError(null);
    setDone(false);
  }, []);

  /** Run up to `limit` uploads at a time; when one finishes, start the next. */
  const uploadAll = useCallback(async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    const total = files.length;
    completedRef.current = 0;
    setProgress({ current: 0, total });

    // Smooth progress: tick every 100ms so the UI updates continuously
    progressIntervalRef.current = setInterval(() => {
      setProgress((p) => ({ ...p, current: completedRef.current }));
    }, 100);

    const batchId = Date.now();
    let completed = 0;

    const uploadOne = (file, i) => {
      const ext = (file.name.match(/\.(jpe?g|png|gif|webp)$/i) || [".jpg"])[1]?.toLowerCase() || "jpg";
      const path = `${UPLOADS_PREFIX}${batchId}-${i}.${ext}`;
      const storageRef = ref(storage, path);
      const metadata = {
        contentType: file.type,
        customMetadata: phone ? { uploadedBy: phone } : {},
      };
      return new Promise((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file, metadata);
        task.on(
          "state_changed",
          () => {},
          (err) => reject({ index: i + 1, total, error: err }),
          () => {
            completed += 1;
            completedRef.current = completed;
            resolve();
          }
        );
      });
    };

    const runWithConcurrency = async (tasks, limit) => {
      const executing = [];
      for (const task of tasks) {
        const p = Promise.resolve().then(task);
        const done = p.then(() => {
          executing.splice(executing.indexOf(done), 1);
        });
        executing.push(done);
        if (executing.length >= limit) await Promise.race(executing);
      }
      await Promise.all(executing);
    };

    try {
      const tasks = files.map((file, i) => () => uploadOne(file, i));
      await runWithConcurrency(tasks, UPLOAD_CONCURRENCY);
    } catch (err) {
      const structured = err?.error != null && err?.index != null;
      const errorObj = structured ? err.error : err;
      const photoIndex = structured ? err.index : null;
      setError(getUploadErrorMessage(errorObj, photoIndex, total));
      setUploading(false);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      return;
    }

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setProgress({ current: total, total });
    setUploading(false);
    setDone(true);
    setFiles([]);
    fireUploadSuccessConfetti();
  }, [files, phone]);

  const count = files.length;
  const progressPct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  if (phone === null) {
    return (
      <main className="page upload-page">
        <PhoneGate
          title="Enter your phone number"
          subtitle="We’ll use this so your uploads are linked to you and you can delete your own photos later if you want."
          onContinue={() => setPhone(getSessionPhone())}
        />
      </main>
    );
  }

  return (
    <main className="page upload-page">
      <header className="gallery-header">
        <div className="gallery-header__inner">
          <h1 className="gallery-header__title">Cowboy Cocktail</h1>
          <button
            type="button"
            className="gallery-header__menu-btn"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
          >
            <HamburgerIcon />
          </button>
        </div>
      </header>

      <div
        className={`nav-drawer-overlay ${navOpen ? "nav-drawer-overlay--open" : ""}`}
        onClick={() => setNavOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setNavOpen(false)}
        role="button"
        tabIndex={-1}
        aria-hidden={!navOpen}
      />
      <aside
        className={`nav-drawer ${navOpen ? "nav-drawer--open" : ""}`}
        aria-label="Navigation menu"
      >
        <div className="nav-drawer__header">
          <span className="nav-drawer__title">Menu</span>
          <button
            type="button"
            className="nav-drawer__close"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>
        <nav className="nav-drawer__nav">
          <Link href="/" className={`nav-drawer__link ${pathname === "/" ? "nav-drawer__link--active" : ""}`} onClick={() => setNavOpen(false)}>
            Home
          </Link>
          <Link href="/upload" className={`nav-drawer__link ${pathname === "/upload" ? "nav-drawer__link--active" : ""}`} onClick={() => setNavOpen(false)}>
            Upload photo
          </Link>
          <Link href="/gallery?tab=mine" className="nav-drawer__link" onClick={() => setNavOpen(false)}>
            My photos
          </Link>
          <Link href="/gallery" className="nav-drawer__link" onClick={() => setNavOpen(false)}>
            Gallery
          </Link>
        </nav>
      </aside>

      <div className="upload-page__inner">
        <div className="upload-page__header">
          <h2 className="upload-page__title">Upload Photos</h2>
          <p className="upload-page__subtitle">
            Add your favorite moments. Photos are saved in full size and a gallery-friendly version.
          </p>
        </div>

        {!done ? (
          <>
            <label
              className="upload-zone"
              style={{ cursor: uploading ? "not-allowed" : "pointer" }}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleSelect}
                disabled={uploading}
              />
              <span className="upload-zone__icon" aria-hidden>
                {count > 0 ? count : "↑"}
              </span>
              <span className="upload-zone__text">
                {count > 0
                  ? `${count} photo${count === 1 ? "" : "s"} selected`
                  : "Tap or drag photos here"}
              </span>
              <span className="upload-zone__hint">
                {count > 0 ? "Add more or upload below" : "JPG, PNG or WebP"}
              </span>
            </label>

            {count > 0 && (
              <div className="upload-actions">
                <button
                  type="button"
                  onClick={clearFiles}
                  className="upload-actions__change"
                  aria-label="Clear selection"
                  disabled={uploading}
                >
                  Change selection
                </button>
                <button
                  type="button"
                  onClick={uploadAll}
                  className="upload-actions__submit"
                  disabled={uploading}
                >
                  <span>Upload to gallery</span>
                  <span className="upload-actions__arrow" aria-hidden>→</span>
                </button>
              </div>
            )}

            {uploading && (
              <div className="upload-progress" role="region" aria-label="Upload progress">
                <div
                  className="upload-progress__bar"
                  role="progressbar"
                  aria-valuenow={progress.current}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuetext={`Uploading ${progress.current} of ${progress.total}`}
                >
                  <div
                    className="upload-progress__fill"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="upload-progress__text">
                  <span className="upload-progress__spinner" aria-hidden>
                    <span className="loading-spinner loading-spinner--sm" />
                  </span>
                  Uploading {progress.current} of {progress.total}…
                </p>
                <p className="upload-progress__hint">
                  Please stay on this page while you are uploading photos to ensure the upload fully processes.
                </p>
              </div>
            )}

            {error && (
              <div className="upload-message upload-message--error">
                <p className="upload-message__text">{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="upload-message__retry"
                >
                  Try again
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="upload-done">
            <div className="upload-done__icon" aria-hidden>✓</div>
            <p className="upload-done__title">Photos uploaded</p>
            <p className="upload-done__text">
              They’ll appear in the gallery for everyone to view and download.
            </p>
            <div className="upload-done__actions">
              <Link href="/gallery" className="upload-done__link upload-done__link--primary">
                <span>View gallery</span>
                <span aria-hidden>→</span>
              </Link>
              <Link href="/upload" className="upload-done__link upload-done__link--secondary">
                Add more photos
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
