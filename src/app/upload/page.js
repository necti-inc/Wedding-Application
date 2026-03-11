"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/lib/firebase";

const UPLOADS_PREFIX = "uploads/";
/** Number of files uploading at once; balances speed vs browser/network limits. */
const UPLOAD_CONCURRENCY = 8;

/** Same confetti as gallery success – loads canvas-confetti on client. */
function fireUploadSuccessConfetti() {
  if (typeof window === "undefined") return;
  import("canvas-confetti").then(({ default: confetti }) => {
    const duration = 2000;
    const end = Date.now() + duration;
    const colors = ["#E8D0F3", "#c9a0dc", "#2C2C34", "#1DB954"];
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
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

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
    setProgress({ current: 0, total: files.length });

    const batchId = Date.now();
    const total = files.length;
    let completed = 0;

    const uploadOne = (file, i) => {
      const ext = (file.name.match(/\.(jpe?g|png|gif|webp)$/i) || [".jpg"])[1]?.toLowerCase() || "jpg";
      const path = `${UPLOADS_PREFIX}${batchId}-${i}.${ext}`;
      const storageRef = ref(storage, path);
      return new Promise((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file, { contentType: file.type });
        task.on(
          "state_changed",
          () => {},
          reject,
          () => {
            completed += 1;
            setProgress({ current: completed, total });
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
      const msg = err.message || "Upload failed";
      const isCorsOrNetwork =
        /cors|failed to fetch|network|load failed|unable to fetch/i.test(msg) ||
        (err.code && String(err.code).toLowerCase().includes("storage"));
      setError(
        isCorsOrNetwork
          ? "Upload couldn’t complete. Check your connection or try again later."
          : "Something went wrong. Try again."
      );
      setUploading(false);
      return;
    }

    setUploading(false);
    setDone(true);
    setFiles([]);
    fireUploadSuccessConfetti();
  }, [files]);

  const count = files.length;
  const progressPct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <main className="page upload-page">
      <header className="page__header">
        <Link href="/" className="page__back">
          ← Back
        </Link>
      </header>
      <div className="upload-page__inner">
        <div className="upload-page__header">
          <h1 className="upload-page__title">Upload Photos</h1>
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
