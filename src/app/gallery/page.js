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

  /** Single photo: on mobile use Share API so user gets "Save to Photos"; on desktop blob download. */
  const downloadPhoto = useCallback(async (photo) => {
    try {
      const res = await fetch(photo.fullUrl, { mode: "cors" });
      if (!res.ok) return;
      const blob = await res.blob();
      const fileName = photo.fileName || "wedding-photo.jpg";
      if (isMobile && navigator.share) {
        const files = blobsToFiles([blob], [fileName]);
        if (navigator.canShare && !navigator.canShare({ files })) throw new Error("Share not supported");
        await navigator.share({ files, title: "Wedding photo" });
        return;
      }
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

  /** On mobile, share sheet must open from a user tap. Second tap opens share (first tap prepared the files). */
  const openSavePhotosSheet = useCallback(async () => {
    if (!shareReadyFiles?.length) return;
    setDownloadError(null);
    try {
      const ok = await openShareSheet(shareReadyFiles);
      if (ok) setShareReadyFiles(null);
    } catch {
      setShareReadyFiles(null);
    }
  }, [shareReadyFiles]);

  /** Save/download selected. On mobile: first tap = fetch files; then button becomes "Tap to save" and second tap opens share sheet. */
  const downloadSelected = useCallback(async () => {
    const selected = visiblePhotos.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    setDownloadError(null);
    setDownloading(true);

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
