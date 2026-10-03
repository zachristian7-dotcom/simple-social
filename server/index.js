import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let firebaseReady = false;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseReady = true;
  } catch (error) {
    console.error("Firebase Admin initialization failed:", error.message);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "simple-social-server",
    firebaseAdmin: firebaseReady,
    time: new Date().toISOString()
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    appName: "Simple Social",
    version: "0.1.0"
  });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, "..", "dist");

app.use(express.static(clientDist));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(port, () => {
  console.log(`Simple Social server listening on port ${port}`);
});