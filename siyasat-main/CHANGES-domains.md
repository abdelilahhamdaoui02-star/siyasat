# تصنيف حسب المجال: شنو تبدل

- `domains.js` (جديد): لائحة المجالات (id, label, hint, icon, color). زيد مجال = زيد سطر.
- `server.js`: `GET /api/domains` (المجالات + عدد التقارير)، و`/api/reports` كيرجع `domain` و`highlight`. الإدارة كتقبل `domain` و`highlight` (كيتحققو منهم).
- `public/index.html`: شبكة بطاقات المجالات + أزرار التصفية (Pills) + بطاقة تقرير فيها المجال والرقم البارز. الروابط: `/#reports/health`.
- `public/admin.html`: قائمة «المجال» وحقل «الرقم البارز» فالمحرر.
- التقارير القديمة (بلا `domain`) كتبقى خدامة وكتبان فـ «الكل».
