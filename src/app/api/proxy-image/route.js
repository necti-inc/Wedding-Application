import { NextResponse } from "next/server";
import sharp from "sharp";

const ALLOWED_ORIGIN = "https://firebasestorage.googleapis.com";

/** EXIF date format: YYYY:MM:DD HH:mm:ss */
function exifDateNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}:${m}:${day} ${h}:${min}:${s}`;
}

/** CORS headers so agents/tools that run from another origin can still fetch. */
function corsHeaders(init = {}) {
  return {
    ...init,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * Proxy image requests to avoid CORS on mobile (fetch from client to same-origin API).
 * Only allows Firebase Storage URLs.
 * Applies EXIF-based rotation and sets EXIF date to now so saves appear in device Recents.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Missing url" }, { status: 400, headers: corsHeaders() });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.origin !== ALLOWED_ORIGIN) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) {
      return NextResponse.json({ error: "Upstream error" }, { status: res.status, headers: corsHeaders() });
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const inputBuffer = Buffer.from(await res.arrayBuffer());
    const isImage = (contentType || "").startsWith("image/");
    const isJpeg = contentType === "image/jpeg" || contentType === "image/jpg";

    if (isImage && isJpeg) {
      const nowStr = exifDateNow();
      const rotated = await sharp(inputBuffer)
        .rotate() // auto-rotate from EXIF orientation
        .withExif({
          IFD0: {
            DateTime: nowStr,
          },
        })
        .jpeg({ quality: 90 })
        .toBuffer();
      return new NextResponse(rotated, {
        status: 200,
        headers: corsHeaders({
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400",
          "Last-Modified": new Date().toUTCString(),
        }),
      });
    }

    return new NextResponse(inputBuffer, {
      status: 200,
      headers: corsHeaders({
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      }),
    });
  } catch (err) {
    console.error("proxy-image error", err);
    return NextResponse.json({ error: "Fetch failed" }, { status: 502, headers: corsHeaders() });
  }
}
