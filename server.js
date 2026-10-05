import express from "express";
import cors from "cors";
import path from "path";
import crypto from "crypto";
import {fileURLToPath} from "url";
import admin from "firebase-admin";
import {google} from "googleapis";
import multer from "multer";
import {Readable} from "stream";

const app=express();
const port=process.env.PORT||3000;
app.use(cors());
app.use(express.json({limit:"2mb"}));

let firebaseReady=false;
if(process.env.FIREBASE_SERVICE_ACCOUNT_JSON){
  try{admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))});firebaseReady=true}
  catch(e){console.error("Firebase Admin init failed:",e.message)}
}
const db=()=>admin.firestore();
const publicFirebaseConfig={
  apiKey:process.env.FIREBASE_API_KEY||process.env.VITE_FIREBASE_API_KEY||"",
  authDomain:process.env.FIREBASE_AUTH_DOMAIN||process.env.VITE_FIREBASE_AUTH_DOMAIN||"",
  projectId:process.env.FIREBASE_PROJECT_ID||process.env.VITE_FIREBASE_PROJECT_ID||"",
  storageBucket:process.env.FIREBASE_STORAGE_BUCKET||process.env.VITE_FIREBASE_STORAGE_BUCKET||"",
  messagingSenderId:process.env.FIREBASE_MESSAGING_SENDER_ID||process.env.VITE_FIREBASE_MESSAGING_SENDER_ID||"",
  appId:process.env.FIREBASE_APP_ID||process.env.VITE_FIREBASE_APP_ID||""
};

function oauth(){
  if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET||!process.env.GOOGLE_REDIRECT_URI) throw Error("Google Drive OAuth is not configured.");
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,process.env.GOOGLE_REDIRECT_URI);
}
function state(){
  if(!process.env.GOOGLE_SETUP_KEY) throw Error("GOOGLE_SETUP_KEY is not configured.");
  const payload=`${Date.now()}:${crypto.randomBytes(18).toString("hex")}`;
  const sig=crypto.createHmac("sha256",process.env.GOOGLE_SETUP_KEY).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}
function validState(s){
  try{const p=Buffer.from(s,"base64url").toString();const [ts,nonce,sig]=p.split(":");if(!ts||!nonce||!sig||Date.now()-Number(ts)>600000)return false;const expected=crypto.createHmac("sha256",process.env.GOOGLE_SETUP_KEY).update(`${ts}:${nonce}`).digest("hex");return crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))}catch{return false}
}
async function refreshToken(){const s=await db().collection("appConfig").doc("googleDrive").get();return s.exists?s.data()?.refreshToken:null}
async function driveClient(){const token=await refreshToken();if(!token)throw Error("Google Drive is not connected yet.");const a=oauth();a.setCredentials({refresh_token:token});return google.drive({version:"v3",auth:a})}
async function mediaFolder(drive){const s=await db().collection("appConfig").doc("googleDrive").get();const old=s.exists?s.data()?.folderId:null;if(old){try{await drive.files.get({fileId:old,fields:"id,trashed"});return old}catch{}}
  const c=await drive.files.create({requestBody:{name:"Simple Social Media",mimeType:"application/vnd.google-apps.folder"},fields:"id"});await db().collection("appConfig").doc("googleDrive").set({folderId:c.data.id,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});return c.data.id}
async function authUser(req,res,next){try{if(!firebaseReady)return res.status(500).json({error:"Firebase Admin is not configured."});const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return res.status(401).json({error:"Missing Firebase ID token."});req.firebaseUser=await admin.auth().verifyIdToken(h.slice(7));next()}catch{res.status(401).json({error:"Invalid Firebase ID token."})}}

app.get("/api/health",(_q,r)=>r.json({ok:true,version:"3.0.0-vanilla",firebaseAdmin:firebaseReady,driveConfigured:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REDIRECT_URI)}));
app.get("/api/config",(_q,r)=>r.json({appName:"Simple Social",version:"3.0.0",firebase:publicFirebaseConfig,mediaStorage:"google-drive"}));
app.get("/api/auth/google",(req,res)=>{try{if(!process.env.GOOGLE_SETUP_KEY||req.query.key!==process.env.GOOGLE_SETUP_KEY)return res.status(403).send("Protected setup URL.");const a=oauth();res.redirect(a.generateAuthUrl({access_type:"offline",prompt:"consent",scope:["https://www.googleapis.com/auth/drive.file"],state:state()}))}catch(e){res.status(500).send(e.message)}});
app.get("/api/auth/google/callback",async(req,res)=>{try{if(!validState(req.query.state))return res.status(400).send("Invalid or expired authorization state.");const a=oauth();const {tokens}=await a.getToken(req.query.code);if(!tokens.refresh_token)return res.status(400).send("No refresh token returned; authorize again with consent.");await db().collection("appConfig").doc("googleDrive").set({refreshToken:tokens.refresh_token,connectedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});res.send(`<!doctype html><meta charset="utf-8"><title>Connected</title><style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;background:#f6f7fb}.c{background:white;padding:32px;border-radius:20px;box-shadow:0 20px 60px #0002}a{display:inline-block;margin-top:16px;padding:10px 15px;background:#111827;color:white;border-radius:10px;text-decoration:none}</style><div class="c"><h1>Google Drive connected ✓</h1><p>Media uploads are ready.</p><a href="/">Return to Simple Social</a></div>`)}catch(e){res.status(500).send(`Google Drive authorization failed: ${e.message}`)}});

const upload=multer({storage:multer.memoryStorage(),limits:{files:10,fileSize:50*1024*1024}});
app.post("/api/media/upload",authUser,upload.array("files",10),async(req,res)=>{try{const files=(req.files||[]).filter(f=>/^image\//.test(f.mimetype)||/^video\//.test(f.mimetype));if(!files.length)return res.status(400).json({error:"No supported media files."});const drive=await driveClient();const folder=await mediaFolder(drive);const media=[];for(const f of files){const safe=f.originalname.replace(/[^a-zA-Z0-9._-]/g,"_");const c=await drive.files.create({requestBody:{name:`${req.firebaseUser.uid}-${Date.now()}-${safe}`,parents:[folder]},media:{mimeType:f.mimetype,body:Readable.from(f.buffer)},fields:"id,name,mimeType,size"});await drive.permissions.create({fileId:c.data.id,requestBody:{role:"reader",type:"anyone"}});media.push({fileId:c.data.id,name:c.data.name,type:f.mimetype.startsWith("video/")?"video":"image",url:`/api/media/${c.data.id}`})}res.json({media})}catch(e){console.error(e);res.status(500).json({error:e.message||"Upload failed."})}});
app.get("/api/media/:id",async(req,res)=>{try{const drive=await driveClient();const meta=await drive.files.get({fileId:req.params.id,fields:"id,name,mimeType,size,trashed"});if(!meta.data||meta.data.trashed)return res.status(404).send("Media not found.");res.setHeader("Content-Type",meta.data.mimeType||"application/octet-stream");res.setHeader("Accept-Ranges","bytes");res.setHeader("Cache-Control","public,max-age=3600");const range=req.headers.range;const got=await drive.files.get({fileId:req.params.id,alt:"media"},{responseType:"stream",headers:range?{Range:range}:undefined});if(range&&got.headers["content-range"]){res.status(206);res.setHeader("Content-Range",got.headers["content-range"])}if(got.headers["content-length"])res.setHeader("Content-Length",got.headers["content-length"]);got.data.pipe(res)}catch(e){res.status(404).send("Media could not be loaded.")}});

const __filename=fileURLToPath(import.meta.url),__dirname=path.dirname(__filename);app.use(express.static(path.join(__dirname,"public")));app.get("/{*splat}",(_q,r)=>r.sendFile(path.join(__dirname,"public","index.html")));app.listen(port,()=>console.log(`Simple Social vanilla listening on ${port}`));
