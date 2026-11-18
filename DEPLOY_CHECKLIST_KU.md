# لیستی deploy و پشکنین

## ١. فایلەکان لە تەنیشت index.html (هەمووی لە یەک فۆڵدەر)
ئامادەن لەم فۆڵدەرە: index.html، sw.js، manifest.webmanifest، adaptive-engine.js، question-bank.v1.json، admin.html، فۆڵدەری img/ (٣٥ وێنە)
**ونن (هیچکامیان نەنێردرابوون، دەبێت خۆت زیادیان بکەیت):**
- icon-192.png
- icon-512.png (لە manifest و sw.js هەیە)
- icon-maskable-512.png (لە manifest هەیە)
- apple-touch-icon.png (180×180)

ئاگاداری: فایلەکەی تۆ بە ناوی `question-bank_v1.json` بوو، بەڵام کۆدەکە `question-bank.v1.json` (بە خاڵ) دەخوێنێتەوە. لێرەدا بە ناوی ڕاستەوە کۆپی کراوە.

## ٢. SRI (من نەمتوانی، ئینتەرنێتم نییە)
لەسەر کۆمپیوتەرێک کە ئینتەرنێتی هەیە:
```
curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js | openssl dgst -sha384 -binary | openssl base64 -A
curl -s https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.min.js | openssl dgst -sha384 -binary | openssl base64 -A
```
پاشان لە index.html (دێڕی ١٤٨٦ و ١٤٨٧) بیخە ناو تاگەکان: `integrity="sha384-..." crossorigin="anonymous"`

## ٣. ئەدمین
خشتەی `admins` لە Supabase بەتاڵە، بۆیە کەس ناتوانێت admin.html بەکاربهێنێت. خۆت بیخە ناوی (بە user id ی خۆت).

## ٤. تاقیکردنەوە (دەبێت خۆت بیکەیت)
iOS Safari: PWA (Add to Home Screen)، ئاگادارکردنەوە، ئۆفلاین، و دوای deploy کاشی v6 نوێ بووبێتەوە.
