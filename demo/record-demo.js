// WarungAI demo recorder — runs in GitHub Actions (normal network egress,
// where POSTs to Google APIs work) against the deployed Pages site.
// Records a <3 min video: add product -> reply draft (hybrid, cloud badge here)
// -> long caption (cloud) -> history. Logs step timestamps for captions.
// Run: node demo/record-demo.js   (needs playwright + a Chromium with xvfb)
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const URL = process.env.WARUNGAI_URL || 'https://riaking89.github.io/warungai/';
const OUT = path.join(__dirname, '..', 'demo-video');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
let t0 = Date.now();
const mark = (text) => {
  const t = (Date.now() - t0) / 1000;
  steps.push({ t: +t.toFixed(1), text });
  console.log(`[${t.toFixed(1)}s] ${text}`);
};

async function waitForBadge(page, label, maxSecs) {
  for (let i = 0; i < maxSecs / 2; i++) {
    await sleep(2000);
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
    const badge = (txt.match(/(On-device · Gemini Nano|Cloud · Gemini Flash|Sumber tidak dilaporkan SDK)/g) || [])[0] || null;
    const err = (txt.match(/⚠️[^\n]*/g) || [])[0] || null;
    if (badge || err) return { badge, err };
  }
  return { badge: null, err: null, note: 'timeout ' + maxSecs + 's' };
}

(async () => {
  const browser = await chromium.launch({
    headless: false, // run under xvfb-run so the Prompt API surface exists
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--enable-features=PromptApiForGeminiNano,PromptApiForGeminiNanoMultimodalInput',
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  t0 = Date.now();
  const result = { url: URL, reply: {}, caption: {}, addProduct: {}, steps };
  try {
    mark('WarungAI — asisten jualan warung (Firebase AI Logic, hybrid inference)');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(9000);
    const pills = await page.evaluate(() =>
      document.body.innerText.match(/(Gemini Nano:[^\n]*|Firestore:[^\n]*|Masuk sebagai[^\n]*|Tanpa login[^\n]*|● Online|● Offline)/g)
    );
    console.log('PILLS:', JSON.stringify(pills));
    result.pills = pills;
    await page.screenshot({ path: path.join(OUT, '01-home.png') });

    // 1. Add a product.
    mark('Tambah produk ke toko — tersimpan di Firestore');
    await page.locator('input[placeholder="Nama produk"]').fill('Kopi Tubruk 200g');
    await page.locator('input[placeholder="Harga (Rp)"]').fill('18000');
    await page.locator('input[placeholder="Stok"]').fill('20');
    await page.locator('button', { hasText: 'Tambah produk' }).click({ timeout: 10000 });
    await sleep(6000);
    const listTxt = await page.evaluate(() => document.body.innerText);
    result.addProduct = { name: 'Kopi Tubruk 200g', inList: listTxt.includes('Kopi Tubruk 200g') };
    console.log('ADD:', JSON.stringify(result.addProduct));
    await page.screenshot({ path: path.join(OUT, '02-after-add.png') });

    // 2. Reply draft (hybrid — on-device first, cloud fallback here).
    mark('Balas chat pelanggan — dijawab on-device kalau Nano ada, cloud kalau tidak');
    await page.locator('button', { hasText: 'Kak, kopi gula aren harganya berapa?' }).first().click({ timeout: 10000 });
    await sleep(1000);
    await page.locator('button', { hasText: 'Buat draf balasan' }).first().click({ timeout: 10000 });
    result.reply = await waitForBadge(page, 'reply', 60);
    console.log('REPLY:', JSON.stringify(result.reply));
    if (result.reply.badge) mark('Jawaban: ' + result.reply.badge + ' — badge berasal dari SDK, bukan ditebak aplikasi');
    await sleep(4000);
    await page.screenshot({ path: path.join(OUT, '03-after-reply.png') });

    // 3. Long caption (cloud).
    mark('Caption jualan panjang — dibuat di cloud (Gemini Flash)');
    const opts = await page.locator('select option').allTextContents();
    const idx = opts.findIndex((o) => o.includes('Kopi Tubruk 200g'));
    if (idx >= 0) await page.locator('select').selectOption({ index: idx });
    await page.locator('button', { hasText: 'Caption panjang (cloud)' }).first().click({ timeout: 10000 });
    result.caption = await waitForBadge(page, 'caption', 60);
    console.log('CAPTION:', JSON.stringify(result.caption));
    if (result.caption.badge) mark('Caption: ' + result.caption.badge);
    await sleep(4000);
    await page.screenshot({ path: path.join(OUT, '04-after-caption.png') });

    // 4. History.
    mark('Semua draf tersimpan di riwayat — lengkap dengan badge sumbernya');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(3000);
    await page.screenshot({ path: path.join(OUT, '05-history.png') });
    mark('WarungAI — jualan warung dibantu AI, gratis dan tetap jalan saat offline');
    await sleep(2000);
  } catch (e) {
    result.fatal = String(e).slice(0, 500);
    console.log('FATAL:', result.fatal);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  // Steps -> SRT captions (each caption shows until the next step starts).
  const srt = steps
    .map((s, i) => {
      const end = i + 1 < steps.length ? steps[i + 1].t : s.t + 6;
      const fmt = (x) => {
        const m = Math.floor(x / 60), sec = (x % 60).toFixed(3).padStart(6, '0');
        return `00:${String(m).padStart(2, '0')}:${sec.replace('.', ',')}`;
      };
      return `${i + 1}\n${fmt(s.t)} --> ${fmt(end)}\n${s.text}\n`;
    })
    .join('\n');
  fs.writeFileSync(path.join(OUT, 'steps.srt'), srt);
  fs.writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify(steps, null, 2));
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log('DONE. Video + steps in', OUT);
})();
