// Super Admin only: branches, the rate card, and the one-time bootstrap of the first admin.
import {
  ApiError, DB, Query, T, countRows, createRow, deleteRow, ensureTeam, getRowOrNull, profilePerms, requireSuper, setRoleLabel, updateRow,
} from './context.js';
import { assert, checkEmail, checkPhone, isEmail, num, nz } from './validate.js';
import { seed } from './seed.js';

const BRANCH_TYPES = ['Hub', 'Office', 'Warehouse', 'Franchise'];

export async function saveBranch(ctx, me, { row = {}, isNew }) {
  requireSuper(me);
  const { db, teams } = ctx;
  const id = String(row.id || '').toUpperCase();
  assert(/^[A-Z0-9]{2,10}$/.test(id), 'Branch ID must be 2-10 capital letters or digits, e.g. LHE');
  const data = {
    code: nz(row.code)?.toUpperCase(), name: nz(row.name), type: nz(row.type) || 'Office', city: nz(row.city), address: nz(row.address), phone: nz(row.phone),
    email: nz(row.email)?.toLowerCase() || null, hours: nz(row.hours), status: nz(row.status) || 'Active',
    target_shipments: Math.max(0, Math.round(num(row.target_shipments))), target_revenue: Math.max(0, num(row.target_revenue)), commission_pct: num(row.commission_pct),
  };
  assert(data.code && /^[A-Z0-9]{2,10}-\d{2}$/.test(data.code), 'Branch code must look like LHE-01');
  assert(data.name && data.city, 'Branch name and city are required');
  assert(BRANCH_TYPES.includes(data.type), 'Choose a valid branch type');
  assert(['Active', 'Inactive'].includes(data.status), 'Choose a valid status');
  assert(data.commission_pct >= 0 && data.commission_pct <= 100, 'Commission must be between 0 and 100');
  checkPhone(data.phone);
  checkEmail(data.email);
  const dup = (await db.listRows({ databaseId: DB, tableId: T.branches, queries: [Query.equal('code', data.code), Query.limit(1)] })).rows[0];
  assert(!dup || dup.$id === id, 'A branch with this ID or code already exists');

  let saved;
  if (isNew) {
    assert(!(await getRowOrNull(db, T.branches, id)), 'A branch with this ID or code already exists');
    saved = await createRow(db, T.branches, data, [], id);
    await ensureTeam(teams, id, data.name);
  } else {
    assert(await getRowOrNull(db, T.branches, id), 'Branch not found', 404);
    saved = await updateRow(db, T.branches, id, data);
    await ensureTeam(teams, id, data.name);
    await teams.updateName({ teamId: id, name: data.name }).catch(() => {});
  }
  return { ...saved, id: saved.$id, created_at: saved.$createdAt, updated_at: saved.$updatedAt };
}

export async function deleteBranch(ctx, me, { id }) {
  requireSuper(me);
  const { db, teams } = ctx;
  assert(await getRowOrNull(db, T.branches, id), 'Branch not found', 404);
  for (const table of [T.profiles, T.riders, T.customers]) {
    if (await countRows(db, table, [Query.equal('branch_id', id)])) throw new ApiError('Branch is still in use. Set it Inactive instead.');
  }
  await deleteRow(db, T.branches, id);
  await teams.delete({ teamId: id }).catch(() => {});
  return { ok: true };
}

export async function savePricing(ctx, me, { card }) {
  requireSuper(me);
  assert(card && typeof card === 'object' && !Array.isArray(card), 'Invalid rate card');
  const row = await ctx.db.upsertRow({ databaseId: DB, tableId: T.pricing, rowId: 'default', data: { card: JSON.stringify(card), updated_by: me.id } });
  return { updated_at: row.$updatedAt };
}

/**
 * First sign-in on a fresh project: the caller becomes the Super Admin and the reference data
 * (banks, branches, counters) is written. Later calls only re-seed, and only for a Super Admin.
 */
export async function bootstrap(ctx, me, userId) {
  const { db, users } = ctx;
  const profiles = await countRows(db, T.profiles);
  if (profiles > 0) {
    requireSuper(me);
    return { ok: true, created: false, seeded: await seed(ctx) };
  }
  const user = await users.get({ userId });
  assert(isEmail(user.email), 'The first Super Admin needs an email login');
  const profile = { full_name: nz(user.name) || user.email.split('@')[0], email: user.email.toLowerCase(), role: 'super_admin', status: 'Active' };
  await createRow(db, T.profiles, profile, profilePerms(userId, profile), userId);
  await setRoleLabel(users, userId, 'super_admin');
  const seeded = await seed(ctx);
  return { ok: true, created: true, seeded };
}
