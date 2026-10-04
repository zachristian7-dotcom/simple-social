# Simple Social v0.4.2

Simple Social keeps Firebase Auth/Firestore for the social data and uses a personal Google Drive account for uploaded images and videos.

## Render environment variables

Keep your existing Firebase variables and add:

- `GOOGLE_CLIENT_ID` — Google OAuth web client ID
- `GOOGLE_CLIENT_SECRET` — Google OAuth client secret (keep private)
- `GOOGLE_REDIRECT_URI` — `https://simple-social-031u.onrender.com/api/auth/google/callback`
- `GOOGLE_SETUP_KEY` — a long random private setup key; use it once to authorize the site's Drive account, then remove it from Render

`FIREBASE_SERVICE_ACCOUNT_JSON` is still required for the Render server because it verifies Firebase ID tokens and securely stores the Google Drive refresh token in the `appConfig/googleDrive` Firestore document.

## Google OAuth setup

1. Enable Google Drive API in the Google Cloud project.
2. Create a Web application OAuth client.
3. Add the exact redirect URI above.
4. If the OAuth app is External and in Testing, add the Drive owner's Google account as a test user in Google Auth Platform → Audience.
5. Deploy this version.
6. Add the environment variables in Render.
7. Visit `https://simple-social-031u.onrender.com/api/auth/google?key=YOUR_GOOGLE_SETUP_KEY` while the setup key exists.
8. Sign in to the Google account whose Drive should store media and approve Drive access.
9. After the success page appears, remove `GOOGLE_SETUP_KEY` from Render and redeploy.

The server creates a `Simple Social Media` folder in that Drive automatically. Uploaded media is stored there and the post document stores only Drive metadata/URLs.

## Media limits

- Up to 10 files per post
- 30 MB maximum per file
- Images and videos only

Firebase Storage is not required by this version.


### Media display fix
Drive media is now streamed through the Render server at `/api/media/:fileId`, so uploaded images and videos render correctly in posts instead of opening as Drive download links.

## v0.5.0 like-permission fix
The Firestore rules allow authenticated users to change only the `likeCount` field when the same transaction creates/removes their deterministic like document. Deploy the included `firestore.rules` in the Firebase Console before testing likes.
