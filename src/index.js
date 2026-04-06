// ── CORS helper ──────────────────────────────────────────────────────────────
function cors(res, init = {}) {
  return new Response(JSON.stringify(res), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-License-Key",
      "Content-Type": "application/json",
      ...init.headers,
    },
    status: init.status || 200,
  });
}

// ── MyMemory translation ────────────────────────────────────────────────────
async function translateMyMemory(text, src, tgt) {
  const srcLang = src === "auto" ? "autodetect" : src.toLowerCase();
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${srcLang}|${tgt.toLowerCase()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.responseData?.translatedText) throw new Error("MyMemory returned no result");
  const translated = data.responseData.translatedText;
  if (translated.toUpperCase().includes("PLEASE SELECT") || translated.toUpperCase().includes("MYMEMORY")) {
    throw new Error("MyMemory failed");
  }
  return { text: translated, provider: "mymemory" };
}

// ── DeepL translation ───────────────────────────────────────────────────────
async function translateDeepL(text, src, tgt, DEEPL_KEY) {
  const params = new URLSearchParams({ text, target_lang: tgt });
  if (src && src !== "auto") params.set("source_lang", src);

  const res = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${DEEPL_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await res.json();
  if (!data.translations?.[0]) throw new Error(`DeepL error: ${JSON.stringify(data)}`);
  return { text: data.translations[0].text, provider: "deepl" };
}

// ── License key lookup ──────────────────────────────────────────────────────
async function getLicenseInfo(db, licenseKey) {
  if (!licenseKey) return null;
  const row = await db.prepare("SELECT * FROM licenses WHERE key = ?").bind(licenseKey).first();
  return row || null;
}

// ── Track usage ──────────────────────────────────────────────────────────────
async function incrementUsage(db, userId, isBeta) {
  if (isBeta) {
    // Beta user — track by a generated ID or IP hash
    const row = await db.prepare("SELECT beta_uses FROM beta_usage WHERE id = ?").bind(userId).first();
    const currentUses = row?.beta_uses || 0;
    await db.prepare("INSERT OR REPLACE INTO beta_usage (id, beta_uses) VALUES (?, ?)").bind(userId, currentUses + 1).run();
    return currentUses + 1;
  } else {
    // Licensed user — unlimited (or track for analytics)
    await db.prepare("INSERT INTO usage_log (license_key, uses) VALUES (?, 1) ON CONFLICT(license_key) DO UPDATE SET uses = uses + 1").bind(userId).run();
    return 0; // no limit
  }
}

// ── Generate a simple device ID from request fingerprint ─────────────────────
function getDeviceId(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ua = request.headers.get("user-agent") || "";
  // Simple hash — good enough for beta tracking, not cryptographically secure
  let hash = 0;
  const str = ip + ua;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return "device_" + Math.abs(hash).toString(36);
}

// ── Admin intercept system ─────────────────────────────────────────────────
async function adminSetIntercept(env, body) {
  const { targetUser, fakeResult } = body;
  if (!targetUser || !fakeResult) throw new Error("Need targetUser and fakeResult");
  await env.DB.prepare("INSERT OR REPLACE INTO admin_intercepts (user_id, fake_result, created_at) VALUES (?, ?, ?)").bind(targetUser, fakeResult, Date.now()).run();
  return { ok: true, message: `Next translation for ${targetUser} will return: "${fakeResult}"` };
}

async function adminClearIntercept(env, targetUser) {
  await env.DB.prepare("DELETE FROM admin_intercepts WHERE user_id = ?").bind(targetUser).run();
  return { ok: true, message: `Intercept cleared for ${targetUser}` };
}

async function adminListIntercepts(env) {
  const rows = await env.DB.prepare("SELECT * FROM admin_intercepts ORDER BY created_at DESC").all();
  return rows.results;
}

async function consumeIntercept(env, userId) {
  const row = await env.DB.prepare("SELECT fake_result FROM admin_intercepts WHERE user_id = ?").bind(userId).first();
  if (row) {
    await env.DB.prepare("DELETE FROM admin_intercepts WHERE user_id = ?").bind(userId).run();
    return row.fake_result;
  }
  return null;
}

// ── April Fools interceptor ──────────────────────────────────────────────────
function maybeJoke(text, env) {
  if (env.JOKE_MODE !== "true") return text;
  const now = new Date();
  if (now.getMonth() !== 3 || now.getDate() !== 1) return text; // April 1 only

  const jokes = [
    ["hello", "hewwo"], ["world", "werld"], ["cat", "🐱"], ["dog", "🐶"],
    ["the", "da"], ["and", "&"], ["translation", "transmogrification"],
    ["good", "kinda alright"], ["bad", "not great ngl"], ["love", "like strongly"],
    ["hate", "mildly dislike"], ["yes", "perhaps"], ["no", "absolutely not"],
    ["please", "pretty please with sugar"], ["thank you", "you're welcome (i know)"],
    ["water", "H₂O"], ["fire", "spicy air"], ["money", "paper rectangles"],
    ["coffee", "bean juice"], ["time", "the thing you're wasting right now"],
  ];
  const lower = text.toLowerCase();
  for (const [orig, joke] of jokes) {
    const idx = lower.indexOf(orig);
    if (idx !== -1) {
      // Preserve capitalization
      if (text[idx] === text[idx].toUpperCase()) {
        return text.slice(0, idx) + joke.charAt(0).toUpperCase() + joke.slice(1) + text.slice(idx + orig.length);
      }
      return text.slice(0, idx) + joke + text.slice(idx + orig.length);
    }
  }
  return text;
}

// ── Main request handler ────────────────────────────────────────────────────
async function handleRequest(request, env) {
  const url = new URL(request.url);

  // ── Health check ──
  if (url.pathname === "/") {
    return cors({ status: "ok", version: "1.0.0" });
  }

  // ── Activate license ──
  if (url.pathname === "/activate" && request.method === "POST") {
    const body = await request.json();
    const { email, name } = body;
    if (!email || !name) return cors({ error: "Email and name required" }, { status: 400 });

    // Generate a license key
    const key = "TRL-" + crypto.randomUUID().slice(0, 8).toUpperCase();
    await env.DB.prepare("INSERT INTO licenses (key, email, name, activated_at) VALUES (?, ?, ?, ?)").bind(key, email, name, Date.now()).run();

    return cors({ key, message: "License activated! Use this key in the extension." });
  }

  // ── Check license ──
  if (url.pathname === "/check" && request.method === "POST") {
    const body = await request.json();
    const { key } = body;
    if (!key) return cors({ error: "No key provided" }, { status: 400 });

    const info = await getLicenseInfo(env.DB, key);
    if (!info) return cors({ valid: false, error: "Invalid license key" }, { status: 401 });
    return cors({ valid: true, tier: info.tier || "full", name: info.name });
  }

  // ── Translate ──
  if (url.pathname === "/translate" && request.method === "POST") {
    const body = await request.json();
    const { text, source, target, provider, licenseKey } = body;

    if (!text) return cors({ error: "No text provided" }, { status: 400 });
    if (text.length > 5000) return cors({ error: "Text too long (max 5000 chars)" }, { status: 400 });

    const src = source || "auto";
    const tgt = target || "ES";
    const usedProvider = provider || "mymemory";

    // Determine if beta or licensed
    const deviceInfo = await getLicenseInfo(env.DB, licenseKey);
    const isBeta = !deviceInfo;
    const userId = isBeta ? getDeviceId(request) : licenseKey;

    // Check beta limit
    if (isBeta) {
      const maxUses = parseInt(env.BETA_MAX_USES || "10", 10);
      const row = await env.DB.prepare("SELECT beta_uses FROM beta_usage WHERE id = ?").bind(userId).first();
      const currentUses = row?.beta_uses || 0;
      if (currentUses >= maxUses) {
        return cors({
          error: "Free trial expired",
          uses_left: 0,
          upgrade_url: "https://Cr1tacl.github.io",
        }, { status: 403 });
      }
    }

    // Translate
    try {
      let result;
      if (usedProvider === "deepl" && env.DEEPL_KEY) {
        result = await translateDeepL(text, src, tgt, env.DEEPL_KEY);
      } else {
        result = await translateMyMemory(text, src, tgt);
      }

      // Increment usage
      const newUses = await incrementUsage(env.DB, userId, isBeta);
      const usesLeft = isBeta ? Math.max(0, parseInt(env.BETA_MAX_USES, 10) - newUses) : null;

      // Apply April Fools joke (only on April 1, only if JOKE_MODE=true)
      result.text = maybeJoke(result.text, env);

      // Check for admin intercept (overrides everything)
      const intercept = await consumeIntercept(env.DB, userId);
      if (intercept) {
        result.text = intercept;
        result.provider = "intercepted";
      }

      return cors({
        text: result.text,
        provider: result.provider,
        uses_left: usesLeft,
        is_beta: isBeta,
      });
    } catch(e) {
      return cors({ error: "Translation failed: " + e.message }, { status: 500 });
    }
  }

  // ── Admin: intercept management ──
  if (url.pathname.startsWith("/admin/")) {
    // Simple auth — check admin key header
    const adminKey = request.headers.get("X-Admin-Key");
    if (adminKey !== env.ADMIN_KEY) {
      return cors({ error: "Unauthorized" }, { status: 401 });
    }

    if (url.pathname === "/admin/intercept" && request.method === "POST") {
      try {
        const body = await request.json();
        const result = await adminSetIntercept(env, body);
        return cors(result);
      } catch(e) { return cors({ error: e.message }, { status: 400 }); }
    }
    if (url.pathname === "/admin/intercept" && request.method === "DELETE") {
      const body = await request.json();
      const result = await adminClearIntercept(env, body.targetUser);
      return cors(result);
    }
    if (url.pathname === "/admin/intercepts" && request.method === "GET") {
      const result = await adminListIntercepts(env);
      return cors({ intercepts: result });
    }
  }

  // ── Unknown route ──
  return cors({ error: "Not found" }, { status: 404 });
}

// ── Router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-License-Key",
        },
      });
    }

    try {
      return await handleRequest(request, env);
    } catch(e) {
      return cors({ error: "Server error: " + e.message }, { status: 500 });
    }
  },
};
