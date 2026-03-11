"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import JSZip from "jszip";
import { fetchListPhotos } from "@/lib/firebase";

/** Fire confetti from the top (Linktree-style). Loads canvas-confetti only on client. */
function fireSuccessConfetti() {
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

const BATCH_SIZE = 48;
const ZIP_FOLDER_NAME = "wedding-photo-downloads";
const DOWNLOAD_FETCH_RETRIES = 2;
const DOWNLOAD_FETCH_CONCURRENCY = 3;

/** Safe filename for inside zip (no path separators). */
function safeFileName(name, index) {
  const base = name && name.trim() ? name.replace(/[/\\?%*:|"<>]/g, "-") : "photo";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : ".jpg";
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  return `${index + 1}-${stem}${ext}`;
}

/** Build File[] for Share API. Share must be called from a user gesture, so we prepare files first. */
function blobsToFiles(blobs, fileNames) {
  return blobs.map((blob, i) =>
    new File([blob], fileNames[i] || `photo-${i + 1}.jpg`, { type: blob.type || "image/jpeg" })
  );
}

/** Call Share API (must run directly from user click so the share sheet appears). */
async function openShareSheet(files) {
  if (!navigator.share || !files.length) return false;
  const shareData = { files, title: "Wedding photos", text: "Photos from the wedding" };
  if (navigator.canShare && !navigator.canShare(shareData)) return false;
  await navigator.share(shareData);
  return true;
}

/** Fetch with retries and timeout (handles proxy cold start and transient failures). */
async function fetchWithRetries(url, retries = DOWNLOAD_FETCH_RETRIES) {
  const timeoutMs = 30000; // allow proxy cold start (e.g. Vercel serverless)
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.blob();
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

/** Run async tasks with a concurrency limit; returns results in same order as tasks. */
async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  const executing = [];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const p = Promise.resolve()
      .then(() => task())
      .then((value) => {
        results[i] = value;
        return value;
      });
    const done = p.then(() => {
      executing.splice(executing.indexOf(done), 1);
    });
    executing.push(done);
    if (executing.length >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

/** Same-origin proxy URL for Firebase images (rotation + EXIF date). Use absolute URL so agents/iframes resolve correctly. */
function getImageFetchUrl(fullUrl) {
  if (!fullUrl) return fullUrl;
  try {
    const u = new URL(fullUrl);
    if (u.origin === "https://firebasestorage.googleapis.com") {
      const path = `/api/proxy-image?url=${encodeURIComponent(fullUrl)}`;
      if (typeof window !== "undefined" && window.location?.origin) {
        return `${window.location.origin}${path}`;
      }
      return path;
    }
  } catch (_) {}
  return fullUrl;
}

export default function GalleryPage() {
  const [photos, setPhotos] = useState([]);
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  /** On mobile: after "Save Photos" we fetch and store files here; second tap opens share sheet (required for iOS/Android). */
  const [shareReadyFiles, setShareReadyFiles] = useState(null);
  /** Success message + confetti after save/download (e.g. "3 photos saved to your photos"). */
  const [successMessage, setSuccessMessage] = useState(null);
  const successTimeoutRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const showSuccess = useCallback((message) => {
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setSuccessMessage(message);
    fireSuccessConfetti();
    successTimeoutRef.current = setTimeout(() => {
      setSuccessMessage(null);
      successTimeoutRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    fetchListPhotos()
      .then((list) => setPhotos(list))
      .catch((err) => setError(err.message || "Could not load photos"))
      .finally(() => setLoading(false));
  }, []);

  const visiblePhotos = useMemo(
    () => photos.slice(0, displayCount),
    [photos, displayCount]
  );
  const hasMore = photos.length > displayCount;
  const loadMore = () => setDisplayCount((c) => c + BATCH_SIZE);

  /** Single photo: on mobile use Share API; on desktop blob download. Fetch via proxy to avoid CORS. */
  const downloadPhoto = useCallback(async (photo) => {
    const fetchUrl = getImageFetchUrl(photo.fullUrl);
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error("Load failed");
      const blob = await res.blob();
      const fileName = photo.fileName || "wedding-photo.jpg";
      if (isMobile && navigator.share) {
        const files = blobsToFiles([blob], [fileName]);
        if (navigator.canShare && !navigator.canShare({ files })) throw new Error("Share not supported");
        await navigator.share({ files, title: "Wedding photo" });
        showSuccess("1 photo saved to your photos");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      showSuccess("Photo downloaded");
    } catch {
      window.open(photo.fullUrl, "_blank");
    }
  }, [isMobile, showSuccess]);

  const toggleSelect = useCallback((photoId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  /** On mobile, share sheet must open from a user tap. Second tap opens share (first tap prepared the files). */
  const openSavePhotosSheet = useCallback(async () => {
    if (!shareReadyFiles?.length) return;
    const count = shareReadyFiles.length;
    setDownloadError(null);
    try {
      const ok = await openShareSheet(shareReadyFiles);
      if (ok) {
        setShareReadyFiles(null);
        showSuccess(
          count === 1
            ? "1 photo saved to your photos"
            : `${count} photos saved to your photos`
        );
      }
    } catch (err) {
      setShareReadyFiles(null);
      if (err?.name !== "AbortError") {
        setDownloadError("Save was cancelled or couldn’t open. Try again.");
      }
    }
  }, [shareReadyFiles, showSuccess]);

  /** Save/download selected. On mobile: first tap = fetch files; then button becomes "Tap to save" and second tap opens share sheet. */
  const downloadSelected = useCallback(async () => {
    const selected = visiblePhotos.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    setDownloadError(null);
    setDownloading(true);

    try {
      const total = selected.length;
      const fetchTasks = selected.map((photo, i) => async () => {
        const fetchUrl = getImageFetchUrl(photo.fullUrl);
        try {
          return await fetchWithRetries(fetchUrl);
        } catch {
          throw new Error(`Could not load photo ${i + 1} of ${total}`);
        }
      });
      const blobs = await runWithConcurrency(fetchTasks, DOWNLOAD_FETCH_CONCURRENCY);
      const fileNames = selected.map((p, i) => safeFileName(p.fileName || "photo.jpg", i));

      const files = blobsToFiles(blobs, fileNames);
      const canShare = isMobile && navigator.share && (!navigator.canShare || navigator.canShare({ files }));

      if (canShare) {
        setShareReadyFiles(files);
        setSelectedIds(new Set());
        setDownloading(false);
        return;
      }

      setSelectedIds(new Set());
      const zip = new JSZip();
      const folder = zip.folder(ZIP_FOLDER_NAME);
      blobs.forEach((blob, i) => folder.file(fileNames[i], blob));
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${ZIP_FOLDER_NAME}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      const count = blobs.length;
      showSuccess(
        count === 1 ? "1 photo downloaded" : `${count} photos downloaded`
      );
    } catch (err) {
      const msg = err.message || "";
      setDownloadError(
        /load failed|failed to fetch|cors|network|http 502/i.test(msg)
          ? msg.includes("photo ") ? msg + " Try again or select fewer photos." : "Couldn’t load photos. Check your connection and try again."
          : msg || "Something went wrong. Try again."
      );
    } finally {
      setDownloading(false);
    }
  }, [visiblePhotos, selectedIds, isMobile, showSuccess]);

  const selectedCount = selectedIds.size;

  return (
    <main className="page">
      {successMessage && (
        <div className="gallery-success-toast" role="status">
          {successMessage}
        </div>
      )}
      <header className="page__header">
        <Link href="/" className="page__back">
          ← Back
        </Link>
      </header>
      <div className="page__inner">
        <h1 className="page__title">Gallery</h1>
        <p className="page__subtitle">
          {photos.length > 0
            ? `${photos.length} photo${photos.length === 1 ? "" : "s"} — browse and download.`
            : "Browse and download wedding photos."}
        </p>

        {loading && <p className="gallery-status">Loading…</p>}
        {error && <p className="gallery-error">{error}</p>}

        {!loading && !error && photos.length === 0 && (
          <p className="gallery-empty">No photos yet. Be the first to upload.</p>
        )}

        {!loading && visiblePhotos.length > 0 && (
          <>
            <div className="gallery-grid">
              {visiblePhotos.map((photo) => (
                <div
                  key={photo.id}
                  className={`gallery-card ${selectedIds.has(photo.id) ? "gallery-card--selected" : ""}`}
                >
                  <div className="gallery-card__img-wrap">
                    <Image
                      src={getImageFetchUrl(photo.mediumUrl || photo.fullUrl)}
                      alt={photo.fileName || "Wedding photo"}
                      fill
                      sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 200px"
                      className="gallery-card__img"
                      unoptimized
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(photo.id);
                      }}
                      className={`gallery-card__check ${selectedIds.has(photo.id) ? "gallery-card__check--on" : ""}`}
                      aria-label={selectedIds.has(photo.id) ? "Deselect photo" : "Select photo"}
                      title={selectedIds.has(photo.id) ? "Deselect" : "Select to download with others"}
                    >
                      {selectedIds.has(photo.id) ? "✓" : ""}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadPhoto(photo);
                      }}
                      className="gallery-card__download"
                      title="Download"
                      aria-label="Download photo"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="gallery-load-more">
                <button
                  type="button"
                  onClick={loadMore}
                  className="gallery-load-more-btn"
                >
                  Load more ({photos.length - displayCount} remaining)
                </button>
              </div>
            )}
          </>
        )}

        {(selectedCount > 0 || (shareReadyFiles?.length ?? 0) > 0) && (
          <div className="gallery-float-download">
            {downloadError && (
              <p className="gallery-float-download__error">{downloadError}</p>
            )}
            {shareReadyFiles?.length ? (
              <button
                type="button"
                onClick={openSavePhotosSheet}
                className="gallery-float-download__btn"
              >
                Tap to save
              </button>
            ) : (
              <button
                type="button"
                onClick={downloadSelected}
                className="gallery-float-download__btn"
                disabled={downloading}
              >
                {downloading
                  ? (isMobile ? "Preparing…" : "Preparing download…")
                  : isMobile
                    ? "Save Photos"
                    : `Download ${selectedCount} photo${selectedCount !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
