// admin-users: the only place logins are created or changed.
// Creating an auth user needs the service-role key, which must never reach the browser,
// so the app calls this function and it checks the caller is an active Super Admin.
//
// Deploy:  supabase functions deploy admin-users
// Actions: { action: 'create', ... } | { action: 'update', id, ... } | { action: 'set_password', id, password }
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['super_admin', 'branch_manager', 'accountant', 'warehouse', 'rider', 'merchant'];
const BRANCH_ROLES = ['branch_manager', 'warehouse', 'rider'];
const STAFF_ROLES = ['super_admin', 'branch_manager', 'accountant', 'warehouse'];

// Same rule as the app: 8-72 characters with at least one letter and one number.
const strongPassword = (p: unknown) => typeof p === 'string' && p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PASSWORD_RULE = 'Password must be at least 8 characters with a letter and a number';

// Projects on the legacy keys get SUPABASE_SERVICE_ROLE_KEY automatically. Projects on the new
// keys may get SUPABASE_SECRET_KEYS (JSON) instead; a secret named SERVICE_ROLE_KEY overrides both.
function firstKey(name: string) {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try { const v = JSON.parse(raw); return typeof v === 'string' ? v : (Object.values(v)[0] as string) || null; } catch { return raw; }
}
const serviceKey = () => Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey('SUPABASE_SECRET_KEYS');
const publicKey = () => Deno.env.get('SUPABASE_ANON_KEY') || firstKey('SUPABASE_PUBLISHABLE_KEYS');

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v ?? null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const secretKey = serviceKey();
  if (!secretKey) return json({ error: 'Server key missing: add a secret named SERVICE_ROLE_KEY (Edge Functions > Secrets) with your secret / service_role key.' }, 500);
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Who is calling? Ask the Auth server about the caller's own token.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token.startsWith('sb_')) return json({ error: 'Not signed in: the request carried no user session. Sign out and sign in again.' }, 401);
  const userRes = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: publicKey() || secretKey } });
  const caller = userRes.ok ? await userRes.json() : null;
  if (!caller?.id) {
    const detail = await userRes.text().catch(() => '');
    console.error('caller check failed', userRes.status, detail);
    let reason = '';
    try { const d = JSON.parse(detail); reason = d.msg || d.message || d.error_description || d.error_code || ''; } catch { reason = detail.slice(0, 120); }
    return json({ error: `Not signed in (auth server said ${userRes.status}${reason ? `: ${reason}` : ''}). Sign out and sign in again.` }, 401);
  }
  const { data: me, error: meErr } = await admin.from('profiles').select('id, role, status').eq('id', caller.id).maybeSingle();
  if (meErr) return json({ error: `Could not read your profile: ${meErr.message}. Check the server key secret.` }, 500);
  if (!me || me.role !== 'super_admin' || me.status !== 'Active') return json({ error: 'Only a Super Admin can manage users' }, 403);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  try {
    if (body.action === 'create') return json(await createUser(admin, me.id, body));
    if (body.action === 'update') return json(await updateUser(admin, me.id, body));
    if (body.action === 'set_password') {
      if (!body.id || !strongPassword(body.password)) return json({ error: PASSWORD_RULE }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.password });
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 400);
  }
});

async function createUser(admin: any, actorId: string, b: Record<string, any>) {
  const email = String(b.email || '').trim().toLowerCase();
  const role = String(b.role || '');
  if (!ROLES.includes(role)) throw new Error('Choose a valid role');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address');
  if (!strongPassword(b.password)) throw new Error(PASSWORD_RULE);
  if (!clean(b.full_name)) throw new Error('Full name is required');
  if (BRANCH_ROLES.includes(role) && !clean(b.branch_id)) throw new Error('Branch is required for this role');
  if (role === 'merchant' && !b.customer_id) throw new Error('Pick the customer account this login belongs to');

  if (role === 'merchant') {
    const { data: cust } = await admin.from('customers').select('id, profile_id').eq('id', b.customer_id).single();
    if (!cust) throw new Error('Customer account not found');
    if (cust.profile_id) throw new Error('This customer account already has a login');
  }

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email, password: b.password, email_confirm: true, user_metadata: { full_name: clean(b.full_name), role },
  });
  if (authErr) throw authErr;
  const id = created.user.id;

  // Anything below failing removes the auth user again so a retry starts clean.
  try {
    const { error: pErr } = await admin.from('profiles').insert({
      id, email, role, full_name: clean(b.full_name), phone: clean(b.phone), cnic: clean(b.cnic), address: clean(b.address),
      branch_id: clean(b.branch_id), status: 'Active', created_by: actorId,
    });
    if (pErr) throw pErr;

    if (STAFF_ROLES.includes(role) && b.staff) {
      const { error } = await admin.from('staff_details').insert({ profile_id: id, ...pickStaff(b.staff) });
      if (error) throw error;
    }
    if (role === 'rider') {
      const { error } = await admin.from('riders').insert({
        profile_id: id, full_name: clean(b.full_name), phone: clean(b.phone) || '-', cnic: clean(b.cnic), address: clean(b.address),
        branch_id: b.branch_id, ...pickRider(b.rider || {}),
      });
      if (error) throw error;
    }
    if (role === 'merchant') {
      const { error } = await admin.from('customers').update({ profile_id: id }).eq('id', b.customer_id);
      if (error) throw error;
    }
  } catch (e) {
    await admin.auth.admin.deleteUser(id);
    throw e;
  }
  return { ok: true, id };
}

async function updateUser(admin: any, _actorId: string, b: Record<string, any>) {
  if (!b.id) throw new Error('Missing user id');
  const { data: current } = await admin.from('profiles').select('id, role').eq('id', b.id).single();
  if (!current) throw new Error('User not found');
  if (BRANCH_ROLES.includes(current.role) && b.branch_id !== undefined && !clean(b.branch_id)) throw new Error('Branch is required for this role');

  const patch: Record<string, unknown> = {};
  for (const k of ['full_name', 'phone', 'cnic', 'address', 'branch_id', 'status']) if (b[k] !== undefined) patch[k] = clean(b[k]);
  if (Object.keys(patch).length) {
    const { error } = await admin.from('profiles').update(patch).eq('id', b.id);
    if (error) throw error;
  }
  // An inactive user is also banned at the auth level, so an open session cannot refresh.
  if (b.status) {
    const { error } = await admin.auth.admin.updateUserById(b.id, { ban_duration: b.status === 'Inactive' ? '876000h' : 'none' });
    if (error) throw error;
  }
  if (b.staff && STAFF_ROLES.includes(current.role)) {
    const { error } = await admin.from('staff_details').upsert({ profile_id: b.id, ...pickStaff(b.staff) });
    if (error) throw error;
  }
  if (current.role === 'rider') {
    const riderPatch: Record<string, unknown> = { ...pickRider(b.rider || {}) };
    if (patch.full_name) riderPatch.full_name = patch.full_name;
    if (patch.phone) riderPatch.phone = patch.phone;
    if (patch.cnic !== undefined) riderPatch.cnic = patch.cnic;
    if (patch.branch_id) riderPatch.branch_id = patch.branch_id;
    if (b.status === 'Inactive') riderPatch.status = 'Inactive';
    const { error } = await admin.from('riders').update(riderPatch).eq('profile_id', b.id);
    if (error) throw error;
    // Reactivating a login puts an inactive rider back on the available list.
    if (b.status === 'Active') {
      const { error: e2 } = await admin.from('riders').update({ status: 'Available' }).eq('profile_id', b.id).eq('status', 'Inactive');
      if (e2) throw e2;
    }
  }
  return { ok: true };
}

function pickStaff(s: Record<string, any>) {
  return {
    employee_code: clean(s.employee_code), designation: clean(s.designation), department: clean(s.department),
    joining_date: clean(s.joining_date), shift: clean(s.shift), salary: s.salary === '' || s.salary == null ? null : Number(s.salary),
    emergency_contact_name: clean(s.emergency_contact_name), emergency_contact_phone: clean(s.emergency_contact_phone),
  };
}

function pickRider(r: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const k of ['city', 'zone', 'vehicle_type', 'vehicle_plate', 'license_no', 'license_expiry', 'emergency_contact_name', 'emergency_contact_phone', 'joined_at']) {
    if (r[k] !== undefined) out[k] = clean(r[k]);
  }
  if (out.vehicle_type === null) delete out.vehicle_type;
  if (out.joined_at === null) delete out.joined_at;
  return out;
}
