/* سياسات: المجالات + جلب التقارير المنشورة + دوال العرض
   كيتحمل بعد firebase-config.js (اللي كيعرّف window.FIREBASE_CONFIG) */
(function () {
  // المصدر الوحيد للمجالات: الـ slug كيتخزن فـ Firestore فحقل category
  const CATEGORIES = [
    { slug: "social",     label: "الاجتماعي والمعيشي",         icon: "🤝", hint: "الدعم الاجتماعي، الضمان الاجتماعي، التعويضات" },
    { slug: "education",  label: "التعليم والتكوين",           icon: "🎓", hint: "المدرسة العمومية، المنح، التكوين المهني" },
    { slug: "health",     label: "الصحة والحماية الاجتماعية",  icon: "🩺", hint: "التغطية الصحية AMO، المستشفيات" },
    { slug: "housing",    label: "السكن والتعمير",             icon: "🏠", hint: "دعم السكن، رخص البناء" },
    { slug: "work",       label: "الشغل والاستثمار",           icon: "💼", hint: "التشغيل، دعم المقاولات، قانون الشغل" },
    { slug: "economy",    label: "الاقتصاد والمالية",          icon: "📊", hint: "قانون المالية، الميزانية، الأسعار" },
    { slug: "governance", label: "الإدارة والحكامة",           icon: "🏛️", hint: "الحكومة، الإدارة الرقمية، المراقبة" },
  ];
  const OTHER = { slug: "other", label: "مجالات أخرى", icon: "📄", hint: "" };
  const BY = {};
  CATEGORIES.concat([OTHER]).forEach((c) => (BY[c.slug] = c));

  const catOf = (r) => (BY[r.category] ? r.category : "other");

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  // التقارير المنشورة فقط (الاستعلام ضروري باش تقبلو قواعد Firestore)
  async function fetchPublished() {
    const cfg = window.FIREBASE_CONFIG;
    const url = "https://firestore.googleapis.com/v1/projects/" + cfg.projectId +
      "/databases/(default)/documents:runQuery?key=" + encodeURIComponent(cfg.apiKey);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "siyasat_reports" }],
          where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } },
          select: { fields: ["title", "category", "date", "source"].map((f) => ({ fieldPath: f })) },
          limit: 300,
        },
      }),
    });
    if (!r.ok) throw new Error("تعذر جلب التقارير (" + r.status + ")");
    const rows = await r.json();
    return rows
      .filter((x) => x.document)
      .map((x) => {
        const o = { id: x.document.name.split("/").pop() };
        const f = x.document.fields || {};
        for (const k in f) o[k] = f[k].stringValue || "";
        return o;
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  function countBy(list) {
    const c = { all: list.length };
    list.forEach((r) => { const k = catOf(r); c[k] = (c[k] || 0) + 1; });
    return c;
  }

  // شبكة البطاقات (الصفحة الرئيسية)
  function renderGrid(box, counts, base) {
    box.replaceChildren();
    CATEGORIES.forEach((c) => {
      const n = counts[c.slug] || 0;
      const a = el("a", null, "cat-card" + (n ? "" : " is-empty"));
      a.href = base + "?cat=" + c.slug;
      a.append(
        el("span", c.icon, "cat-icon"),
        el("strong", c.label, "cat-name"),
        el("span", c.hint, "cat-hint"),
        el("span", n ? n + " تقرير" : "قريبا", "cat-count")
      );
      box.append(a);
    });
  }

  // أزرار الفلترة (صفحة التقارير)
  function renderPills(box, counts, active, onPick) {
    box.replaceChildren();
    const all = [{ slug: "all", label: "الكل" }].concat(CATEGORIES, counts.other ? [OTHER] : []);
    all.forEach((c) => {
      const b = el("button", c.label + " (" + (counts[c.slug] || 0) + ")", "pill");
      b.type = "button";
      b.setAttribute("aria-pressed", String(c.slug === active));
      b.onclick = () => onPick(c.slug);
      box.append(b);
    });
  }

  // لائحة التقارير
  function renderList(box, list) {
    box.replaceChildren();
    if (!list.length) { box.append(el("p", "ما كاين حتى تقرير فهاد المجال دابا.", "empty")); return; }
    list.forEach((r) => {
      const a = el("a", null, "report-card");
      a.href = "index.html#" + r.id;
      const c = BY[catOf(r)];
      a.append(
        el("span", c.icon + " " + c.label, "report-cat"),
        el("strong", r.title, "report-title"),
        el("span", r.date ? new Date(r.date).toLocaleDateString("fr-FR") : "", "report-date")
      );
      box.append(a);
    });
  }

  window.SiyasatCats = { CATEGORIES, catOf, fetchPublished, countBy, renderGrid, renderPills, renderList };
})();
