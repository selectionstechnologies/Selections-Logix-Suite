// api: every write the app makes goes through here, as { action, ...payload } in a POST body.
// The caller is identified by Appwrite (x-appwrite-user-id); their profile row decides
// what they may do, the same way row-level security did before.
//
// Deploy:  npx appwrite push functions --with-variables
import { ApiError, friendly, loadCaller, sdk } from './context.js';
import { bootstrap, deleteBranch, saveBranch, savePricing } from './admin.js';
import { deleteCustomer, deleteDocument, documentLink, registerDocument, saveCustomer, saveReceiver, setCustomerStatus } from './customers.js';
import { createUser, setUserPassword, touchLogin, updateUser } from './users.js';

const ACTIONS = {
  'bootstrap': (ctx, me, body, userId) => bootstrap(ctx, me, userId),
  'profiles.touch_login': (ctx, me) => touchLogin(ctx, me),
  'users.create': createUser,
  'users.update': updateUser,
  'users.set_password': setUserPassword,
  'branches.save': saveBranch,
  'branches.delete': deleteBranch,
  'pricing.save': savePricing,
  'customers.save': saveCustomer,
  'customers.set_status': setCustomerStatus,
  'customers.delete': deleteCustomer,
  'documents.register': registerDocument,
  'documents.delete': deleteDocument,
  'documents.link': documentLink,
  'receivers.save': saveReceiver,
};

export default async ({ req, res, log, error }) => {
  if (req.method !== 'POST') return res.json({ error: 'Method not allowed' }, 405);
  let body;
  try { body = req.bodyJson || JSON.parse(req.bodyText || '{}'); } catch { return res.json({ error: 'Invalid JSON body' }, 400); }
  const handler = ACTIONS[body.action];
  if (!handler) return res.json({ error: `Unknown action: ${body.action}` }, 400);

  try {
    const ctx = sdk(req);
    const { userId, me } = await loadCaller(ctx, req);
    if (body.action !== 'bootstrap' && (!me || me.status !== 'Active')) {
      return res.json({ error: me ? 'Your account is inactive. Contact the Super Admin.' : 'This login has no profile yet. Ask the Super Admin to set up your account.' }, 403);
    }
    const result = await handler(ctx, me, body, userId);
    return res.json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof ApiError) return res.json({ error: e.message }, e.status);
    error(`${body.action}: ${e?.message || e}`);
    log(e?.stack || String(e));
    return res.json({ error: friendly(e) }, e?.code >= 400 && e?.code < 600 ? e.code : 400);
  }
};
