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

export async function fetchListPhotos() {
  const res = await fetch(LIST_PHOTOS_URL);
  if (!res.ok) throw new Error("Failed to load photos");
  const data = await res.json();
  return data.photos ?? [];
}
