# How to get your Firebase env variables

Your project ID is **wedding-app-12da5**. Use these steps to copy the Web app config into `.env.local`.

## 1. Open Firebase Console

1. Go to **[Firebase Console](https://console.firebase.google.com/)**
2. Sign in with the Google account that owns the project
3. Click your project **wedding-app-12da5** (or “Our Wedding” / whatever you named it)

## 2. Open Project settings (gear icon)

- In the **left sidebar**, click the **gear icon** next to “Project overview”
- Click **Project settings**

## 3. Get the Web app config

1. Scroll to **“Your apps”**
2. If you don’t have a **Web** app yet:
   - Click **“</>” (Web)**
   - Register the app with a nickname (e.g. “Wedding app web”)
   - You can skip Firebase Hosting for now
   - Click **Register app**
3. You’ll see a code snippet with `firebaseConfig`. It looks like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "wedding-app-12da5.firebaseapp.com",
     projectId: "wedding-app-12da5",
     storageBucket: "wedding-app-12da5.firebasestorage.app",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123..."
   };
   ```

4. Copy each value into your `.env.local`:

   | In the snippet   | Your `.env.local` variable              |
   |------------------|------------------------------------------|
   | `apiKey`         | `NEXT_PUBLIC_FIREBASE_API_KEY`           |
   | `authDomain`     | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`       |
   | `projectId`      | `NEXT_PUBLIC_FIREBASE_PROJECT_ID`        |
   | `storageBucket`  | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`    |
   | `messagingSenderId` | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
   | `appId`          | `NEXT_PUBLIC_FIREBASE_APP_ID`            |

**Direct link to your project’s General settings:**  
[https://console.firebase.google.com/project/wedding-app-12da5/settings/general](https://console.firebase.google.com/project/wedding-app-12da5/settings/general)

Scroll to “Your apps” and click the Web app (or add one) to see the config.

## 4. Create `.env.local`

In the `frontend` folder, create a file named `.env.local` (no `.example`). Paste in something like this and replace the empty values with the ones from the console:

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...your-api-key...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=wedding-app-12da5.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=wedding-app-12da5
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=wedding-app-12da5.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123...
```

Restart `npm run dev` after saving `.env.local`.
