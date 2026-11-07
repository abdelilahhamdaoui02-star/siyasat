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
app.use(express.json({ limit: "2mb" }));

// ---------- كلمة سر الإدارة ----------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function safeEq(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).send("ADMIN_PASSWORD ما مضبوطش فالخادم");
  }
  const [scheme, encoded] = (req.headers.authorization || "").split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i >= 0) {
      const okUser = safeEq(decoded.slice(0, i), ADMIN_USER);
      const okPass = safeEq(decoded.slice(i + 1), ADMIN_PASSWORD);
      if (okUser && okPass) return next();
    }
  }
  res.set("WWW-Authenticate", 'Basic realm="siyasat-admin", charset="UTF-8"');
  res.status(401).send("خاص كلمة السر");
}

// صفحة الإدارة وأبوابها: محمية (خاص يجيو قبل الملفات العامة)
app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private", "admin.html"));
});
app.use("/api/admin", requireAdmin);

// الملفات العامة
app.use(express.static("public"));

// وضع التجربة: إلا ما كاينش مفتاح API، التوليد كيرجع تقرير تجريبي
const DEMO = !process.env.ANTHROPIC_API_KEY;
const client = DEMO ? null : new Anthropic();

// ---------- ملفات البيانات ----------
function load(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "data", file), "utf8"));
  } catch {
    return [];
  }
}
function save(file, list) {
  const p = path.join(__dirname, "data", file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(list, null, 2), "utf8");
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

app.post("/api/admin/sources", (req, res) => {
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
  save("sources.json", list);
  res.json({ ok: true });
});

app.delete("/api/admin/sources/:id", (req, res) => {
  save("sources.json", load("sources.json").filter((s) => s.id !== req.params.id));
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

app.post("/api/admin/articles", (req, res) => {
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
  save("reports.json", list);
  res.json({ id: a.id });
});

app.put("/api/admin/articles/:id", (req, res) => {
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
  save("reports.json", list);
  res.json({ ok: true });
});

app.delete("/api/admin/articles/:id", (req, res) => {
  save("reports.json", load("reports.json").filter((x) => x.id !== req.params.id));
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("الموقع خدام على http://localhost:" + PORT);
  if (!ADMIN_PASSWORD) console.log("تنبيه: ADMIN_PASSWORD ما مضبوطش، صفحة الإدارة غادي تبقى مسدودة.");
});
