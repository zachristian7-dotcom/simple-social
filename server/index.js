import express from "express";
import cors from "cors";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { google } from "googleapis";
import multer from "multer";
import { Readable } from "stream";

const app = express();
const port = process.env.PORT || 3000;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

app.use(cors());
app.use(express.json());

let firebaseReady = false;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseReady = true;
  } catch (error) {
    console.error("Firebase Admin initialization failed:", error.message);
  }
}

const db = () => admin.firestore();

function getOAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    throw new Error("Google Drive OAuth is not configured on Render.");
  }
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

function makeState() {
  const key = process.env.GOOGLE_SETUP_KEY;
  if (!key) throw new Error("GOOGLE_SETUP_KEY is not configured.");
  const payload = `${Date.now()}:${crypto.randomBytes(18).toString("hex")}`;
  const sig = crypto.createHmac("sha256", key).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

function validState(state) {
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const parts = raw.split(":");
    if (parts.length !== 3) return false;
    const [timestamp, nonce, sig] = parts;
    if (Date.now() - Number(timestamp) > 10 * 60 * 1000) return false;
    const payload = `${timestamp}:${nonce}`;
    const expected = crypto.createHmac("sha256", process.env.GOOGLE_SETUP_KEY).update(payload).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

async function getStoredDriveRefreshToken() {
  if (!firebaseReady) throw new Error("Firebase Admin is not configured.");
  const snap = await db().collection("appConfig").doc("googleDrive").get();
  return snap.exists ? snap.data()?.refreshToken : null;
}

async function getDriveClient() {
  const refreshToken = await getStoredDriveRefreshToken();
  if (!refreshToken) throw new Error("Google Drive has not been connected yet.");
  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

async function getOrCreateMediaFolder(drive) {
  if (firebaseReady) {
    const snap = await db().collection("appConfig").doc("googleDrive").get();
    const folderId = snap.data()?.folderId;
    if (folderId) {
      try {
        await drive.files.get({ fileId: folderId, fields: "id,name,trashed" });
        return folderId;
      } catch {}
    }
  }
  const created = await drive.files.create({
    requestBody: { name: "Simple Social Media", mimeType: "application/vnd.google-apps.folder" },
    fields: "id,name"
  });
  const folderId = created.data.id;
  if (firebaseReady) await db().collection("appConfig").doc("googleDrive").set({ folderId, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return folderId;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "simple-social-server", firebaseAdmin: firebaseReady, googleDriveConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI), time: new Date().toISOString() });
});

app.get("/api/auth/google", (req, res) => {
  try {
    if (!process.env.GOOGLE_SETUP_KEY || req.query.key !== process.env.GOOGLE_SETUP_KEY) return res.status(403).send("Google Drive setup is protected. Use the private setup URL provided by the site owner.");
    const auth = getOAuthClient();
    const url = auth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: [DRIVE_SCOPE], state: makeState() });
    res.redirect(url);
  } catch (error) { res.status(500).send(error.message); }
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    if (!validState(req.query.state)) return res.status(400).send("Invalid or expired Google authorization state.");
    const auth = getOAuthClient();
    const { tokens } = await auth.getToken(req.query.code);
    if (!tokens.refresh_token) return res.status(400).send("Google did not return a refresh token. Re-run the setup with consent requested.");
    await db().collection("appConfig").doc("googleDrive").set({ refreshToken: tokens.refresh_token, connectedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Google Drive connected</title><style>body{font-family:system-ui,sans-serif;background:#f6f7fb;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#fff;padding:32px;border-radius:20px;max-width:520px;box-shadow:0 12px 40px #0001}a{display:inline-block;margin-top:16px;padding:10px 16px;background:#111827;color:white;border-radius:10px;text-decoration:none}</style></head><body><div class="card"><h1>Google Drive connected ✓</h1><p>Simple Social can now store uploaded media in your Google Drive.</p><a href="/">Return to Simple Social</a></div></body></html>`);
  } catch (error) { console.error("Google OAuth callback failed:", error); res.status(500).send(`Google Drive authorization failed: ${error.message}`); }
});

async function requireFirebaseUser(req, res, next) {
  try {
    if (!firebaseReady) return res.status(500).json({ error: "Firebase Admin is not configured." });
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Missing Firebase ID token." });
    req.firebaseUser = await admin.auth().verifyIdToken(header.slice(7));
    next();
  } catch { res.status(401).json({ error: "Invalid Firebase ID token." }); }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10, fileSize: 30 * 1024 * 1024 } });

app.post("/api/media/upload", requireFirebaseUser, upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No media files were provided." });
    const drive = await getDriveClient();
    const folderId = await getOrCreateMediaFolder(drive);
    const media = [];
    for (const file of files) {
      if (!file.mimetype.startsWith("image/") && !file.mimetype.startsWith("video/")) continue;
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const created = await drive.files.create({
        requestBody: { name: `${req.firebaseUser.uid}-${Date.now()}-${safeName}`, parents: [folderId] },
        media: { mimeType: file.mimetype, body: Readable.from(file.buffer) },
        fields: "id,name,mimeType,size,webViewLink"
      });
      const fileId = created.data.id;
      await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
      media.push({ fileId, name: created.data.name, type: file.mimetype.startsWith("video/") ? "video" : "image", url: `https://drive.google.com/uc?export=download&id=${fileId}` });
    }
    res.json({ media });
  } catch (error) { console.error("Drive upload failed:", error); res.status(500).json({ error: error.message || "Google Drive upload failed." }); }
});

app.get("/api/config", (_req, res) => res.json({ appName: "Simple Social", version: "0.4.1", mediaStorage: "google-drive" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, "..", "dist");
app.use(express.static(clientDist));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

app.listen(port, () => console.log(`Simple Social server listening on port ${port}`));
