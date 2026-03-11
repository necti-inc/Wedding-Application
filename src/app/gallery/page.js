"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import JSZip from "jszip";
import { fetchListPhotos } from "@/lib/firebase";

const BATCH_SIZE = 48;
const ZIP_FOLDER_NAME = "wedding-photo-downloads";

/** Safe filename for inside zip (no path separators). */
function safeFileName(name, index) {
  const base = name && name.trim() ? name.replace(/[/\\?%*:|"<>]/g, "-") : "photo";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : ".jpg";
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  return `${index + 1}-${stem}${ext}`;
}

/** Use Share API to save images to device photos (iOS Photos, Android Gallery). Returns true if shared. */
async function shareImagesAsFiles(blobs, fileNames) {
  if (!navigator.share || !navigator.canShare) return false;
  const files = blobs.map((blob, i) => new File([blob], fileNames[i] || `photo-${i + 1}.jpg`, { type: blob.type || "image/jpeg" }));
  if (!navigator.canShare({ files })) return false;
  await navigator.share({
    files,
    title: "Wedding photos",
    text: "Photos from the wedding",
  });
  return true;
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

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
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

  /** Download or save single photo. On mobile with Share API, opens share sheet so user can "Save to Photos" / Gallery. */
  const downloadPhoto = useCallback(async (photo) => {
    try {
      const res = await fetch(photo.fullUrl, { mode: "cors" });
      if (!res.ok) return;
      const blob = await res.blob();
      const fileName = photo.fileName || "wedding-photo.jpg";
      if (isMobile && (await shareImagesAsFiles([blob], [fileName]))) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(photo.fullUrl, "_blank");
    }
  }, [isMobile]);

  const toggleSelect = useCallback((photoId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  /** Save/download selected photos. On mobile: Share API so user can save to Photos/Gallery; else zip download. */
  const downloadSelected = useCallback(async () => {
    const selected = visiblePhotos.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    setDownloadError(null);
    setDownloading(true);
    setSelectedIds(new Set());

    try {
      const blobs = [];
      const fileNames = [];
      for (let i = 0; i < selected.length; i++) {
        const photo = selected[i];
        const res = await fetch(photo.fullUrl, { mode: "cors" });
        if (!res.ok) throw new Error(`Could not load photo ${i + 1}`);
        const blob = await res.blob();
        blobs.push(blob);
        fileNames.push(safeFileName(photo.fileName || "photo.jpg", i));
      }

      if (isMobile && blobs.length > 0) {
        try {
          const shared = await shareImagesAsFiles(blobs, fileNames);
          if (shared) {
            setDownloading(false);
            return;
          }
        } catch {
          // Share cancelled or failed, fall through to zip
        }
      }

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
    } catch (err) {
      setDownloadError(err.message || "Failed. Check your connection or try fewer photos.");
    } finally {
      setDownloading(false);
    }
  }, [visiblePhotos, selectedIds, isMobile]);

  const selectedCount = selectedIds.size;

  return (
    <main className="page">
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
                      src={photo.mediumUrl || photo.fullUrl}
                      alt={photo.fileName || "Wedding photo"}
                      fill
                      sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 200px"
                      className="gallery-card__img"
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
                      title={isMobile ? "Save photo" : "Download"}
                      aria-label={isMobile ? "Save photo" : "Download photo"}
                    >
                      {isMobile ? "Save" : "↓"}
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

        {selectedCount > 0 && (
          <div className="gallery-float-download">
            {downloadError && (
              <p className="gallery-float-download__error">{downloadError}</p>
            )}
            <button
              type="button"
              onClick={downloadSelected}
              className="gallery-float-download__btn"
              disabled={downloading}
            >
              {downloading
                ? (isMobile ? "Preparing…" : "Preparing download…")
                : isMobile
                  ? `Save ${selectedCount} photo${selectedCount !== 1 ? "s" : ""}`
                  : `Download ${selectedCount} photo${selectedCount !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
