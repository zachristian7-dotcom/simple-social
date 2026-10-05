# Simple Social 3.0 — Vanilla rebuild

This version intentionally uses **HTML + CSS + browser JavaScript only** for the frontend. There is no React, JSX, Vite, Webpack, or frontend build step.

The only runtime exception is the small Node/Express server (`server.js`) needed for:
- serving the static site
- securely handling Google Drive OAuth
- verifying Firebase ID tokens for uploads
- proxying Google Drive media

Firebase's browser SDK is loaded as native ES modules from Google's CDN.

## Render
Use:
- Build Command: *(none)*
- Start Command: `npm start`

Required environment variables are in `.env.example`.

If your old Render environment uses `VITE_FIREBASE_*`, this server accepts those names too. New deployments can use `FIREBASE_*`.

## Google Drive
Keep the same OAuth redirect URI, but point it at this server:
`https://YOUR-RENDER-HOST/api/auth/google/callback`

The existing stored Drive refresh token can remain in Firestore `appConfig/googleDrive`.

## Firestore rules
Deploy the included `firestore.rules` with Firebase CLI:
`firebase deploy --only firestore:rules`

The rules intentionally prevent client access to `appConfig`, including the Google Drive refresh token.

## Features
Auth, profiles, feed, follows, likes, comments, reposts, bookmarks, mentions/hashtags, search, notifications, messaging, drafts, polls, settings, themes, privacy preferences, blocks/mutes, reports, media uploads, and analytics foundation.

## Note
Some advanced features are deliberately implemented as a solid vanilla foundation rather than requiring a frontend framework. This makes the entire client inspectable and editable as ordinary HTML/CSS/JS.
