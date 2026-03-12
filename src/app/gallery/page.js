"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import JSZip from "jszip";
import { fetchListPhotos, deletePhoto, fetchDownloaded, addDownloaded } from "@/lib/firebase";
import { getSessionPhone, isOwner } from "@/lib/session";
import { hapticTap } from "@/lib/haptic";
import PhoneGate from "@/components/PhoneGate";

/** Fire confetti from the top (Linktree-style). Loads canvas-confetti only on client. */
function fireSuccessConfetti() {
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

const BATCH_SIZE = 48;
const ZIP_FOLDER_NAME = "wedding-photo-downloads";

const TrashIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);
  const [tab, setTab] = useState("all");
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadingPhotoId, setDownloadingPhotoId] = useState(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState(null);
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [shareReadyFiles, setShareReadyFiles] = useState(null);
  const [shareReadyPhotoIds, setShareReadyPhotoIds] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [downloadedIds, setDownloadedIds] = useState(() => new Set());
  const [showFloatFilters, setShowFloatFilters] = useState(false);
  const [showSelectActionModal, setShowSelectActionModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const successTimeoutRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  useEffect(() => {
    setPhone(getSessionPhone());
  }, []);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "mine") setTab("mine");
  }, [searchParams]);

  useEffect(() => {
    if (navOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [navOpen]);

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

  const hasProcessingPhotos = useMemo(
    () => photos.some((p) => p.processing === true),
    [photos]
  );

  useEffect(() => {
    if (!hasProcessingPhotos) return;
    const POLL_INTERVAL_MS = 2500;
    const POLL_TIMEOUT_MS = 90000;
    const startedAt = Date.now();
    const intervalId = setInterval(() => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(intervalId);
        return;
      }
      fetchListPhotos()
        .then((list) => setPhotos(list))
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [hasProcessingPhotos]);

  useEffect(() => {
    if (!phone) return;
    fetchDownloaded(phone)
      .then((ids) => setDownloadedIds(new Set(ids)))
      .catch(() => {});
  }, [phone]);

  /** Show floating filter pill when user scrolls down past intro. */
  useEffect(() => {
    const threshold = 180;
    const onScroll = () => setShowFloatFilters(window.scrollY > threshold);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /** Close select-action modal on Escape. */
  useEffect(() => {
    if (!showSelectActionModal) return;
    const onKeyDown = (e) => e.key === "Escape" && setShowSelectActionModal(false);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSelectActionModal]);

  /** Close delete-confirm modal on Escape. */
  useEffect(() => {
    if (!showDeleteConfirmModal) return;
    const onKeyDown = (e) => e.key === "Escape" && setShowDeleteConfirmModal(false);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showDeleteConfirmModal]);

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
        setPreviewPhoto((p) => (p && p.id === photo.id ? null : p));
        setPreviewImageLoaded(false);
        showSuccess("Photo removed");
      } catch (err) {
        setDownloadError(err.message || "Could not delete photo.");
      } finally {
        setDeletingPhotoId(null);
      }
    },
    [phone, deletingPhotoId, showSuccess]
  );

  /** Delete all selected photos that the user owns (after confirm modal). */
  const deleteSelectedOwn = useCallback(async () => {
    if (!phone || deletingSelected) return;
    const selected = filteredPhotos.filter((p) => selectedIds.has(p.id) && isOwner(p, phone));
    if (selected.length === 0) return;
    setDownloadError(null);
    setShowDeleteConfirmModal(false);
    setDeletingSelected(true);
    const idsToRemove = new Set(selected.map((p) => p.id));
    try {
      for (const photo of selected) {
        await deletePhoto(photo.id, phone);
      }
      setPhotos((prev) => prev.filter((p) => !idsToRemove.has(p.id)));
      setSelectedIds(new Set());
      setShareReadyFiles(null);
      setPreviewPhoto((p) => (p && idsToRemove.has(p.id) ? null : p));
      showSuccess(selected.length === 1 ? "Photo removed" : `${selected.length} photos removed`);
    } catch (err) {
      setDownloadError(err.message || "Could not delete some photos.");
    } finally {
      setDeletingSelected(false);
    }
  }, [phone, filteredPhotos, selectedIds, deletingSelected, showSuccess]);

  const selectedOwnCount = useMemo(
    () => filteredPhotos.filter((p) => selectedIds.has(p.id) && isOwner(p, phone)).length,
    [filteredPhotos, selectedIds, phone]
  );

  /** Mark photo(s) as downloaded in backend and local state. */
  const markAsDownloaded = useCallback((photoIdsToAdd) => {
    if (!phone || !photoIdsToAdd.length) return;
    setDownloadedIds((prev) => new Set([...prev, ...photoIdsToAdd]));
    addDownloaded(phone, photoIdsToAdd).catch(() => {});
  }, [phone]);

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
        markAsDownloaded([photo.id]);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      showSuccess("Photo downloaded");
      markAsDownloaded([photo.id]);
    } catch {
      window.open(photo.fullUrl, "_blank");
    } finally {
      setDownloadingPhotoId(null);
    }
  }, [isMobile, showSuccess, downloadingPhotoId, markAsDownloaded]);

  const toggleSelect = useCallback((photoId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const LONG_PRESS_MS = 450;

  const handleCardPointerDown = useCallback((photoId) => {
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      toggleSelect(photoId);
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  }, [toggleSelect]);

  const handleCardPointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleCardPointerLeave = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  /** On mobile, share sheet must open from a user tap. Second tap opens share (first tap prepared the files). */
  const openSavePhotosSheet = useCallback(async () => {
    if (!shareReadyFiles?.length) return;
    const count = shareReadyFiles.length;
    const idsToMark = shareReadyPhotoIds || [];
    setDownloadError(null);
    try {
      const ok = await openShareSheet(shareReadyFiles);
      if (ok) {
        setShareReadyFiles(null);
        setShareReadyPhotoIds(null);
        showSuccess(
          count === 1
            ? "1 photo saved to your photos"
            : `${count} photos saved to your photos`
        );
        markAsDownloaded(idsToMark);
      }
    } catch (err) {
      setShareReadyFiles(null);
      setShareReadyPhotoIds(null);
      if (err?.name !== "AbortError") {
        setDownloadError("Save was cancelled or couldn’t open. Try again.");
      }
    }
  }, [shareReadyFiles, shareReadyPhotoIds, showSuccess, markAsDownloaded]);

  /** Save/download selected. On mobile: first tap = fetch files; then button becomes "Tap to save" and second tap opens share sheet. */
  const downloadSelected = useCallback(async () => {
    const selected = filteredPhotos.filter((p) => selectedIds.has(p.id));
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
        setShareReadyPhotoIds(selected.map((p) => p.id));
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
      markAsDownloaded(selected.map((p) => p.id));
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
  }, [filteredPhotos, selectedIds, isMobile, showSuccess, markAsDownloaded]);

  const selectedCount = selectedIds.size;
  const myCount = phone ? photos.filter((p) => isOwner(p, phone)).length : 0;

  const selectablePhotos = useMemo(
    () => filteredPhotos.filter((p) => !p.processing),
    [filteredPhotos]
  );
  const allSelectableSelected = selectablePhotos.length > 0 && selectablePhotos.every((p) => selectedIds.has(p.id));

  const handleSelectAll = useCallback(() => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectablePhotos.map((p) => p.id)));
    }
  }, [allSelectableSelected, selectablePhotos]);

  /** Photo counts as "downloaded" if user has it in their list or they uploaded it. */
  const isDownloaded = useCallback(
    (photo) => downloadedIds.has(photo.id) || isOwner(photo, phone),
    [downloadedIds, phone]
  );

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
    <main className="page gallery-page">
      {successMessage && (
        <div className="gallery-success-toast" role="status">
          {successMessage}
        </div>
      )}
      <header className="gallery-header">
        <div className="gallery-header__inner">
          <h1 className="gallery-header__title">Cowboy Cocktail</h1>
          <button
            type="button"
            className="gallery-header__menu-btn"
            onClick={() => { hapticTap(); setNavOpen(true); }}
            aria-label="Open menu"
          >
            <HamburgerIcon />
          </button>
        </div>
      </header>

      {/* Side drawer navigation */}
      <div
        className={`nav-drawer-overlay ${navOpen ? "nav-drawer-overlay--open" : ""}`}
        onClick={() => { hapticTap(); setNavOpen(false); }}
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
            onClick={() => { hapticTap(); setNavOpen(false); }}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>
        <nav className="nav-drawer__nav">
          <Link href="/" className={`nav-drawer__link ${pathname === "/" ? "nav-drawer__link--active" : ""}`} onClick={() => { hapticTap(); setNavOpen(false); }}>
            Home
          </Link>
          <Link href="/upload" className={`nav-drawer__link ${pathname === "/upload" ? "nav-drawer__link--active" : ""}`} onClick={() => { hapticTap(); setNavOpen(false); }}>
            Upload photo
          </Link>
          <Link href="/gallery?tab=mine" className={`nav-drawer__link ${pathname === "/gallery" && tab === "mine" ? "nav-drawer__link--active" : ""}`} onClick={() => { hapticTap(); setNavOpen(false); }}>
            My photos
          </Link>
          <Link href="/gallery" className={`nav-drawer__link ${pathname === "/gallery" && tab !== "mine" ? "nav-drawer__link--active" : ""}`} onClick={() => { hapticTap(); setNavOpen(false); }}>
            Gallery
          </Link>
        </nav>
      </aside>
      <div className="page__inner">
        <div className="gallery-page__header">
          <h2 className="gallery-page__title">Welcome to the Gallery</h2>
          <p className="gallery-page__subtitle">
            Browse everyone’s photos from the day — tap any photo to view it full size, or select multiple to download or save to your device. Use the tabs below to see all photos or just the ones you uploaded.
          </p>
        </div>

        {!loading && !error && photos.length > 0 && (
          <>
            <div className="gallery-filters-bar">
              <div className="gallery-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "all"}
                  className={`gallery-tabs__tab ${tab === "all" ? "gallery-tabs__tab--active" : ""}`}
                  onClick={() => { hapticTap(); setTab("all"); setDisplayCount(BATCH_SIZE); }}
                >
                  All
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "mine"}
                  className={`gallery-tabs__tab ${tab === "mine" ? "gallery-tabs__tab--active" : ""}`}
                  onClick={() => { hapticTap(); setTab("mine"); setDisplayCount(BATCH_SIZE); }}
                >
                  My photos {myCount > 0 ? `(${myCount})` : ""}
                </button>
              </div>
              <div className="gallery-filters-row">
                <p className="gallery-page__count">
                  {photos.length} photo{photos.length === 1 ? "" : "s"} — browse and download.
                </p>
                <button
                  type="button"
                  onClick={() => { hapticTap(); handleSelectAll(); }}
                  className="gallery-select-all-btn"
                  aria-label={allSelectableSelected ? "Deselect all photos" : `Select all ${selectablePhotos.length} photos`}
                >
                  {allSelectableSelected ? "Deselect all" : `Select all (${selectablePhotos.length})`}
                </button>
              </div>
            </div>

            {/* Floating filter pill – All tab + Select all / count button */}
            <div
              className={`gallery-float-filters ${showFloatFilters ? "gallery-float-filters--visible" : ""}`}
              role="group"
              aria-label="Gallery actions"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "all"}
                className={`gallery-tabs__tab ${tab === "all" ? "gallery-tabs__tab--active" : ""}`}
                onClick={() => { hapticTap(); setTab("all"); setDisplayCount(BATCH_SIZE); }}
              >
                All
              </button>
              <button
                type="button"
                className={`gallery-float-filters__select-btn ${selectedIds.size > 0 ? "gallery-float-filters__select-btn--active" : ""}`}
                onClick={() => { hapticTap(); selectedIds.size > 0 ? setShowSelectActionModal(true) : handleSelectAll(); }}
                aria-label={selectedIds.size > 0 ? `${selectedIds.size} selected – open options` : `Select all ${selectablePhotos.length} photos`}
              >
                {selectedIds.size === 0
                  ? "Select all"
                  : selectedIds.size === 1
                    ? "1 photo selected"
                    : `${selectedIds.size} photos selected`}
              </button>
            </div>

            {/* Modal when user taps "N photos selected" – Save or Deselect */}
            {showSelectActionModal && selectedIds.size > 0 && (
              <div
                className="gallery-select-action-overlay"
                onClick={() => { hapticTap(); setShowSelectActionModal(false); }}
                onKeyDown={(e) => e.key === "Escape" && setShowSelectActionModal(false)}
                role="dialog"
                tabIndex={-1}
                aria-modal="true"
                aria-labelledby="gallery-select-action-title"
              >
                <div className="gallery-select-action-modal" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="gallery-select-action-close"
                    onClick={() => { hapticTap(); setShowSelectActionModal(false); }}
                    aria-label="Close"
                  >
                    <CloseIcon />
                  </button>
                  <h2 id="gallery-select-action-title" className="gallery-select-action-title">
                    {selectedIds.size === 1 ? "1 photo selected" : `${selectedIds.size} photos selected`}
                  </h2>
                  <div className="gallery-select-action-buttons">
                    <button
                      type="button"
                      className="gallery-select-action-btn gallery-select-action-btn--primary"
                      onClick={() => {
                        hapticTap();
                        setShowSelectActionModal(false);
                        downloadSelected();
                      }}
                      disabled={downloading}
                    >
                      {downloading ? "Preparing…" : "Save all selected photos"}
                    </button>
                    <button
                      type="button"
                      className="gallery-select-action-btn gallery-select-action-btn--secondary"
                      onClick={() => {
                        hapticTap();
                        setSelectedIds(new Set());
                        setShowSelectActionModal(false);
                      }}
                    >
                      Deselect photos
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
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
            <button type="button" onClick={() => { hapticTap(); loadPhotos(); }} className="gallery-retry-btn">
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
            <section className="gallery-photos-section" aria-label="Photo grid">
            <div className="gallery-grid">
              {visiblePhotos.map((photo) => (
                <div
                  key={photo.id}
                  className={`gallery-card ${selectedIds.has(photo.id) ? "gallery-card--selected" : ""}`}
                >
                  <div
                    className="gallery-card__img-wrap"
                    onClick={() => {
                      hapticTap();
                      if (photo.processing) return;
                      if (longPressTriggeredRef.current) {
                        longPressTriggeredRef.current = false;
                        return;
                      }
                      if (selectedIds.size > 0) {
                        toggleSelect(photo.id);
                      } else {
                        setPreviewPhoto(photo);
                        setPreviewImageLoaded(false);
                      }
                    }}
                    onPointerDown={() => handleCardPointerDown(photo.id)}
                    onPointerUp={handleCardPointerUp}
                    onPointerLeave={handleCardPointerLeave}
                    onPointerCancel={handleCardPointerUp}
                    onContextMenu={(e) => e.preventDefault()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (photo.processing) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        hapticTap();
                        if (selectedIds.size > 0) {
                          toggleSelect(photo.id);
                        } else {
                          setPreviewPhoto(photo);
                          setPreviewImageLoaded(false);
                        }
                      }
                    }}
                    aria-label={photo.processing ? "Photo processing" : selectedIds.size > 0 ? (selectedIds.has(photo.id) ? "Deselect photo" : "Select photo") : "View photo (long-press to select)"}
                  >
                    <div className="gallery-card__img-inner">
                      {photo.processing ? (
                        <div className="gallery-card__processing" aria-hidden>
                          <span className="loading-spinner loading-spinner--sm" />
                          <span className="gallery-card__processing-text">Processing…</span>
                        </div>
                      ) : (
                        <Image
                          src={getImageFetchUrl(photo.mediumUrl || photo.fullUrl)}
                          alt={photo.fileName || "Wedding photo"}
                          fill
                          sizes="(max-width: 768px) 25vw, (max-width: 1200px) 25vw, 200px"
                          className="gallery-card__img"
                          unoptimized
                        />
                      )}
                    </div>
                    {!photo.processing && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          hapticTap();
                          toggleSelect(photo.id);
                        }}
                        className={`gallery-card__check ${isDownloaded(photo) ? "gallery-card__check--downloaded" : selectedIds.has(photo.id) ? "gallery-card__check--on" : ""}`}
                        aria-label={isDownloaded(photo) ? "Already downloaded" : selectedIds.has(photo.id) ? "Deselect photo" : "Select photo"}
                        title={isDownloaded(photo) ? "Already in your downloads" : selectedIds.has(photo.id) ? "Deselect" : "Select to download with others"}
                      >
                        {(isDownloaded(photo) || selectedIds.has(photo.id)) ? "✓" : ""}
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
                  onClick={() => { hapticTap(); loadMore(); }}
                  className="gallery-load-more-btn"
                >
                  Load more ({filteredPhotos.length - displayCount} remaining)
                </button>
              </div>
            )}
            </section>
            {previewPhoto && (
              <div
                className="gallery-preview-overlay"
                onClick={() => { hapticTap(); setPreviewPhoto(null); setPreviewImageLoaded(false); }}
                role="dialog"
                aria-modal="true"
                aria-label="Photo preview"
              >
                <div className="gallery-preview-content" onClick={(e) => e.stopPropagation()}>
                  <div className="gallery-preview-image-wrap">
                    <div className="gallery-preview-placeholder" aria-hidden />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getImageFetchUrl(previewPhoto.mediumUrl || previewPhoto.fullUrl)}
                      alt={previewPhoto.fileName || "Wedding photo"}
                      className={previewImageLoaded ? "gallery-preview-img--loaded" : ""}
                      onLoad={() => setPreviewImageLoaded(true)}
                    />
                    <button
                      type="button"
                      className="gallery-preview-close"
                      onClick={() => { hapticTap(); setPreviewPhoto(null); setPreviewImageLoaded(false); }}
                      aria-label="Close"
                    >
                      <CloseIcon />
                    </button>
                    <div className="gallery-preview-actions">
                      <button
                        type="button"
                        className="gallery-preview-btn"
                        onClick={() => { hapticTap(); downloadPhoto(previewPhoto); }}
                        disabled={downloadingPhotoId === previewPhoto.id}
                      >
                        {downloadingPhotoId === previewPhoto.id ? "Downloading…" : "Download"}
                      </button>
                      {isOwner(previewPhoto, phone) && (
                        <button
                          type="button"
                          className="gallery-preview-btn gallery-preview-btn--delete"
                          onClick={() => { hapticTap(); handleDeletePhoto(previewPhoto); }}
                          disabled={deletingPhotoId === previewPhoto.id}
                          title="Delete photo"
                          aria-label={deletingPhotoId === previewPhoto.id ? "Removing…" : "Delete photo"}
                        >
                          {deletingPhotoId === previewPhoto.id ? (
                            <span className="loading-spinner loading-spinner--sm" aria-hidden />
                          ) : (
                            <TrashIcon />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
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
                  onClick={() => { hapticTap(); setDownloadError(null); }}
                  className="gallery-float-download__dismiss"
                  aria-label="Dismiss error"
                >
                  Dismiss
                </button>
              </div>
            )}
            {shareReadyFiles?.length ? (
              <>
                <button
                  type="button"
                  onClick={() => { hapticTap(); openSavePhotosSheet(); }}
                  className="gallery-float-download__btn"
                >
                  Tap to save
                </button>
                {selectedOwnCount > 0 && (
                  <button
                    type="button"
                    onClick={() => { hapticTap(); setShowDeleteConfirmModal(true); }}
                    className="gallery-float-download__delete"
                    disabled={downloading}
                    title="Delete selected"
                    aria-label={`Delete ${selectedOwnCount} photo${selectedOwnCount !== 1 ? "s" : ""}`}
                  >
                    <TrashIcon />
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => { hapticTap(); downloadSelected(); }}
                  className="gallery-float-download__btn"
                  disabled={downloading || deletingSelected}
                >
                  {deletingSelected
                    ? (selectedOwnCount === 1 ? "Deleting 1 photo…" : `Deleting ${selectedOwnCount} photos…`)
                    : downloading
                      ? (isMobile ? "Preparing…" : "Preparing download…")
                      : isMobile
                        ? "Save Photos"
                        : `Download ${selectedCount} photo${selectedCount !== 1 ? "s" : ""}`}
                </button>
                {selectedOwnCount > 0 && (
                  <button
                    type="button"
                    onClick={() => { hapticTap(); setShowDeleteConfirmModal(true); }}
                    className="gallery-float-download__delete"
                    disabled={downloading || deletingSelected}
                    title="Delete selected"
                    aria-label={`Delete ${selectedOwnCount} photo${selectedOwnCount !== 1 ? "s" : ""}`}
                  >
                    <TrashIcon />
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Delete confirmation modal */}
        {showDeleteConfirmModal && selectedOwnCount > 0 && (
          <div
            className="gallery-select-action-overlay gallery-delete-confirm-overlay"
            onClick={() => { hapticTap(); setShowDeleteConfirmModal(false); }}
            onKeyDown={(e) => e.key === "Escape" && setShowDeleteConfirmModal(false)}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="gallery-delete-confirm-title"
          >
            <div className="gallery-select-action-modal" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="gallery-select-action-close"
                onClick={() => { hapticTap(); setShowDeleteConfirmModal(false); }}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
              <h2 id="gallery-delete-confirm-title" className="gallery-select-action-title">
                {selectedOwnCount === 1 ? "Delete 1 photo?" : `Delete ${selectedOwnCount} photos?`}
              </h2>
              <p className="gallery-delete-confirm-subtitle">This cannot be undone.</p>
              <div className="gallery-select-action-buttons">
                <button
                  type="button"
                  className="gallery-select-action-btn gallery-delete-confirm-btn"
                  onClick={() => { hapticTap(); deleteSelectedOwn(); }}
                  disabled={deletingSelected}
                >
                  {deletingSelected ? "Deleting…" : selectedOwnCount === 1 ? "Delete photo" : `Delete ${selectedOwnCount} photos`}
                </button>
                <button
                  type="button"
                  className="gallery-select-action-btn gallery-select-action-btn--secondary"
                  onClick={() => { hapticTap(); setShowDeleteConfirmModal(false); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
