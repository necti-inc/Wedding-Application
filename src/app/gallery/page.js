"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import JSZip from "jszip";
import { fetchListPhotos, deletePhoto } from "@/lib/firebase";
import { getSessionPhone, isOwner } from "@/lib/session";
import PhoneGate from "@/components/PhoneGate";

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
  const [phone, setPhone] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadingPhotoId, setDownloadingPhotoId] = useState(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [shareReadyFiles, setShareReadyFiles] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const successTimeoutRef = useRef(null);

  useEffect(() => {
    setPhone(getSessionPhone());
  }, []);

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

  const loadPhotos = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchListPhotos()
      .then((list) => setPhotos(list))
      .catch((err) => setError(err.message || "Could not load photos"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const filteredPhotos = useMemo(
    () => (tab === "mine" && phone ? photos.filter((p) => isOwner(p, phone)) : photos),
    [photos, tab, phone]
  );
  const visiblePhotos = useMemo(
    () => filteredPhotos.slice(0, displayCount),
    [filteredPhotos, displayCount]
  );
  const hasMore = filteredPhotos.length > displayCount;
  const loadMore = () => setDisplayCount((c) => c + BATCH_SIZE);

  const handleDeletePhoto = useCallback(
    async (photo) => {
      if (!phone || !isOwner(photo, phone) || deletingPhotoId) return;
      setDeletingPhotoId(photo.id);
      setDownloadError(null);
      try {
        await deletePhoto(photo.id, phone);
        setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(photo.id);
          return next;
        });
        showSuccess("Photo removed");
      } catch (err) {
        setDownloadError(err.message || "Could not delete photo.");
      } finally {
        setDeletingPhotoId(null);
      }
    },
    [phone, deletingPhotoId, showSuccess]
  );

  /** Single photo: on mobile use Share API; on desktop blob download. Fetch via proxy to avoid CORS. */
  const downloadPhoto = useCallback(async (photo) => {
    if (downloadingPhotoId) return;
    setDownloadingPhotoId(photo.id);
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
    } finally {
      setDownloadingPhotoId(null);
    }
  }, [isMobile, showSuccess, downloadingPhotoId]);

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
  const myCount = phone ? photos.filter((p) => isOwner(p, phone)).length : 0;

  if (phone === null) {
    return (
      <main className="page">
        <PhoneGate
          title="Enter your phone number"
          subtitle="So you can view the gallery and delete your own photos if you want."
          onContinue={() => setPhone(getSessionPhone())}
        />
      </main>
    );
  }

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

        {!loading && !error && photos.length > 0 && (
          <div className="gallery-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "all"}
              className={`gallery-tabs__tab ${tab === "all" ? "gallery-tabs__tab--active" : ""}`}
              onClick={() => { setTab("all"); setDisplayCount(BATCH_SIZE); }}
            >
              All
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "mine"}
              className={`gallery-tabs__tab ${tab === "mine" ? "gallery-tabs__tab--active" : ""}`}
              onClick={() => { setTab("mine"); setDisplayCount(BATCH_SIZE); }}
            >
              My photos {myCount > 0 ? `(${myCount})` : ""}
            </button>
          </div>
        )}

        {loading && (
          <div className="gallery-skeleton" aria-hidden>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="gallery-skeleton__card" />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="gallery-error-wrap">
            <p className="gallery-error">{error}</p>
            <button type="button" onClick={loadPhotos} className="gallery-retry-btn">
              Try again
            </button>
          </div>
        )}
        {!loading && !error && photos.length === 0 && (
          <div className="gallery-empty-wrap">
            <p className="gallery-empty">No photos yet. Be the first to upload.</p>
            <Link href="/upload" className="gallery-empty-cta">
              Upload photos
            </Link>
          </div>
        )}

        {!loading && !error && photos.length > 0 && tab === "mine" && myCount === 0 && (
          <div className="gallery-empty-wrap">
            <p className="gallery-empty">You haven’t uploaded any photos yet.</p>
            <Link href="/upload" className="gallery-empty-cta">
              Upload photos
            </Link>
          </div>
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
                      className={`gallery-card__download ${downloadingPhotoId === photo.id ? "gallery-card__download--loading" : ""}`}
                      title="Download"
                      aria-label={downloadingPhotoId === photo.id ? "Downloading…" : "Download photo"}
                      disabled={downloadingPhotoId === photo.id || downloading}
                    >
                      {downloadingPhotoId === photo.id ? (
                        <span className="loading-spinner loading-spinner--sm" aria-hidden />
                      ) : (
                        "↓"
                      )}
                    </button>
                    {isOwner(photo, phone) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePhoto(photo);
                        }}
                        className={`gallery-card__delete ${deletingPhotoId === photo.id ? "gallery-card__delete--loading" : ""}`}
                        title="Remove my photo"
                        aria-label={deletingPhotoId === photo.id ? "Removing…" : "Remove my photo"}
                        disabled={deletingPhotoId === photo.id}
                      >
                        {deletingPhotoId === photo.id ? (
                          <span className="loading-spinner loading-spinner--sm" aria-hidden />
                        ) : (
                          "✕"
                        )}
                      </button>
                    )}
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
                  Load more ({filteredPhotos.length - displayCount} remaining)
                </button>
              </div>
            )}
          </>
        )}

        {(selectedCount > 0 || (shareReadyFiles?.length ?? 0) > 0) && (
          <div className="gallery-float-download">
            {downloadError && (
              <div className="gallery-float-download__error-wrap">
                <p className="gallery-float-download__error">{downloadError}</p>
                <button
                  type="button"
                  onClick={() => setDownloadError(null)}
                  className="gallery-float-download__dismiss"
                  aria-label="Dismiss error"
                >
                  Dismiss
                </button>
              </div>
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
