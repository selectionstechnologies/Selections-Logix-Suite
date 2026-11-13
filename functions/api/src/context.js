// Shared pieces for the api function: the server SDK, table ids, the caller's profile,
// the role checks (what row-level security did in the old database) and the row
// permissions each kind of record gets.
import { Client, ID, Permission, Query, Role, Storage, TablesDB, Teams, Tokens, Users } from 'node-appwrite';

export { ID, Query, Permission, Role };

export const DB = 'logix';
export const BUCKET = 'customer-docs';
export const T = {
  branches: 'branches',
  banks: 'banks',
  profiles: 'profiles',
  staff: 'staff_details',
  riders: 'riders',
  customers: 'customers',
  pickups: 'customer_pickup_addresses',
  contacts: 'customer_contacts',
  documents: 'customer_documents',
  receivers: 'receivers',
  pricing: 'pricing',
  counters: 'counters',
};

export const ROLES = ['super_admin', 'branch_manager', 'accountant', 'warehouse', 'rider', 'merchant'];
export const BRANCH_ROLES = ['branch_manager', 'warehouse', 'rider'];
export const STAFF_ROLES = ['super_admin', 'branch_manager', 'accountant', 'warehouse'];
// Team role inside a branch team, per app role. The branch team id is the branch id (LHE, KHI...).
export const TEAM_ROLE = { branch_manager: 'manager', warehouse: 'warehouse', rider: 'rider' };

export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** One SDK per request, signed with the function's own short-lived key. */
export function sdk(req) {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key'] || '');
  return { client, db: new TablesDB(client), users: new Users(client), teams: new Teams(client), storage: new Storage(client), tokens: new Tokens(client) };
}

// ---------------------------------------------------------------- rows
export const norm = (row) => (row ? { ...row, id: row.$id, created_at: row.$createdAt, updated_at: row.$updatedAt } : row);

export async function getRowOrNull(db, tableId, rowId) {
  try { return await db.getRow({ databaseId: DB, tableId, rowId }); } catch (e) { if (e.code === 404) return null; throw e; }
}

/** Every row that matches, 100 at a time. */
export async function listAll(db, tableId, queries = []) {
  const out = [];
  let cursor = null;
  for (;;) {
    const q = [...queries, Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
    const { rows } = await db.listRows({ databaseId: DB, tableId, queries: q });
    out.push(...rows);
    if (rows.length < 100) return out;
    cursor = rows[rows.length - 1].$id;
  }
}

export async function countRows(db, tableId, queries = []) {
  const { total } = await db.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(1)] });
  return total;
}

export const createRow = (db, tableId, data, permissions, rowId = ID.unique()) => db.createRow({ databaseId: DB, tableId, rowId, data, permissions });
export const updateRow = (db, tableId, rowId, data, permissions) => db.updateRow({ databaseId: DB, tableId, rowId, data, ...(permissions ? { permissions } : {}) });
export const deleteRow = (db, tableId, rowId) => db.deleteRow({ databaseId: DB, tableId, rowId }).catch((e) => { if (e.code !== 404) throw e; });

/** Next number from a counter row (atomic), e.g. nextCode(db, 'customer_code', 1000) -> 1001. */
export async function nextCode(db, key, start = 0) {
  try {
    const row = await db.incrementRowColumn({ databaseId: DB, tableId: T.counters, rowId: key, column: 'value', value: 1 });
    return row.value;
  } catch (e) {
    if (e.code !== 404) throw e;
    await createRow(db, T.counters, { value: start + 1 }, [], key);
    return start + 1;
  }
}

// ---------------------------------------------------------------- caller
/** The signed-in user's profile row, or null when the login has none yet. */
export async function loadCaller(ctx, req) {
  const userId = req.headers['x-appwrite-user-id'];
  if (!userId) throw new ApiError('Not signed in: the request carried no user session. Sign out and sign in again.', 401);
  const me = norm(await getRowOrNull(ctx.db, T.profiles, userId));
  return { userId, me };
}

export const isActive = (me) => Boolean(me && me.status === 'Active');
export const isSuper = (me) => isActive(me) && me.role === 'super_admin';
export const isManagerOf = (me, branchId) => isActive(me) && me.role === 'branch_manager' && Boolean(branchId) && me.branch_id === branchId;

export function requireSuper(me) {
  if (!isSuper(me)) throw new ApiError('Only a Super Admin can do this', 403);
}

/** Same rules as can_view_customer / can_edit_customer in the old database. */
export const canViewCustomer = (me, c) => isActive(me) && (['super_admin', 'accountant'].includes(me.role) || isManagerOf(me, c.branch_id) || c.profile_id === me.id);
export const canEditCustomer = (me, c) => isActive(me) && (me.role === 'super_admin' || isManagerOf(me, c.branch_id) || c.profile_id === me.id);

// ---------------------------------------------------------------- row permissions
// Rows are only ever written by this function, so clients get read permissions only.
const read = (roles) => roles.filter(Boolean).map((r) => Permission.read(r));

/** A customer account and everything under it (addresses, contacts, documents, receivers, files). */
export const customerPerms = (c) => read([
  Role.label(LABEL.super_admin), Role.label('accountant'),
  c.branch_id ? Role.team(c.branch_id, 'manager') : null,
  c.profile_id ? Role.user(c.profile_id) : null,
]);

export const profilePerms = (id, p) => read([
  Role.user(id), Role.label(LABEL.super_admin),
  p.branch_id ? Role.team(p.branch_id, 'manager') : null,
  ['rider', 'merchant'].includes(p.role) ? Role.label('accountant') : null,
]);

export const staffPerms = (id, p) => read([Role.user(id), Role.label(LABEL.super_admin), p.branch_id ? Role.team(p.branch_id, 'manager') : null]);

export const riderPerms = (r) => read([
  Role.label(LABEL.super_admin), Role.label('accountant'),
  r.branch_id ? Role.team(r.branch_id, 'manager') : null,
  r.branch_id ? Role.team(r.branch_id, 'warehouse') : null,
  r.profile_id ? Role.user(r.profile_id) : null,
]);

// ---------------------------------------------------------------- auth helpers
// Labels may only contain letters and digits, so app roles map to these label names.
export const LABEL = { super_admin: 'superadmin', branch_manager: 'branchmanager', accountant: 'accountant', warehouse: 'warehouse', rider: 'rider', merchant: 'merchant' };
export const setRoleLabel = (users, userId, role) => users.updateLabels({ userId, labels: [LABEL[role]] });

/** Puts the user in the team of their branch (with the role's team role) and in no other branch team. */
export async function syncBranchTeam(ctx, userId, role, branchId, previousBranchId) {
  const teamRole = TEAM_ROLE[role];
  for (const teamId of new Set([previousBranchId, branchId].filter(Boolean))) {
    const keep = teamId === branchId && teamRole;
    const { memberships } = await ctx.teams.listMemberships({ teamId, queries: [Query.equal('userId', userId), Query.limit(10)] }).catch((e) => { if (e.code === 404) return { memberships: [] }; throw e; });
    for (const m of memberships) {
      if (!keep || !m.roles.includes(teamRole)) await ctx.teams.deleteMembership({ teamId, membershipId: m.$id });
    }
    if (keep && !memberships.some((m) => m.roles.includes(teamRole))) {
      await ctx.teams.createMembership({ teamId, roles: [teamRole], userId });
    }
  }
}

export async function ensureTeam(teams, teamId, name) {
  try { await teams.get({ teamId }); } catch (e) {
    if (e.code !== 404) throw e;
    await teams.create({ teamId, name });
  }
}

/** Appwrite's own error text -> what the user should read. */
export function friendly(e) {
  const msg = e?.message || String(e);
  if (e?.code === 409 || /already exists|duplicate/i.test(msg)) return 'This record already exists (a value that must be unique is already used).';
  if (e?.code === 401 || e?.code === 403) return 'You do not have permission to make this change.';
  if (/Invalid `?rows?`? structure|Invalid document structure/i.test(msg)) return `A value does not fit the database rules: ${msg.replace(/^Invalid [^:]*: /, '')}`;
  return msg;
}
