// سكربت مشترك: شريط المجالات، السنة، موافقة الكوكيز، وتحميل الإعلانات بعد الموافقة فقط.
(function () {
  "use strict";
  var KEY = "siyasat_consent";
  var cfg = { adsClient: "" };

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
    if (adsLoaded || !cfg.adsClient || !c || !c.ads) return;
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
    a.href = "/cookies.html";
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

  /* ---------- شريط المجالات ---------- */
  function fillSections() {
    var nav = document.getElementById("sx-sections");
    if (!nav) return;
    fetch("/api/domains").then(function (r) { return r.json(); }).then(function (list) {
      nav.replaceChildren();
      var home = el("a", "الرئيسية"); home.href = "/";
      if (location.pathname === "/") home.setAttribute("aria-current", "page");
      nav.append(home);
      list.forEach(function (d) {
        var a = el("a", d.icon + " " + d.label);
        a.href = "/domain/" + d.id;
        a.style.setProperty("--c", d.color);
        if (location.pathname.replace(/\/$/, "") === "/domain/" + d.id) a.setAttribute("aria-current", "page");
        nav.append(a);
      });
      var cur = nav.querySelector('[aria-current="page"]');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ inline: "center", block: "nearest" });
    }).catch(function () {});
  }
  window.siyasatSections = fillSections;

  function init() {
    document.querySelectorAll("[data-year]").forEach(function (e) { e.textContent = new Date().getFullYear(); });
    document.querySelectorAll("[data-cookie-settings]").forEach(function (b) { b.addEventListener("click", openBar); });
    fillSections();
    fetch("/api/site-config").then(function (r) { return r.json(); }).then(function (c) {
      cfg = c || cfg;
      if (!readConsent()) openBar(); else loadAds();
    }).catch(function () { if (!readConsent()) openBar(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
