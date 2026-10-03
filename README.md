# Simple Social v0.1

A deliberately small social-media starter using:

- React + Vite
- Node + Express on Render
- Firebase Authentication
- Cloud Firestore for users, posts, likes, follows, comments, and stats

## 1. Firebase

Create a Firebase project.

Enable:
- Authentication → Email/Password
- Firestore Database

Create a Firebase Web App and copy its config into `.env`.

For the Render server, create a Firebase service account and store its JSON contents in the Render environment variable `FIREBASE_SERVICE_ACCOUNT_JSON`.

## 2. Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: http://localhost:5173
Server: http://localhost:3000

## 3. Render

Create a Web Service from this repository.

Build command:
```bash
npm install && npm run build
```

Start command:
```bash
npm start
```

Add the Firebase `VITE_*` variables and `FIREBASE_SERVICE_ACCOUNT_JSON`.

The Express server serves the Vite `dist` folder after the build.

## Firestore collections

- users
- posts
- comments
- follows
- stats

The browser uses Firebase Auth and Firestore directly for the MVP. The Render server provides a health endpoint and can be expanded later for server-only operations.

## Important

Before putting this on a public domain, tighten the Firestore rules. The included rules are intended as a starting point, not a complete production moderation/security system.
