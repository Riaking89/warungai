// WarungAI — AI calls. All routing goes through Firebase AI Logic's
// hybrid inference (InferenceMode). The app never chooses a backend itself;
// the badge comes from response.inferenceSource, set by the SDK:
//   "on_device" -> answered by Gemini Nano on this device
//   "in_cloud"  -> answered by Gemini Flash in the cloud
//   undefined   -> SDK did not report a source (shown honestly as "?")
import { hybridModel, cloudModel, initDeviceModel } from './firebase';

export const SOURCE_LABEL = {
  on_device: { short: 'On-device', full: 'On-device · Gemini Nano', cls: 'badge-device' },
  in_cloud: { short: 'Cloud', full: 'Cloud · Gemini Flash', cls: 'badge-cloud' },
  unknown: { short: '?', full: 'Sumber tidak dilaporkan SDK', cls: 'badge-unknown' },
};

function toSourceLabel(raw) {
  if (raw === 'on_device') return SOURCE_LABEL.on_device;
  if (raw === 'in_cloud') return SOURCE_LABEL.in_cloud;
  return SOURCE_LABEL.unknown;
}

/**
 * Single-turn text generation (on-device does not support chat sessions,
 * so the whole context goes into one prompt every time).
 * kind: 'reply' | 'desc' uses PREFER_ON_DEVICE; 'caption' uses PREFER_IN_CLOUD.
 */
export async function generateText({ kind, prompt, onProgress }) {
  const model = kind === 'caption' ? cloudModel : hybridModel;
  // User activation (this call runs inside a click handler) — required
  // before the first on-device request.
  await initDeviceModel(onProgress);
  const t0 = performance.now();
  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = (response.text() || '').trim();
  return {
    text,
    source: toSourceLabel(response.inferenceSource),
    sourceRaw: response.inferenceSource || 'unknown',
    ms: Math.round(performance.now() - t0),
  };
}

export function replyPrompt({ shopName, products, customerMessage }) {
  const list = products
    .map(
      (p) =>
        `- ${p.name}: Rp${Number(p.price || 0).toLocaleString('id-ID')}, stok ${p.stock}${
          Number(p.stock) <= 0 ? ' (HABIS)' : ''
        }`
    )
    .join('\n');
  return [
    `Kamu adalah asisten penjual yang ramah di toko "${shopName}" (warung kecil di Indonesia).`,
    'Tugasmu: tulis SATU draf balasan singkat untuk pesan pelanggan di bawah ini.',
    'Aturan:',
    '- Bahasa Indonesia santai dan sopan, seperti penjual warung yang ramah.',
    '- Jawab HANYA dari data produk di bawah. Kalau produk ditanya stoknya habis, katakan habis dan tawarkan produk lain yang masih ada. Jangan mengarang harga atau stok.',
    '- Maksimal 2 kalimat. Jangan pakai emoji berlebihan (maksimal 1).',
    '- Kalau pelanggan tanya hal di luar produk (misal COD, jam buka), jawab wajar: COD bisa, jam buka 08.00–21.00.',
    '',
    'Data produk toko:',
    list || '(belum ada produk)',
    '',
    `Pesan pelanggan: "${customerMessage}"`,
    '',
    'Draf balasan:',
  ].join('\n');
}

export function descPrompt({ product }) {
  return [
    `Tulis deskripsi produk singkat untuk toko warung, 1–2 kalimat, Bahasa Indonesia yang menarik tapi jujur.`,
    `Produk: ${product.name}, harga Rp${Number(product.price || 0).toLocaleString('id-ID')}, stok ${product.stock}.`,
    'Jangan mengarang bahan atau manfaat yang tidak umum untuk produk seperti ini. Deskripsi saja:',
  ].join('\n');
}

export function captionPrompt({ shopName, product }) {
  return [
    `Kamu adalah copywriter media sosial untuk warung kecil "${shopName}".`,
    `Buat SATU caption Instagram/TikTok yang panjang dan menarik untuk produk ini: ${product.name}, harga Rp${Number(
      product.price || 0
    ).toLocaleString('id-ID')}, stok ${product.stock}.`,
    'Struktur: kalimat pembuka yang bikin penasaran, 2–3 kalimat soal produknya, ajakan beli (DM / datang ke warung), lalu 4–6 hashtag relevan.',
    'Bahasa Indonesia santai, boleh pakai emoji secukupnya. Jangan mengarang promo atau diskon yang tidak ada. Caption saja:',
  ].join('\n');
}
