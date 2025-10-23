import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import { customers, quotesStore } from './static';
import { rateQuote } from './rate';

type Env = {
  CLIENT_ID: string,
  CLIENT_SECRET: string,
  JWT_SECRET: string
};

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

// Utility: make/verify JWT
async function makeToken(secret: string, sub: string) {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT({ sub, scope: 'quotes:read quotes:write' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}
async function verifyToken(secret: string, token: string) {
  const key = new TextEncoder().encode(secret);
  return await jwtVerify(token, key);
}

// -- healthcheck
app.get('/health', (c) => c.text('OK'));

// ---------- Matching helpers ----------
function normalizeEmail(s?: string) {
  return (s || '').trim().toLowerCase();
}
function normalizePhone(s?: string) {
  return (s || '').replace(/\D/g, ''); // digits only
}
function normalizeZip(s?: string) {
  return (s || '').trim().slice(0, 5);
}
function normalizeName(s?: string) {
  return (s || '').trim().toLowerCase();
}

/**
 * Find a customer by:
 * 1) (email OR phone) + zip (strong)
 * 2) email-only OR phone-only
 * 3) first+last+zip
 */
function findCustomer(p: any) {
  const email = normalizeEmail(p?.email);
  const phone = normalizePhone(p?.phone);
  const zip = normalizeZip(p?.zipcode);
  const first = normalizeName(p?.first_name);
  const last = normalizeName(p?.last_name);

  // 1) Strong match: (email OR phone) + zip
  let hit = customers.find((x) => {
    const xEmail = normalizeEmail(x.person.email);
    const xPhone = normalizePhone(x.person.phone);
    const xZip = normalizeZip(x.person.zipcode);
    const emailMatch = email && xEmail && xEmail === email;
    const phoneMatch = phone && xPhone && xPhone === phone;
    const zipMatch = zip && xZip && xZip === zip;
    return (emailMatch || phoneMatch) && zipMatch;
  });
  if (hit) return hit;

  // 2) Email-only or phone-only
  hit = customers.find((x) => {
    const xEmail = normalizeEmail(x.person.email);
    const xPhone = normalizePhone(x.person.phone);
    return (email && xEmail === email) || (phone && xPhone === phone);
  });
  if (hit) return hit;

  // 3) Name + ZIP
  if (first && last && zip) {
    hit = customers.find((x) => {
      const xFirst = normalizeName(x.person.first_name);
      const xLast = normalizeName(x.person.last_name);
      const xZip = normalizeZip(x.person.zipcode);
      return xFirst === first && xLast === last && xZip === zip;
    });
  }

  return hit || null;
}

// --- OAuth: Authorization Code (simulated consent) ---
app.get('/oauth/authorize', (c) => {
  const url = new URL(c.req.url);
  const redirect_uri = url.searchParams.get('redirect_uri') || '';
  const state = url.searchParams.get('state') || '';
  // In a real app, render a consent page. Here we auto-approve for demo:
  const code = 'demo-code';
  const location = `${redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  return c.redirect(location, 302);
});

// --- OAuth: Token endpoint ---
app.post('/oauth/token', async (c) => {
  const body = await c.req.parseBody();
  const grant_type = String(body['grant_type'] || '');
  const cid = String(body['client_id'] || '');
  const cs = String(body['client_secret'] || '');
  const code = String(body['code'] || '');

  if (!cid || !cs || cid !== c.env.CLIENT_ID || cs !== c.env.CLIENT_SECRET) {
    return c.json({ error: 'invalid_client' }, 400);
  }

  if (grant_type === 'client_credentials') {
    const access_token = await makeToken(c.env.JWT_SECRET, cid);
    return c.json({ token_type: 'Bearer', access_token, expires_in: 3600 });
  }

  if (grant_type === 'authorization_code') {
    if (code !== 'demo-code') return c.json({ error: 'invalid_grant' }, 400);
    const access_token = await makeToken(c.env.JWT_SECRET, cid);
    return c.json({ token_type: 'Bearer', access_token, expires_in: 3600, refresh_token: 'demo-refresh' });
  }

  if (grant_type === 'refresh_token') {
    const access_token = await makeToken(c.env.JWT_SECRET, cid);
    return c.json({ token_type: 'Bearer', access_token, expires_in: 3600 });
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
});

// --- Auth middleware ---
async function auth(c: any, next: any) {
  const auth = c.req.header('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  try {
    await verifyToken(c.env.JWT_SECRET, token);
    await next();
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
}

// --- Create quote ---
app.post('/quotes', auth, async (c) => {
  let req: any;
  try {
    req = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const p = req?.person ?? {};
  const providedDrivers = req?.drivers ?? [];
  const providedVehicles = req?.vehicles ?? [];
  const bundle = req?.bundle ?? { homeowners_selected: false };

  try {
    const matched = findCustomer(p);

    const person = matched ? { ...matched.person, ...p } : p;
    const ratedDrivers =
      matched && (!providedDrivers || providedDrivers.length === 0) ? matched.drivers : providedDrivers;
    const ratedVehicles =
      matched && (!providedVehicles || providedVehicles.length === 0) ? matched.vehicles : providedVehicles;

    const breakdown = rateQuote({
      person,
      drivers: ratedDrivers,
      vehicles: ratedVehicles,
      bundle
    });

    const quote_id = uuidv4();
    const resp = {
  quote_id,
  rated_person: person,
  rated_drivers: ratedDrivers,
  rated_vehicles: ratedVehicles,
  discounts_applied: breakdown.discounts_applied,
  premium_breakdown: {
    per_vehicle: breakdown.per_vehicle,
    policy_fee: breakdown.policy_fee,
    state_surcharge: breakdown.state_surcharge,
    final_6mo: breakdown.final_6mo,
    final_12mo: breakdown.final_12mo
  },
  created_at: new Date().toISOString(),
  next_steps: "Review coverages and bind. A licensed agent will contact you to finalize."
};
    quotesStore[quote_id] = resp;
    return c.json(resp);
  } catch (e: any) {
    console.error('quote_error', e?.message ?? e);
    return c.json({ error: 'quote_failed' }, 500);
  }
});

// --- Get quote by id ---
app.get('/quotes/:id', auth, (c) => {
  const id = c.req.param('id');
  const q = quotesStore[id];
  if (!q) return c.json({ error: 'not_found' }, 404);
  return c.json(q);
});

// --- Get static customer ---
app.get('/customers/:id', auth, (c) => {
  const id = c.req.param('id');
  const cust = customers.find(x => x.customer_id === id);
  if (!cust) return c.json({ error: 'not_found' }, 404);
  return c.json(cust);
});

// --- Serve OpenAPI + Plugin manifest ---
const OPENAPI_YAML = await (async () => {
  // bundled at build; for simplicity we inline fallback below via /openapi.yaml file content
  return null;
})();

app.get('/openapi.yaml', async (c) => {
  return c.text(await (await fetch(new URL('../../openapi.yaml', import.meta.url))).text(), 200, {
    'content-type': 'text/yaml'
  });
});

app.get('/ai-plugin.json', async (c) => {
  return c.json(JSON.parse(await (await fetch(new URL('../../ai-plugin.json', import.meta.url))).text()));
});

export default app;
