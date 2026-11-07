const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const cheerio = require("cheerio");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const net = require("net");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": CSP,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  if (process.env.NODE_ENV === "production") {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // الإدارة وواجهات API ما خاصهاش تتفهرس
  if (req.path === "/admin.html" || req.path.startsWith("/api/") || req.path === "/siyasat-onepage.html") {
    res.set("X-Robots-Tag", "noindex, nofollow");
  }
  next();
});

// حد للطلبات العمومية: 120 طلب فالدقيقة لكل IP
const hits = new Map();
app.use((req, res, next) => {
  if (req.path.startsWith("/api/admin")) return next();
  const now = Date.now();
  const h = hits.get(req.ip);
  if (!h || now - h.t >= 60000) {
    if (hits.size > 5000) hits.clear();
    hits.set(req.ip, { n: 1, t: now });
    return next();
  }
  if (++h.n > 120) return res.status(429).send("بزاف ديال الطلبات، عاود من بعد شوية");
  next();
});
app.use(express.json({ limit: "2mb" }));

// ---------- دخول الإدارة عبر Firebase (بريد + كلمة مرور) ----------
// المتصفح كيسجل الدخول عند Firebase Auth وكيصيفط idToken. الخادم كيتأكد منو
// ومن وجود وثيقة admins/{uid} فـ Firestore (نفس طريقة spesocial).
function loadFirebaseConfig() {
  const e = process.env;
  if (e.FIREBASE_API_KEY && e.FIREBASE_PROJECT_ID) {
    return {
      apiKey: e.FIREBASE_API_KEY,
      authDomain: e.FIREBASE_AUTH_DOMAIN || e.FIREBASE_PROJECT_ID + ".firebaseapp.com",
      projectId: e.FIREBASE_PROJECT_ID,
    };
  }
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-config.json"), "utf8"));
    if (c.apiKey && c.projectId && !/^REPLACE/.test(c.apiKey) && !/^REPLACE/.test(c.projectId)) {
      return { apiKey: c.apiKey, authDomain: c.authDomain || c.projectId + ".firebaseapp.com", projectId: c.projectId };
    }
  } catch {}
  return null;
}
const FIREBASE = loadFirebaseConfig();
const NO_FIREBASE = "Firebase ما مضبوطش فالخادم. عمر firebase-config.json (شوف DEPLOY.md).";

// apiKey ديال تطبيقات الويب ماشي سر، الحماية الحقيقية هي قواعد Firestore وحساب الأدمين
app.get("/api/firebase-config", (req, res) => {
  if (!FIREBASE) return res.status(503).json({ error: NO_FIREBASE });
  res.json(FIREBASE);
});

// حماية من تخمين الدخول: 10 محاولات مرفوضة فـ 15 دقيقة لكل IP
const fails = new Map();
const WINDOW = 15 * 60 * 1000;
function tooMany(ip) {
  const f = fails.get(ip);
  return f && Date.now() - f.t < WINDOW && f.n >= 10;
}
function noteFail(ip) {
  if (fails.size > 5000) fails.clear();
  const f = fails.get(ip);
  if (!f || Date.now() - f.t >= WINDOW) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
}

function uidFromToken(tok) {
  try {
    const p = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString("utf8"));
    const uid = p.user_id || p.sub;
    return typeof uid === "string" && uid ? uid : null;
  } catch {
    return null;
  }
}

// نتيجة التحقق كتبقى 5 دقايق (مفتاحها هاش ديال التوكن)
const adminCache = new Map();
const ADMIN_TTL = 5 * 60 * 1000;

async function checkAdmin(token) {
  const uid = uidFromToken(token);
  if (!uid) return { status: 401, error: "جلسة غير صالحة، سجل الدخول من جديد." };
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const hit = adminCache.get(key);
  if (hit && hit.exp > Date.now()) return { ok: true, uid };
  const url =
    "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(FIREBASE.projectId) +
    "/databases/(default)/documents/admins/" + encodeURIComponent(uid);
  // الطلب كيتصيفط بتوكن المستخدم: Firestore هو اللي كيتحقق من التوكن
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
  if (r.ok) {
    if (adminCache.size > 500) for (const [k, v] of adminCache) if (v.exp < Date.now()) adminCache.delete(k);
    adminCache.set(key, { exp: Date.now() + ADMIN_TTL });
    return { ok: true, uid };
  }
  if (r.status === 404) {
    return { status: 403, uid, error: "هاد الحساب ماشي أدمين. معرّف الحساب (UID): " + uid + ". زيد وثيقة فمجموعة admins فـ Firestore سميتها هاد المعرّف بالضبط." };
  }
  if (r.status === 403) {
    return { status: 403, uid, error: "قواعد Firestore كتمنع قراءة admins/" + uid + ". زيد القاعدة اللي فـ DEPLOY.md." };
  }
  if (r.status === 401) return { status: 401, error: "جلسة منتهية أو غير صالحة، سجل الدخول من جديد." };
  return { status: 502, error: "Firestore رجع خطأ " + r.status };
}

async function requireAdmin(req, res, next) {
  if (!FIREBASE) return res.status(503).json({ error: NO_FIREBASE });
  if (tooMany(req.ip)) return res.status(429).json({ error: "بزاف ديال المحاولات، عاود من بعد شوية" });
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return res.status(401).json({ error: "خاص تسجل الدخول" });
  try {
    const r = await checkAdmin(m[1]);
    if (r.ok) {
      req.adminUid = r.uid;
      return next();
    }
    noteFail(req.ip);
    return res.status(r.status).json({ error: r.error, uid: r.uid });
  } catch {
    return res.status(502).json({ error: "تعذر الاتصال بـ Firebase" });
  }
}

// أبواب الإدارة: محمية. صفحة admin.html نفسها فيها فقط نموذج الدخول (ماشي سر)
app.use("/api/admin", requireAdmin);
app.get("/api/admin/me", (req, res) => res.json({ ok: true, uid: req.adminUid }));

// الملفات العامة
app.use(express.static("public"));

// وضع التجربة: إلا ما كاينش مفتاح API، التوليد كيرجع تقرير تجريبي
const DEMO = !process.env.ANTHROPIC_API_KEY;
const client = DEMO ? null : new Anthropic();

// ---------- التخزين ----------
// محليا: ملفات JSON فمجلد data/.  على Google (Cloud Run): Firestore.
const USE_FIRESTORE = process.env.STORE === "firestore" || !!process.env.K_SERVICE;
const FILES = ["reports.json", "sources.json"];
const cache = {};
let db = null;
const collName = (file) => "siyasat_" + file.replace(".json", "");

async function initStore() {
  if (!USE_FIRESTORE) return;
  const { Firestore } = require("@google-cloud/firestore");
  db = new Firestore({ ignoreUndefinedProperties: true });
  for (const f of FILES) {
    const snap = await db.collection(collName(f)).get();
    cache[f] = snap.docs.map((d) => d.data()).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  console.log("التخزين: Firestore");
}

function load(file) {
  if (USE_FIRESTORE) return structuredClone(cache[file] || []);
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "data", file), "utf8"));
  } catch {
    return [];
  }
}

async function save(file, list) {
  if (!USE_FIRESTORE) {
    const p = path.join(__dirname, "data", file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(list, null, 2), "utf8");
    return;
  }
  const prev = new Map((cache[file] || []).map((x) => [x.id, JSON.stringify(x)]));
  const col = db.collection(collName(file));
  const ops = [];
  for (const item of list) {
    if (prev.get(item.id) !== JSON.stringify(item)) ops.push(["set", item]);
    prev.delete(item.id);
  }
  for (const id of prev.keys()) ops.push(["delete", { id }]);
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach(([op, item]) => {
      if (op === "set") batch.set(col.doc(item.id), item);
      else batch.delete(col.doc(item.id));
    });
    await batch.commit();
  }
  cache[file] = structuredClone(list);
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// ---------- الواجهة العامة (المنشور فقط) ----------
const isPublished = (r) => (r.status || "published") === "published";

app.get("/api/reports", (req, res) => {
  const list = load("reports.json")
    .filter(isPublished)
    .map(({ id, title, date }) => ({ id, title, date }))
    .reverse();
  res.json(list);
});

app.get("/api/reports/:id", (req, res) => {
  const r = load("reports.json").find((x) => x.id === req.params.id);
  if (!r || !isPublished(r)) return res.status(404).json({ error: "التقرير ما كاينش" });
  res.json(r);
});

// ---------- الإدارة: الوسطاء ----------
function cleanDomain(input) {
  let h = String(input || "").trim().toLowerCase();
  try {
    h = new URL(h.includes("://") ? h : "https://" + h).hostname;
  } catch {
    return "";
  }
  return h.replace(/^www\./, "");
}

app.get("/api/admin/sources", (req, res) => res.json(load("sources.json")));

app.post("/api/admin/sources", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const domain = cleanDomain(req.body.domain);
  if (!name || !domain || !domain.includes(".") || net.isIP(domain)) {
    return res.status(400).json({ error: "خاص اسم ودومين صحيح (بحال finances.gov.ma)" });
  }
  const list = load("sources.json");
  if (list.some((s) => s.domain === domain)) {
    return res.status(400).json({ error: "هاد الوسيط كاين من قبل" });
  }
  list.push({ id: newId(), name, domain });
  await save("sources.json", list);
  res.json({ ok: true });
});

app.delete("/api/admin/sources/:id", async (req, res) => {
  await save("sources.json", load("sources.json").filter((s) => s.id !== req.params.id));
  res.json({ ok: true });
});

// ---------- الإدارة: جلب رابط ----------
function sourceFor(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (net.isIP(host)) return null;
  return load("sources.json").find((s) => host === s.domain || host.endsWith("." + s.domain)) || null;
}

async function safeGet(urlStr) {
  let current = urlStr;
  for (let i = 0; i < 4; i++) {
    const src = sourceFor(current);
    if (!src) throw new Error("هاد الرابط ماشي من وسيط مسجل. سجل الموقع أولا فالوسطاء.");
    const r = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (siyasat)" },
    });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    if (!r.ok) throw new Error("الموقع رجع خطأ " + r.status);
    return { r, src, finalUrl: current };
  }
  throw new Error("بزاف ديال التحويلات فالرابط");
}

function extractHtml(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,header,footer,form,iframe,svg").remove();
  const title = (
    $("meta[property='og:title']").attr("content") ||
    $("h1").first().text() ||
    $("title").text() ||
    ""
  ).replace(/\s+/g, " ").trim();
  const root = $("article").length ? $("article").first() : $("main").length ? $("main").first() : $("body");
  const blocks = [];
  root.find("h1,h2,h3,h4,p,li").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.length > 1) blocks.push(t);
  });
  const text = blocks.length
    ? [...new Set(blocks)].join("\n\n")
    : root.text().replace(/\s+/g, " ").trim();
  return { title, text };
}

app.post("/api/admin/fetch", async (req, res) => {
  try {
    const url = String(req.body.url || "").trim();
    const { r, src, finalUrl } = await safeGet(url);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) throw new Error("الملف كبير بزاف (أكثر من 15 ميغا)");
    let title = "";
    let text = "";
    if (buf.subarray(0, 4).toString() === "%PDF") {
      const data = await pdfParse(buf);
      text = data.text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
      title = (data.info && data.info.Title) || decodeURIComponent(finalUrl.split("/").pop().split("?")[0]);
    } else {
      ({ title, text } = extractHtml(buf.toString("utf8")));
    }
    if (!text || text.length < 50) throw new Error("ما قدرناش نستخرجو نص من هاد الرابط");
    res.json({ title, text: text.slice(0, 120000), source: finalUrl, sourceName: src.name });
  } catch (e) {
    const msg = e.name === "TimeoutError" ? "الموقع تأخر بزاف فالجواب" : e.message || "وقع خطأ";
    res.status(400).json({ error: msg });
  }
});

// ---------- الإدارة: المقالات (مسودة / منشور) ----------
app.get("/api/admin/articles", (req, res) => {
  const list = load("reports.json")
    .map(({ id, title, date, source, status }) => ({ id, title, date, source, status: status || "published" }))
    .reverse();
  res.json(list);
});

app.get("/api/admin/articles/:id", (req, res) => {
  const a = load("reports.json").find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "المقال ما كاينش" });
  res.json({ ...a, status: a.status || "published" });
});

app.post("/api/admin/articles", async (req, res) => {
  const { title, source, content, status } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "خاص عنوان" });
  if (status === "published" && String(content || "").trim().length < 50) {
    return res.status(400).json({ error: "النص قصير بزاف باش يتنشر" });
  }
  const list = load("reports.json");
  const a = {
    id: newId(),
    title: String(title).trim(),
    source: String(source || "").trim(),
    content: String(content || ""),
    status: status === "published" ? "published" : "draft",
    date: new Date().toISOString(),
  };
  list.push(a);
  await save("reports.json", list);
  res.json({ id: a.id });
});

app.put("/api/admin/articles/:id", async (req, res) => {
  const list = load("reports.json");
  const a = list.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "المقال ما كاينش" });
  const { title, source, content, status } = req.body;
  if (title !== undefined) a.title = String(title).trim();
  if (source !== undefined) a.source = String(source).trim();
  if (content !== undefined) a.content = String(content);
  if (status !== undefined) a.status = status === "published" ? "published" : "draft";
  if (a.status === "published" && (!a.title || a.content.trim().length < 50)) {
    return res.status(400).json({ error: "خاص عنوان ونص كافي باش يتنشر" });
  }
  await save("reports.json", list);
  res.json({ ok: true });
});

app.delete("/api/admin/articles/:id", async (req, res) => {
  await save("reports.json", load("reports.json").filter((x) => x.id !== req.params.id));
  res.json({ ok: true });
});

// ---------- التوليد (مؤجل، ومحمي) ----------
const INSTRUCTIONS = `أنت كاتب تقارير لموقع "سياسات". مهمتك تبسيط النص الرسمي للمواطن المغربي العادي.

اللغة: دارجة مغربية بسيطة وواضحة، بلا مصطلحات معقدة. إلا كان مصطلح تقني ضروري، شرحو بجملة قصيرة.

الأرقام: استعمل غير الأرقام الموجودة فالنص. ما تزيدش أرقام ولا تخمن. إلا ما لقيتيش معلومة، قول "الوثيقة ما كتذكرهاش".

الهيكل:
1. العنوان
2. باختصار (جوج جمل)
3. علاش جات؟
4. شنو كيتبدل؟
5. شكون كيتأثر؟
6. شنو كيقول النص الرسمي (الإيجابيات كما وردت)
7. قراءة نقدية (نقط الضعف بالأرقام، وكل استنتاج ديالك كتوضح أنه تحليل ماشي معلومة رسمية)
8. المصدر الرسمي

ممنوع: إبداء رأي سياسي، أو مدح أو ذم أي جهة. القراءة النقدية كتبنى على الأرقام فقط.`;

app.post("/api/admin/generate", async (req, res) => {
  try {
    const { text, source } = req.body;
    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: "النص قصير بزاف" });
    }
    if (DEMO) {
      return res.json({
        report: "هادا تقرير تجريبي (وضع التجربة).\n\nالنص اللي لصقتي فيه " + text.length + " حرف.",
      });
    }
    const message = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      system: INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content: `رابط المصدر: ${source || "غير محدد"}\n\nالنص الرسمي:\n${text}`,
        },
      ],
    });
    res.json({ report: message.content.map((b) => b.text || "").join("") });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "وقع خطأ فالتوليد" });
  }
});


// ---------- SEO: روابط حقيقية لكل تقرير + sitemap + robots ----------
const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const siteUrl = (req) => (process.env.SITE_URL || req.protocol + "://" + req.get("host")).replace(/\/$/, "");

function describe(content) {
  const lines = String(content || "").split("\n").map((l) => l.trim());
  const isHead = (l) => /^#{1,3}\s/.test(l);
  const hi = lines.findIndex((l) => isHead(l) && l.includes("باختصار"));
  let cand = hi >= 0 ? lines.slice(hi + 1).find((l) => l && !isHead(l)) : null;
  if (!cand) cand = lines.find((l) => l && !isHead(l) && l !== "---") || "";
  const t = cand.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return t.length > 160 ? t.slice(0, 157) + "..." : t;
}

let indexTpl = null;
function template() {
  if (!indexTpl) indexTpl = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  return indexTpl;
}

app.get("/report/:id", (req, res) => {
  const r = load("reports.json").find((x) => x.id === req.params.id);
  if (!r || !isPublished(r)) {
    return res.status(404).set("X-Robots-Tag", "noindex").send(
      '<!doctype html><meta charset="utf-8"><title>404</title><p dir="rtl" style="font-family:sans-serif;padding:2em">التقرير ما كاينش. <a href="/">رجوع للموقع</a></p>'
    );
  }
  const url = siteUrl(req) + "/report/" + encodeURIComponent(r.id);
  const title = r.title + " | سياسات";
  const desc = describe(r.content);
  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: r.title,
    inLanguage: "ar-MA",
    datePublished: r.date,
    mainEntityOfPage: url,
    publisher: { "@type": "Organization", name: "سياسات" },
  }).replace(/</g, "\\u003c");
  const head =
    `<meta name="description" content="${esc(desc)}">` +
    `<link rel="canonical" href="${esc(url)}">` +
    `<meta property="og:type" content="article"><meta property="og:locale" content="ar_MA">` +
    `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">` +
    `<meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary">` +
    `<script type="application/ld+json">${ld}</script>`;
  let html = template()
    .replace(/<title>[\s\S]*?<\/title>/, "<title>" + esc(title) + "</title>")
    .replace(/<meta name="description"[^>]*>\s*/, "")
    .replace(/<link rel="canonical"[^>]*>\s*/, "")
    .replace(/<meta property="og:[^>]*>\s*/g, "")
    .replace("</head>", head + "</head>");
  res.set("Cache-Control", "public, max-age=300").type("html").send(html);
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(
    "User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\nDisallow: /siyasat-onepage.html\n\nSitemap: " +
      siteUrl(req) + "/sitemap.xml\n"
  );
});

app.get("/sitemap.xml", (req, res) => {
  const base = siteUrl(req);
  const urls = [{ loc: base + "/" }, { loc: base + "/about.html" }];
  load("reports.json").filter(isPublished).reverse().forEach((r) =>
    urls.push({ loc: base + "/report/" + encodeURIComponent(r.id), lastmod: String(r.date || "").slice(0, 10) })
  );
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => "<url><loc>" + esc(u.loc) + "</loc>" + (u.lastmod ? "<lastmod>" + u.lastmod + "</lastmod>" : "") + "</url>").join("\n") +
    "\n</urlset>\n";
  res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(xml);
});

app.get("/healthz", (req, res) => res.type("text/plain").send("ok"));

const PORT = process.env.PORT || 3000;
initStore()
  .then(() =>
    app.listen(PORT, () => {
      console.log("الموقع خدام على http://localhost:" + PORT);
      if (!FIREBASE) console.log("تنبيه: " + NO_FIREBASE);
    })
  )
  .catch((e) => {
    console.error("ما قدرناش نحلو التخزين:", e);
    process.exit(1);
  });
