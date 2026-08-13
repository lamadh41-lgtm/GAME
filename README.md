# Story Mode

## ملفات ZIP (النسخ)

ضع أي عدد من ملفات `.zip` بجانب `index.html`:

```
story-mode/
  index.html
  main.js
  packs.json
  الشامل.zip
  story-data.zip
```

اللعبة تكتشف الملفات وتعرضهم في قائمة عند إنشاء أو انضمام اللوبي.

### packs.json (مهم على GitHub Pages)

المتصفح لا يقرأ فولدر GitHub مباشرة، فسجّل أسماء الملفات هنا:

```json
[
  "الشامل.zip",
  "story-data.zip"
]
```

عند إضافة ZIP جديد: أضفه للفولدر + لـ packs.json.

### محلياً

مع سيرفر ملفات بسيط، قد تُكتشف ملفات ZIP من فهرس المجلد أيضاً.

## اللوبي

- القائد: رمز + اختيار النسخة → تأكيد
- المنضم: نفس الرمز + نفس النسخة → تأكيد (ملابس فقط)

## الأونلاين (سيرفر القائد فقط — من غير VPN)

زر **أونلاين** مربوط فقط بالشخص اللي شغّال عنده `python lan_host.py`.

### على جهاز القائد

1. شغّل السيرفر:
   ```
   python lan_host.py
   ```
2. للأونلاين من أي مكان (من غير Radmin/VPN) افتح تيرمينال تاني:
   ```
   cloudflared tunnel --url http://localhost:27100
   ```
3. انسخ الرابط اللي يطلع مثل:
   `https://xxxx.trycloudflare.com`
4. افتح `index.html` → أونلاين → الصق الرابط في خانة عنوان السيرفر → أنشئ اللوبي.

### اللاعبين (من أي مكان)

- أونلاين → انضمام
- نفس **الرمز** + نفس **رابط trycloudflare.com**
- يرفعوا نفس ملف البيانات (ZIP)

### LAN فقط (نفس البيت / Radmin)

استخدم IP المحلي بدل رابط cloudflared (مثل `192.168.1.10`).

### تحميل cloudflared (مرة واحدة)

https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

صفحة المراقبة: `server.html`
