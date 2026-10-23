// Cloudflare Pages Function for product-page feedback.
//
//   POST /api/feedback  — public: saves one comment (from dilos-photo.html's form).
//   GET  /api/feedback  — admin: lists comments; needs "Authorization: Bearer <token>".
//
// Bindings (Cloudflare dashboard → the Pages project → Settings):
//   FEEDBACK_DB           D1 database with schema/feedback.sql applied
//   FEEDBACK_ADMIN_TOKEN  secret; the password for feedback-admin.html
//   FEEDBACK_SALT         secret (optional); salts the IP hash used for rate limiting

const PRODUCTS = new Set(['dilos-photo']);
const KINDS = new Set(['feedback', 'feature', 'bug', 'question']);
const MAX_PER_HOUR = 5;          // per sender (by IP hash)
const MIN_FILL_MS = 2500;        // faster than a person can write a message

export async function onRequestPost({ request, env }) {
  if (!env.FEEDBACK_DB) return json({ error: 'Feedback is not set up yet.' }, 503);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  // Bots: the hidden field is filled, or the form was submitted instantly. Answer as if it
  // worked so they don't adapt.
  if (str(data.website) || Number(data.elapsed) < MIN_FILL_MS) return json({ ok: true });

  const product = str(data.product);
  const kind = str(data.kind) || 'feedback';
  const message = str(data.message);
  const name = str(data.name).slice(0, 100) || null;
  const email = str(data.email).slice(0, 200) || null;

  if (!PRODUCTS.has(product) || !KINDS.has(kind)) return json({ error: 'Invalid request.' }, 400);
  if (message.length < 5) return json({ error: 'Please write a few words first.' }, 400);
  if (message.length > 4000) return json({ error: 'Please keep it under 4,000 characters.' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "That email address doesn't look right." }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ipHash = ip ? await sha256(`${env.FEEDBACK_SALT || 'dilos.ai feedback'}:${ip}`) : null;
  if (ipHash) {
    const recent = await env.FEEDBACK_DB
      .prepare("SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')")
      .bind(ipHash)
      .first();
    if (recent && recent.n >= MAX_PER_HOUR) {
      return json({ error: "You've sent several messages recently. Please try again in a little while." }, 429);
    }
  }

  await env.FEEDBACK_DB
    .prepare('INSERT INTO feedback (product, kind, message, name, email, country, user_agent, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(
      product, kind, message, name, email,
      request.cf?.country || null,
      (request.headers.get('User-Agent') || '').slice(0, 300) || null,
      ipHash,
    )
    .run();

  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  if (!env.FEEDBACK_DB || !env.FEEDBACK_ADMIN_TOKEN) return json({ error: 'Feedback is not set up yet.' }, 503);

  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(await sameSecret(token, env.FEEDBACK_ADMIN_TOKEN))) return json({ error: 'Wrong password.' }, 401);

  const url = new URL(request.url);
  const product = url.searchParams.get('product');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 1000);
  const columns = 'id, created_at, product, kind, message, name, email, country, user_agent';
  const statement = product
    ? env.FEEDBACK_DB.prepare(`SELECT ${columns} FROM feedback WHERE product = ? ORDER BY id DESC LIMIT ?`).bind(product, limit)
    : env.FEEDBACK_DB.prepare(`SELECT ${columns} FROM feedback ORDER BY id DESC LIMIT ?`).bind(limit);
  const { results } = await statement.all();
  return json({ feedback: results }, 200);
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Compares hashes rather than the strings, so the time taken doesn't depend on how much of
// the password matched.
async function sameSecret(given, expected) {
  if (!given || !expected) return false;
  return (await sha256(given)) === (await sha256(expected));
}
