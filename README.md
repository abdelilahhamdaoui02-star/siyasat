# سياسات

موقع كيبسط السياسات العمومية بالدارجة المغربية.

## التشغيل (Windows / PowerShell)
1. عمر `firebase-config.json` (شوف `DEPLOY.md`، الخطوات 1 لـ 4).
2. `npm install`
3. `node server.js`

- الموقع العام: http://localhost:3000
- الإدارة: http://localhost:3000/admin.html (دخول بالبريد وكلمة المرور ديال حساب Firebase الأدمين)

متغيرات البيئة (اختيارية): `PORT`، `ANTHROPIC_API_KEY`، `FIREBASE_API_KEY` و`FIREBASE_PROJECT_ID` (بدل firebase-config.json).

## النشر على الأنترنت
شوف `DEPLOY.md` (Google Cloud Run + Firestore). على Cloud Run الخادم كيستعمل Firestore أوتوماتيكيا، ومحليا كيستعمل ملفات `data/`.

## الملفات
- `server.js`: الخادم (الأبواب العامة، الإدارة المحمية، الوسطاء، جلب الروابط).
- `public/index.html`: الصفحة العامة (لائحة التقارير وعرض التقرير).
- `public/about.html`: من نحن والخصوصية (عمر `[[ ]]`).
- `public/siyasat-onepage.html`: نسخة الموقع فصفحة وحدة (ثابتة، بلا خادم).
- `public/admin.html`: صفحة الإدارة (نموذج دخول Firebase + اللوحة، الأبواب محمية فالخادم).
- `firebase-config.json`: إعداد Firebase للويب.
- `data/`: التقارير والوسطاء كملفات JSON. دير منها نسخة احتياطية.

## ملاحظات
- ملفات `data/*.json` ما كتدخلش لـ Git (.gitignore).
- الاستضافات اللي كتمسح الملفات ملي كتعاود التشغيل غادي تضيع ليك التقارير، فتأكد من هادشي قبل النشر.
