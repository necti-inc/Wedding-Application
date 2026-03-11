import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "wedding-app-12da5.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(config);
export const storage = getStorage(app);

/** URL of the listPhotos Cloud Function (Gen2 HTTP). Set in .env.local or use default. */
const LIST_PHOTOS_URL =
  process.env.NEXT_PUBLIC_LIST_PHOTOS_URL ||
  "https://us-central1-wedding-app-12da5.cloudfunctions.net/listPhotos";

/** URL of the deletePhoto Cloud Function. */
const DELETE_PHOTO_URL =
  process.env.NEXT_PUBLIC_DELETE_PHOTO_URL ||
  "https://us-central1-wedding-app-12da5.cloudfunctions.net/deletePhoto";

export async function fetchListPhotos() {
  const res = await fetch(LIST_PHOTOS_URL);
  if (!res.ok) throw new Error("Failed to load photos");
  const data = await res.json();
  return data.photos ?? [];
}

export async function deletePhoto(photoId, phoneNumber) {
  const res = await fetch(DELETE_PHOTO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoId, phoneNumber }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete photo");
  }
  return res.json();
}
