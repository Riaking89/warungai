import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db, ensureAnonAuth, initDeviceModel, nanoAvailability } from './firebase';
import { generateText, replyPrompt, descPrompt, captionPrompt } from './ai';

const SHOP_NAME = 'Warung Ria';
const SHOP_ID = 'demo';
const LS_PRODUCTS = 'warungai-products-v1';
const LS_DRAFTS = 'warungai-drafts-v1';

const SEED_PRODUCTS = [
  { name: 'Kopi Gula Aren 250g', price: 25000, stock: 12 },
  { name: 'Keripik Singkong Balado 200g', price: 15000, stock: 30 },
  { name: 'Teh Melati 100g', price: 18000, stock: 0 },
  { name: 'Gula Merah Asli 500g', price: 22000, stock: 8 },
];

const SAMPLE_QUESTIONS = [
  'Kak, kopi gula aren harganya berapa?',
  'Teh melatinya masih ada stok nggak?',
  'Bisa COD nggak kak?',
  'Keripik singkongnya pedes banget nggak?',
];

function rp(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLS(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export default function App() {
  const [products, setProducts] = useState(() => loadLS(LS_PRODUCTS, SEED_PRODUCTS));
  const [drafts, setDrafts] = useState(() => loadLS(LS_DRAFTS, []));
  const [online, setOnline] = useState(navigator.onLine);
  const [nano, setNano] = useState('mengecek…');
  const [nanoProgress, setNanoProgress] = useState(null);
  const [firestoreOk, setFirestoreOk] = useState(null); // null=belum dicek, true/false
  const [uid, setUid] = useState(null);
  const [authError, setAuthError] = useState(null);

  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newStock, setNewStock] = useState('');
  const [adding, setAdding] = useState(false);

  const [question, setQuestion] = useState(SAMPLE_QUESTIONS[0]);
  const [reply, setReply] = useState(null);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState(null);

  const [selProduct, setSelProduct] = useState(0);
  const [copyOut, setCopyOut] = useState(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState(null);

  const productsRef = useRef(products);
  productsRef.current = products;

  // --- services ------------------------------------------------------------
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    nanoAvailability().then((v) => alive && setNano(v));
    ensureAnonAuth().then(({ uid: u, error }) => {
      if (!alive) return;
      setUid(u);
      setAuthError(error);
    });
    // Firestore: try to load the shared demo shop; fall back to local data.
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'shops', SHOP_ID, 'products'));
        if (!alive) return;
        if (!snap.empty) {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setProducts(rows);
          saveLS(LS_PRODUCTS, rows);
          setFirestoreOk(true);
        } else {
          // Empty cloud shop: seed it once (best-effort).
          setFirestoreOk(true);
          for (const p of SEED_PRODUCTS) {
            try {
              await addDoc(collection(db, 'shops', SHOP_ID, 'products'), {
                ...p,
                createdAt: serverTimestamp(),
              });
            } catch {}
          }
        }
      } catch (e) {
        if (!alive) return;
        console.warn('[WarungAI] Firestore read failed, using local data:', e.code || e.message);
        setFirestoreOk(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persistProducts = (rows) => {
    setProducts(rows);
    saveLS(LS_PRODUCTS, rows);
  };

  const persistDrafts = (rows) => {
    setDrafts(rows);
    saveLS(LS_DRAFTS, rows);
  };

  async function addProduct(e) {
    e.preventDefault();
    const name = newName.trim();
    const price = Number(newPrice);
    const stock = Number(newStock);
    if (!name || !(price > 0) || !(stock >= 0)) return;
    setAdding(true);
    const row = { name, price, stock };
    try {
      const ref = await addDoc(collection(db, 'shops', SHOP_ID, 'products'), {
        ...row,
        createdAt: serverTimestamp(),
      });
      persistProducts([...productsRef.current, { id: ref.id, ...row }]);
      setFirestoreOk(true);
    } catch (err) {
      // Firestore belum aktif / aturan belum dibuka: simpan lokal saja.
      setFirestoreOk(false);
      persistProducts([...productsRef.current, { id: 'local-' + Date.now(), ...row }]);
    }
    setNewName('');
    setNewPrice('');
    setNewStock('');
    setAdding(false);
  }

  async function saveDraft(record) {
    const row = { ...record, at: new Date().toISOString() };
    persistDrafts([row, ...drafts].slice(0, 20));
    try {
      await addDoc(collection(db, 'shops', SHOP_ID, 'drafts'), {
        ...record,
        createdAt: serverTimestamp(),
      });
      setFirestoreOk(true);
    } catch {
      setFirestoreOk(false);
    }
  }

  async function runReply() {
    if (!question.trim() || replyBusy) return;
    setReplyBusy(true);
    setReplyError(null);
    setReply(null);
    try {
      const out = await generateText({
        kind: 'reply',
        prompt: replyPrompt({ shopName: SHOP_NAME, products: productsRef.current, customerMessage: question.trim() }),
        onProgress: (p) => setNanoProgress(p),
      });
      setReply({ ...out, task: 'Balas chat', input: question.trim() });
      saveDraft({ task: 'Balas chat', input: question.trim(), output: out.text, source: out.sourceRaw, ms: out.ms });
    } catch (e) {
      setReplyError(friendlyAiError(e));
    }
    setReplyBusy(false);
  }

  async function runCopy(kind) {
    const product = productsRef.current[selProduct];
    if (!product || copyBusy) return;
    setCopyBusy(true);
    setCopyError(null);
    setCopyOut(null);
    try {
      const prompt =
        kind === 'caption'
          ? captionPrompt({ shopName: SHOP_NAME, product })
          : descPrompt({ product });
      const out = await generateText({
        kind,
        prompt,
        onProgress: (p) => setNanoProgress(p),
      });
      const task = kind === 'caption' ? 'Caption panjang (cloud)' : 'Deskripsi singkat (perangkat)';
      setCopyOut({ ...out, task, input: product.name });
      saveDraft({ task, input: product.name, output: out.text, source: out.sourceRaw, ms: out.ms });
    } catch (e) {
      setCopyError(friendlyAiError(e));
    }
    setCopyBusy(false);
  }

  async function activateDevice() {
    setNano('mengunduh…');
    await initDeviceModel((p) => setNanoProgress(p));
    setNano(await nanoAvailability());
  }

  function copyText(t) {
    navigator.clipboard?.writeText(t).catch(() => {});
  }

  const nanoLabel = useMemo(() => {
    const map = {
      available: 'Gemini Nano: tersedia di perangkat',
      downloadable: 'Gemini Nano: bisa diunduh',
      downloading: 'Gemini Nano: sedang diunduh…',
      unavailable: 'Gemini Nano: tidak tersedia di browser ini',
      unsupported: 'Prompt API: tidak didukung browser ini',
      unknown: 'Gemini Nano: status tidak diketahui',
    };
    return map[nano] || `Gemini Nano: ${nano}`;
  }, [nano]);

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-top">
          <span className="logo">🛍️ WarungAI</span>
          <span className="pill pill-cloud">Hackathon #BuildHybridAI 2026</span>
        </div>
        <h1>Asisten jualan untuk warung.</h1>
        <p className="sub">
          Balasan chat pelanggan dibuat <b>di perangkat</b> — cepat, privat, gratis, tetap jalan
          saat offline. Caption jualan yang panjang dibuat di <b>cloud</b>. Semua lewat Firebase AI
          Logic: SDK yang memilih jalurnya, bukan aplikasinya.
        </p>
        <div className="status">
          <span className={`pill ${online ? 'pill-ok' : 'pill-warn'}`}>
            {online ? '● Online' : '● Offline'}
          </span>
          <span className="pill">{nanoLabel}</span>
          {nanoProgress !== null && nanoProgress < 1 && (
            <span className="pill pill-warn">Unduh model: {Math.round(nanoProgress * 100)}%</span>
          )}
          <span className={`pill ${firestoreOk === false ? 'pill-warn' : 'pill-ok'}`}>
            {firestoreOk === null
              ? 'Firestore: mengecek…'
              : firestoreOk
                ? 'Firestore: terhubung'
                : 'Firestore: belum aktif — data tersimpan lokal'}
          </span>
          <span className="pill">{uid ? `Masuk sebagai ${uid.slice(0, 8)}…` : 'Tanpa login (anonim belum aktif)'}</span>
          {authError && <span className="pill pill-warn">Auth: {authError}</span>}
        </div>
        {nano !== 'available' && (
          <button className="btn btn-secondary" onClick={activateDevice}>
            Aktifkan AI di perangkat (unduh Gemini Nano)
          </button>
        )}
      </header>

      <main>
        <section className="card">
          <h2>🛒 Produk {SHOP_NAME}</h2>
          <ul className="products">
            {products.map((p, i) => (
              <li key={p.id || i} className={Number(p.stock) <= 0 ? 'out' : ''}>
                <span className="pname">{p.name}</span>
                <span className="pprice">{rp(p.price)}</span>
                <span className={`pstock ${Number(p.stock) <= 0 ? 'habis' : ''}`}>
                  {Number(p.stock) <= 0 ? 'Habis' : `Stok ${p.stock}`}
                </span>
              </li>
            ))}
          </ul>
          <form className="addform" onSubmit={addProduct}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nama produk" />
            <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Harga (Rp)" inputMode="numeric" />
            <input value={newStock} onChange={(e) => setNewStock(e.target.value)} placeholder="Stok" inputMode="numeric" />
            <button className="btn" type="submit" disabled={adding}>
              {adding ? 'Menyimpan…' : '+ Tambah produk'}
            </button>
          </form>
        </section>

        <section className="card">
          <h2>💬 Balas chat pelanggan <span className="tag">on-device dulu</span></h2>
          <p className="hint">
            Draf balasan dibuat dari data produk toko yang sebenarnya. Kalau Gemini Nano tersedia,
            jawaban dibuat di perangkat — tanpa internet, tanpa biaya.
          </p>
          <div className="chips">
            {SAMPLE_QUESTIONS.map((q) => (
              <button key={q} className={`chip ${question === q ? 'active' : ''}`} onClick={() => setQuestion(q)}>
                {q}
              </button>
            ))}
          </div>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} />
          <button className="btn btn-primary" onClick={runReply} disabled={replyBusy}>
            {replyBusy ? 'Menulis draf…' : '✍️ Buat draf balasan'}
          </button>
          {replyError && <div className="error">⚠️ {replyError}</div>}
          {reply && <ResultCard result={reply} onCopy={copyText} />}
        </section>

        <section className="card">
          <h2>✨ Deskripsi &amp; caption jualan</h2>
          <p className="hint">
            Deskripsi singkat dibuat di perangkat. Caption panjang (butuh kreativitas lebih) dibuat
            di cloud — tombolnya sengaja beda jalur.
          </p>
          <label className="lbl">
            Produk
            <select value={selProduct} onChange={(e) => setSelProduct(Number(e.target.value))}>
              {products.map((p, i) => (
                <option key={p.id || i} value={i}>
                  {p.name} — {rp(p.price)}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button className="btn" onClick={() => runCopy('desc')} disabled={copyBusy}>
              📝 Deskripsi singkat
            </button>
            <button className="btn btn-primary" onClick={() => runCopy('caption')} disabled={copyBusy}>
              ☁️ Caption panjang (cloud)
            </button>
          </div>
          {copyBusy && <p className="hint">Menulis…</p>}
          {copyError && <div className="error">⚠️ {copyError}</div>}
          {copyOut && <ResultCard result={copyOut} onCopy={copyText} />}
        </section>

        <section className="card">
          <h2>🕘 Riwayat draf</h2>
          {drafts.length === 0 ? (
            <p className="hint">Belum ada draf. Buat balasan atau caption di atas.</p>
          ) : (
            <ul className="history">
              {drafts.map((d, i) => (
                <li key={i}>
                  <div className="h-head">
                    <b>{d.task}</b>
                    <span className={`badge ${d.source === 'on_device' ? 'badge-device' : 'badge-cloud'}`}>
                      {d.source === 'on_device' ? 'On-device · Gemini Nano' : 'Cloud · Gemini Flash'}
                    </span>
                    <span className="h-ms">{d.ms} ms</span>
                  </div>
                  <div className="h-in">“{d.input}”</div>
                  <div className="h-out">{d.output}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer>
        Dibangun dengan <b>Firebase AI Logic</b> (Hybrid Inference SDK) — mode{' '}
        <code>PREFER_ON_DEVICE</code> untuk balasan &amp; deskripsi, <code>PREFER_IN_CLOUD</code>{' '}
        untuk caption panjang. Badge di setiap jawaban berasal dari{' '}
        <code>response.inferenceSource</code> yang dilaporkan SDK — bukan ditebak aplikasi.
        Data produk tersimpan di Firestore (jatuh ke penyimpanan lokal kalau Firestore belum aktif).
      </footer>
    </div>
  );
}

function ResultCard({ result, onCopy }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="result">
      <div className="r-head">
        <span className={`badge ${result.source.cls}`}>{result.source.full}</span>
        <span className="h-ms">{result.ms} ms</span>
        <button
          className="btn btn-small"
          onClick={() => {
            onCopy(result.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? '✓ Tersalin' : '📋 Salin'}
        </button>
      </div>
      <p className="r-text">{result.text}</p>
    </div>
  );
}

function friendlyAiError(e) {
  const msg = e?.message || String(e);
  if (/permission|API key not valid|API_KEY_INVALID/i.test(msg)) {
    return 'Firebase AI Logic / Gemini API belum aktif di project ini (atau App Check belum terdaftar). Aktifkan di Firebase console: AI Logic → Get started, lalu daftarkan debug token App Check. Detail: ' + msg;
  }
  if (/fetch|network|Failed to fetch/i.test(msg)) {
    return 'Tidak bisa mencapai layanan AI (periksa koneksi). Kalau offline, balasan on-device tetap bisa jalan setelah model Nano terunduh. Detail: ' + msg;
  }
  return 'AI gagal menjawab: ' + msg;
}
