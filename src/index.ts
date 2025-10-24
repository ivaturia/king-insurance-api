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
function normalizeEmail(s?: string) { return (s || '').trim().toLowerCase(); }
function normalizePhone(s?: string) { return (s || '').replace(/\D/g, ''); }
function normalizeZip(s?: string)   { return (s || '').trim().slice(0, 5); }
function normalizeName(s?: string)  { return (s || '').trim().toLowerCase(); }

/** Return { hit, basis } where basis explains how the match was made. */
function findCustomerWithBasis(p: any): { hit: any | null, basis: 'email+zip' | 'phone+zip' | 'email' | 'phone' | 'name+zip' | 'none' } {
  const email = normalizeEmail(p?.email);
  const phone = normalizePhone(p?.phone);
  const zip   = normalizeZip(p?.zipcode);
  const first = normalizeName(p?.first_name);
  const last  = normalizeName(p?.last_name);

  // 1) (email OR phone) + zip
  let hit = customers.find((x) => {
    const xEmail = normalizeEmail(x.person.email);
    const xPhone = normalizePhone(x.person.phone);
    const xZip   = normalizeZip(x.person.zipcode);
    const emailMatch = !!email && xEmail === email;
    const phoneMatch = !!phone && xPhone === phone;
    const zipMatch   = !!zip   && xZip === zip;
    return (emailMatch || phoneMatch) && zipMatch;
  });
  if (hit) return { hit, basis: email ? 'email+zip' : 'phone+zip' };

  // 2) email-only
  if (email) {
    hit = customers.find((x) => normalizeEmail(x.person.email) === email);
    if (hit) return { hit, basis: 'email' };
  }

  // 3) phone-only
  if (phone) {
    hit = customers.find((x) => normalizePhone(x.person.phone) === phone);
    if (hit) return { hit, basis: 'phone' };
  }

  // 4) name + zip
  if (first && last && zip) {
    hit = customers.find((x) =>
      normalizeName(x.person.first_name) === first &&
      normalizeName(x.person.last_name)  === last  &&
      normalizeZip(x.person.zipcode)     === zip
    );
    if (hit) return { hit, basis: 'name+zip' };
  }

  return { hit: null, basis: 'none' };
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

  // Tolerate multiple input shapes / aliases
  const rawPerson = req?.person ?? {};
  const top = req || {};
  const legacyQ1 = ('' + (top.q1 ?? '')).trim(); // sometimes email
  const legacyQ2 = ('' + (top.q2 ?? '')).trim(); // sometimes zip/postal

  const emailCandidate =
    rawPerson.email ?? top.email ?? top.user_email ?? (legacyQ1.includes('@') ? legacyQ1 : undefined);

  const phoneCandidate = rawPerson.phone ?? top.phone ?? top.user_phone;

  const zipCandidate =
    rawPerson.zipcode ?? rawPerson.zip ?? rawPerson.postal_code ?? rawPerson.post_code ??
    top.zipcode ?? top.zip ?? top.postal_code ?? top.post_code ??
    (/^\d{5}/.test(legacyQ2) ? legacyQ2 : undefined);

  const p = {
    ...rawPerson,
    email: emailCandidate ?? rawPerson.email,
    phone: phoneCandidate ?? rawPerson.phone,
    zipcode: zipCandidate ?? rawPerson.zipcode
  };

  const providedDrivers  = Array.isArray(req?.drivers)  ? req.drivers  : [];
  const providedVehicles = Array.isArray(req?.vehicles) ? req.vehicles : [];
  const bundle = req?.bundle ?? { homeowners_selected: false };

  try {
    const { hit: matched, basis } = findCustomerWithBasis(p);

    const person = matched ? { ...matched.person, ...p } : p;
    const ratedDrivers  = matched && (!providedDrivers?.length)  ? matched.drivers  : providedDrivers;
    const ratedVehicles = matched && (!providedVehicles?.length) ? matched.vehicles : providedVehicles;

    // Require at least one vehicle either provided or from prefill
    if (!ratedVehicles || ratedVehicles.length === 0) {
      return c.json({
        error: 'insufficient_data',
        message: 'Need at least one vehicle (year/make/model/primary_use/garaging_zip) or a matching customer with saved vehicles.'
      }, 400);
    }

    const breakdown = rateQuote({ person, drivers: ratedDrivers, vehicles: ratedVehicles, bundle });

    const quote_id = uuidv4();
    const resp = {
      quote_id,
      prefill: { matched: !!matched, basis, customer_id: matched?.customer_id ?? null },
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
