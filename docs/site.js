// سكربت مشترك لموقع GitHub Pages (docs/): شريط المجالات، السنة، موافقة الكوكيز، الإعلانات بعد الموافقة فقط.
// كل المسارات نسبية، فكيخدم سواء الموقع على دومين خاص أو على github.io/<repo>/.
(function () {
  "use strict";

  /* ---------- إعدادات للتعديل ---------- */
  // معرّف AdSense (مثلا "ca-pub-1234567890123456"). خليه فارغ لتعطيل الإعلانات.
  // إلا فعلتيه، زيد ملف docs/ads.txt (شوف README-docs.md).
  var cfg = window.SIYASAT_CONFIG || { adsClient: "" };

  /* ---------- المجالات: مصدر واحد (نفس القيم ديال المحرر فـ admin.html) ----------
     لإضافة مجال: زيد سطر هنا + صفحة docs/domain/<id>.html + خيار فـ admin.html. */
  var DOMAINS = [
    { id: "social",     label: "الاجتماعي والمعيشي",        icon: "🤝", color: "#2457a6", hint: "الدعم الاجتماعي، الضمان الاجتماعي، التعويضات" },
    { id: "education",  label: "التعليم والتكوين",          icon: "🎓", color: "#7a4fb3", hint: "المدرسة العمومية، المنح، التكوين المهني" },
    { id: "health",     label: "الصحة والحماية الاجتماعية", icon: "🩺", color: "#c2412d", hint: "التغطية الصحية AMO، المستشفيات" },
    { id: "housing",    label: "السكن والتعمير",            icon: "🏠", color: "#a86a12", hint: "دعم السكن، رخص البناء والتعمير" },
    { id: "work",       label: "الشغل والاستثمار",          icon: "💼", color: "#1d7a5f", hint: "التشغيل، دعم المقاولات، قانون الشغل" },
    { id: "economy",    label: "الاقتصاد والمالية",         icon: "📊", color: "#12213f", hint: "قانون المالية، الميزانية، الأسعار" },
    { id: "governance", label: "الإدارة والحكامة",          icon: "🏛️", color: "#5b6577", hint: "الحكومة، الإدارة الرقمية، المراقبة" }
  ];
  window.SIYASAT_DOMAINS = DOMAINS;

  /* ---------- الجذر النسبي (مجلد docs) من مكان هاد السكربت ---------- */
  var me = document.currentScript;
  var BASE = me && me.src ? new URL(".", me.src).href : location.href.replace(/[^/]*$/, "");
  var BASE_PATH = new URL(BASE).pathname;
  window.SIYASAT_BASE = BASE;

  var KEY = "siyasat_consent";
  function readConsent() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }
  function writeConsent(ads) {
    try { localStorage.setItem(KEY, JSON.stringify({ ads: !!ads, t: Date.now() })); } catch (e) {}
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  /* ---------- الإعلانات (فقط بعد الموافقة وبوجود معرّف AdSense) ---------- */
  var adsLoaded = false;
  function loadAds() {
    var c = readConsent();
    if (adsLoaded || !/^ca-pub-\d{10,20}$/.test(cfg.adsClient || "") || !c || !c.ads) return;
    adsLoaded = true;
    var s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(cfg.adsClient);
    document.head.appendChild(s);
    document.querySelectorAll(".ad-slot[data-slot]").forEach(function (box) {
      if (box.dataset.done) return;
      box.dataset.done = "1";
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", cfg.adsClient);
      ins.setAttribute("data-ad-slot", box.dataset.slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      box.append(el("small", "إعلان"), ins);
      box.classList.add("on");
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    });
  }
  window.siyasatAds = { refresh: loadAds };

  /* ---------- شريط الموافقة ---------- */
  var bar = null;
  function closeBar() { if (bar) bar.hidden = true; }
  function buildBar() {
    bar = el("div", null, "sx-cookie");
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "موافقة ملفات تعريف الارتباط");
    var p = el("p", "نستخدم ملفات تعريف ارتباط ضرورية لتشغيل الموقع. وإذا وافقت، قد نعرض إعلانات تعتمد على ملفات ارتباط تضعها Google وشركاؤها. يمكنك الرفض دون أن يتأثر استعمالك للموقع، وتغيير اختيارك في أي وقت. ");
    var a = el("a", "سياسة الكوكيز");
    a.href = BASE + "cookies.html";
    p.append(a);
    var act = el("div", null, "sx-act");
    var ok = el("button", "قبول الإعلانات", "sx-ok");
    var no = el("button", "رفض غير الضروري");
    ok.type = no.type = "button";
    ok.onclick = function () { writeConsent(true); closeBar(); loadAds(); };
    no.onclick = function () { writeConsent(false); closeBar(); };
    act.append(ok, no);
    bar.append(p, act);
    document.body.append(bar);
  }
  function openBar() { if (!bar) buildBar(); bar.hidden = false; bar.querySelector("button").focus(); }
  window.siyasatCookieSettings = openBar;

  /* ---------- شريط المجالات (ثابت، بلا طلب شبكة) ---------- */
  function fillSections() {
    var nav = document.getElementById("sx-sections");
    if (!nav) return;
    var path = location.pathname;
    var isHome = path === BASE_PATH || path === BASE_PATH + "index.html";
    nav.replaceChildren();
    var home = el("a", "الرئيسية");
    home.href = BASE + "index.html";
    if (isHome) home.setAttribute("aria-current", "page");
    nav.append(home);
    DOMAINS.forEach(function (d) {
      var a = el("a", d.icon + " " + d.label);
      a.href = BASE + "domain/" + d.id + ".html";
      a.style.setProperty("--c", d.color);
      if (path === BASE_PATH + "domain/" + d.id + ".html" || path === BASE_PATH + "domain/" + d.id) a.setAttribute("aria-current", "page");
      nav.append(a);
    });
    var cur = nav.querySelector('[aria-current="page"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ inline: "center", block: "nearest" });
  }
  window.siyasatSections = fillSections;

  /* ---------- لائحة التقارير المنشورة من Firestore (REST) ---------- */
  // كترجع [{id,title,date,category}] مرتبة من الأحدث. القواعد كتفرض status == published.
  window.siyasatListReports = function () {
    var FB = window.FIREBASE_CONFIG;
    if (!FB) return Promise.reject(new Error("no firebase-config"));
    var url = "https://firestore.googleapis.com/v1/projects/" + FB.projectId + "/databases/(default)/documents:runQuery?key=" + encodeURIComponent(FB.apiKey);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "siyasat_reports" }],
          where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } },
          select: { fields: [{ fieldPath: "title" }, { fieldPath: "date" }, { fieldPath: "category" }] }
        }
      })
    }).then(function (r) {
      if (!r.ok) throw new Error("list " + r.status);
      return r.json();
    }).then(function (rows) {
      return rows.filter(function (x) { return x.document; }).map(function (x) {
        var d = x.document, o = { id: d.name.split("/").pop() };
        for (var k in d.fields || {}) o[k] = d.fields[k].stringValue || "";
        return o;
      }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    });
  };

  /* ---------- صفحة مجال: <body data-domain="health"> ---------- */
  function domainPage() {
    var id = document.body.getAttribute("data-domain");
    var box = document.getElementById("sx-domain-list");
    if (!id || !box) return;
    var dom = DOMAINS.filter(function (d) { return d.id === id; })[0];
    if (dom) box.style.setProperty("--c", dom.color);
    var msg = function (t) { box.replaceChildren(el("p", t, "sx-msg")); };
    msg("كنجيبو التقارير...");
    window.siyasatListReports().then(function (all) {
      var items = all.filter(function (r) { return r.category === id; });
      if (!items.length) { msg("ما كاين حتى تقرير فهاد المجال دابا. رجع قريبا."); return; }
      box.replaceChildren();
      items.forEach(function (r) {
        var a = el("a", null, "sx-card");
        a.href = BASE + "index.html#" + encodeURIComponent(r.id);
        a.append(el("div", r.title, "t"), el("div", new Date(r.date).toLocaleDateString("fr-FR"), "d"));
        box.append(a);
      });
    }).catch(function () { msg("ما قدرناش نجيبو التقارير. عاود المحاولة من بعد."); });
  }

  function init() {
    document.querySelectorAll("[data-year]").forEach(function (e) { e.textContent = new Date().getFullYear(); });
    document.querySelectorAll("[data-cookie-settings]").forEach(function (b) { b.addEventListener("click", openBar); });
    fillSections();
    domainPage();
    if (!readConsent()) openBar(); else loadAds();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
