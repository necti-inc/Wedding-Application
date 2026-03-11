# Deploy to Vercel

The frontend is ready to deploy on Vercel.

## 1. Push your code

Connect your repo to Vercel (Import from Git). Vercel will detect Next.js and use the default build settings.

- **Root Directory:** `frontend` (if the repo root is the monorepo) or leave blank if you deploy from the `frontend` folder only.
- **Build Command:** `npm run build` (default)
- **Output Directory:** `.next` (default)
- **Install Command:** `npm install` (default)

If your repo root is the **wedding-app** folder (with `frontend/` and `backend/` inside), set **Root Directory** to **`frontend`** in the Vercel project settings.

## 2. Environment variables

In Vercel: **Project → Settings → Environment Variables**. Add these for **Production** (and Preview if you want):

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Firebase Web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | e.g. `wedding-app-12da5.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | e.g. `wedding-app-12da5` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | e.g. `wedding-app-12da5.firebasestorage.app` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | From Firebase Console |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | From Firebase Console |
| `NEXT_PUBLIC_LIST_PHOTOS_URL` | No | Your listPhotos Cloud Function URL. Default: `https://us-central1-wedding-app-12da5.cloudfunctions.net/listPhotos` |

Get the Firebase values from **Firebase Console → Project Settings → General → Your apps** (Web app config).

## 3. After deploy

1. **CORS:** Your Firebase Storage bucket CORS must allow your Vercel domain (e.g. `https://your-app.vercel.app`). Add it to `backend/cors.json` and run `npm run cors` from the backend.
2. **listPhotos:** Ensure the Cloud Function is deployed and the optional `NEXT_PUBLIC_LIST_PHOTOS_URL` points to it (or leave unset to use the default URL).

That’s it. Redeploy after changing env vars.
