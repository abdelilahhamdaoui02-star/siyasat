# النشر على Google (Firebase + Cloud Run)

- **الدخول للإدارة**: Firebase Authentication (بريد + كلمة مرور). الحساب كيتحسب أدمين ملي كتكون وثيقة باسم الـ UID ديالو فمجموعة `admins` فـ Firestore (بحال spesocial).
- **التقارير والوسطاء**: كيتخزنو فـ Firestore (مجموعتي `siyasat_reports` و`siyasat_sources`).
- **الموقع**: Cloud Run (عمومي، https أوتوماتيكي). كل واحد يقدر يشوف التقارير، والإدارة غير للأدمين.

## 1. مشروع Firebase
فـ https://console.firebase.google.com:
- دير مشروع جديد، **أو استعمل مشروع عندك** (إلا استعملتي نفس مشروع spesocial، نفس حساب الأدمين غادي يخدم، والمجموعات ديال siyasat منفصلة).
- **Authentication > Sign-in method**: فعّل **Email/Password**.
- **Firestore Database**: دير قاعدة (إلا ما كايناش)، منطقة `europe-west1`.

## 2. إعداد الويب
**Project settings > Your apps > Web (</>)**: سجل تطبيق، ونسخ القيم لـ `firebase-config.json`:
```json
{
  "apiKey": "…",
  "authDomain": "اسم-المشروع.firebaseapp.com",
  "projectId": "اسم-المشروع"
}
```
(هادو قيم عمومية، ماشي أسرار. الحماية هي حساب الأدمين وقواعد Firestore.)

## 3. حساب الأدمين
1. **Authentication > Users > Add user**: بريد وكلمة مرور قوية. نسخ **User UID**.
2. **Firestore > Start collection** سميتها `admins`، و**Document ID = الـ UID** بالضبط، وزيد حقل `email` (string).

## 4. قواعد Firestore
فـ **Firestore > Rules** زيد هاد القاعدة (**بلا ما تمسح القواعد اللي عندك**):
```
match /admins/{uid} {
  allow get: if request.auth != null && request.auth.uid == uid;
}
```
مجموعات `siyasat_*` كيقراوها ويكتبوها غير الخادم، فما خاصهاش قواعد للمتصفح.

## 5. جربو فكمبيوترك
```powershell
cd "C:\projects 1\siyasat\siyasat"
npm install
node server.js
```
افتح http://localhost:3000/admin.html ودخل بالبريد وكلمة المرور ديال الأدمين. (محليا التخزين كيبقى فملفات `data\`.)
إلا ظهر "ماشي أدمين" كيعطيك الـ UID، تأكد أنه نفس سمية الوثيقة فـ `admins`.

## 6. النشر على Cloud Run
خاص الخادم يتنشر فـ **نفس مشروع Google Cloud ديال Firebase** (نفس الـ projectId)، والفوترة مفعّلة، و`gcloud` مثبت.
```powershell
gcloud auth login
$PROJECT="اسم-المشروع"
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com

cd "C:\projects 1\siyasat\siyasat"
gcloud run deploy siyasat --source . --region europe-west1 --allow-unauthenticated --max-instances 1
```
فالأخير كيبان الرابط العام (بحال `https://siyasat-xxxxx.a.run.app`)، والإدارة فـ `الرابط/admin.html`.

اختياري (للتوليد الحقيقي): زيد `--set-env-vars ANTHROPIC_API_KEY=...` (الأحسن Secret Manager).

## ملاحظات
- `--allow-unauthenticated` ضروري باش الموقع يكون عمومي. الإدارة محمية بـ Firebase.
- `--max-instances 1` ضروري (الخادم كيحمل التقارير فالذاكرة ملي كيبدأ).
- إلا ظهر خطأ صلاحيات فـ Firestore: عطي الحساب `PROJECT_NUMBER-compute@developer.gserviceaccount.com` الدور `roles/datastore.user`.
- بدل `firebase-config.json` تقدر تستعمل متغيرات: `FIREBASE_API_KEY` و`FIREBASE_PROJECT_ID` (و`FIREBASE_AUTH_DOMAIN`).
- تقدر تقيّد الـ apiKey فـ Google Cloud Console (HTTP referrers) على دومين الموقع.
- التقارير اللي فـ `data\` المحلية ما كتنتقلش أوتوماتيكيا: عاود دخلها من `/admin.html`.
- التحديث: عاود أمر النشر.

## 7. الأمان والحماية (قبل ما تعلن عن الموقع)
1. **قواعد Firestore**: تأكد أن آخر قاعدة هي:
   ```
   match /{document=**} { allow read, write: if false; }
   ```
   (غير `admins/{uid}` فيها `allow get` للمالك). الخادم كيدوز عبر حساب الخدمة وما كيتأثرش.
2. **تقييد apiKey**: Google Cloud Console > APIs & Services > Credentials > الـ key ديال الويب: Application restrictions = HTTP referrers (الدومين ديالك)، وAPI restrictions = Identity Toolkit API وToken Service API.
3. **Authentication > Settings > User actions**: عطّل "Enable create (sign up)". خلي غير حساب الأدمين، بكلمة مرور طويلة، وفعّل MFA.
4. **Budget alert**: Billing > Budgets & alerts.
5. **Backups**: Firestore > Disaster recovery: فعّل Scheduled backups أو Point-in-time recovery.
6. **مفتاح Anthropic**: Secret Manager (`--set-secrets ANTHROPIC_API_KEY=anthropic-key:latest`).

## 8. الدومين و SEO
- متغير اختياري `SITE_URL` (بحال `https://siyasat.ma`) كيستعمل فـ sitemap وcanonical. زيدو فالنشر: `--set-env-vars SITE_URL=https://...`
- بعد ما يخدم الدومين، سجل الموقع فـ Google Search Console وصيفط `SITE_URL/sitemap.xml`.
- عمر `[[ ]]` فـ `public/about.html` (الاسم، البريد، فقرة الخصوصية).

## 9. أول مرة (lock file)
خدم `npm install` مرة وحدة فمجلد المشروع، باش يتخلق `package-lock.json` ويتحط فـ Git. الـ Dockerfile كيستعمل `npm ci` إلا لقاه.
