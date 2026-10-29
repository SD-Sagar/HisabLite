// A ফর্দ sent as a link: https://<the app>/f/<token> (vercel.json sends /f/... here).
// WhatsApp reads this page to draw the link's preview, so it carries the ফর্দ's card as its
// picture; a person opening it is sent straight on to the app's own page with the whole ফর্দ.
// The pictures are in the public "bills" bucket (see src/lib/billLink.ts).

const WORDS = {
  bn: { title: 'ফর্দ', description: 'পুরো ফর্দ দেখতে চাপুন · খাতায়-কলমে (Khatay-Kalomay)', open: 'ফর্দ খুলুন' },
  hi: { title: 'बिल', description: 'पूरा बिल देखने के लिए दबाएँ · Khatay-Kalomay', open: 'बिल खोलें' },
  en: { title: 'Bill', description: 'Tap to see the whole bill · Khatay-Kalomay', open: 'Open the bill' },
};

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const token = (url.searchParams.get('token') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const asked = url.searchParams.get('l');
  const lang = asked && asked in WORDS ? asked : 'bn';
  const words = WORDS[lang];
  const storage = String(process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const image = token && storage ? `${storage}/storage/v1/object/public/bills/${token}-og.jpg` : '';
  const page = `/#/f/${token}${lang === 'bn' ? '' : `?l=${lang}`}`;

  const preview = image
    ? `<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">`
    : '';

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400');
  res.end(`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${words.title}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Khatay-Kalomay">
<meta property="og:title" content="${words.title}">
<meta property="og:description" content="${words.description}">
${preview}
<meta http-equiv="refresh" content="0; url=${page}">
<script>location.replace(${JSON.stringify(page)})</script>
</head>
<body><a href="${page}">${words.open}</a></body>
</html>`);
}
