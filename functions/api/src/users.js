// Logins: the only place accounts are created or changed. Creating an auth user needs the
// server key, which never reaches the browser, so the app calls this and it checks the
// caller is an active Super Admin.
import {
  ApiError, BRANCH_ROLES, BUCKET, ID, ROLES, STAFF_ROLES, T, createRow, deleteRow, getRowOrNull, nextCode, profilePerms, requireSuper,
  riderPerms, setRoleLabel, staffPerms, syncBranchTeam, updateRow, customerPerms, listAll, Query,
} from './context.js';
import { PASSWORD_RULE, assert, checkCnic, checkPhone, isEmail, nz, num, strongPassword } from './validate.js';

function pickStaff(s = {}) {
  return {
    employee_code: nz(s.employee_code), designation: nz(s.designation), department: nz(s.department), joining_date: nz(s.joining_date),
    shift: nz(s.shift), salary: s.salary === '' || s.salary == null ? null : num(s.salary, null),
    emergency_contact_name: nz(s.emergency_contact_name), emergency_contact_phone: nz(s.emergency_contact_phone),
  };
}

function pickRider(r = {}) {
  const out = {};
  for (const k of ['city', 'zone', 'vehicle_type', 'vehicle_plate', 'license_no', 'license_expiry', 'emergency_contact_name', 'emergency_contact_phone', 'joined_at']) {
    if (r[k] !== undefined) out[k] = nz(r[k]);
  }
  if (out.vehicle_type === null) delete out.vehicle_type;
  if (out.joined_at === null) delete out.joined_at;
  if (out.vehicle_plate) out.vehicle_plate = out.vehicle_plate.toUpperCase();
  if (out.license_no) out.license_no = out.license_no.toUpperCase();
  checkPhone(out.emergency_contact_phone ?? null);
  return out;
}

async function requireBranch(db, branchId) {
  assert(await getRowOrNull(db, T.branches, branchId), 'Branch not found');
}

/** Re-applies the read permissions on a customer account and its child rows (after a login is linked). */
export async function reapplyCustomerPerms(ctx, customer) {
  const perms = customerPerms(customer);
  await updateRow(ctx.db, T.customers, customer.$id, {}, perms);
  for (const table of [T.pickups, T.contacts, T.documents, T.receivers]) {
    for (const row of await listAll(ctx.db, table, [Query.equal('customer_id', customer.$id)])) {
      await updateRow(ctx.db, table, row.$id, {}, perms);
      if (table === T.documents) await ctx.storage.updateFile({ bucketId: BUCKET, fileId: row.file_id, permissions: perms }).catch(() => {});
    }
  }
}

export async function createUser(ctx, me, b) {
  requireSuper(me);
  const { db, users } = ctx;
  const email = String(b.email || '').trim().toLowerCase();
  const role = String(b.role || '');
  assert(ROLES.includes(role), 'Choose a valid role');
  assert(isEmail(email), 'Enter a valid email address');
  assert(strongPassword(b.password), PASSWORD_RULE);
  const fullName = nz(b.full_name);
  assert(fullName, 'Full name is required');
  const branchId = nz(b.branch_id);
  assert(!BRANCH_ROLES.includes(role) || branchId, 'Branch is required for this role');
  assert(role !== 'merchant' || b.customer_id, 'Pick the customer account this login belongs to');
  const phone = nz(b.phone);
  const cnic = nz(b.cnic);
  checkPhone(phone);
  checkCnic(cnic);
  if (branchId) await requireBranch(db, branchId);
  assert(!(await listAll(db, T.profiles, [Query.equal('email', email), Query.limit(1)])).length, 'A user with this email already exists');

  let customer = null;
  if (role === 'merchant') {
    customer = await getRowOrNull(db, T.customers, b.customer_id);
    assert(customer, 'Customer account not found');
    assert(!customer.profile_id, 'This customer account already has a login');
  }

  let created;
  try {
    created = await users.create({ userId: ID.unique(), email, password: b.password, name: fullName });
  } catch (e) {
    if (e.code === 409) throw new ApiError('A user with this email already exists');
    throw e;
  }
  const id = created.$id;

  // Anything below failing removes the auth user again so a retry starts clean.
  try {
    await setRoleLabel(users, id, role);
    const profile = { full_name: fullName, email, role, phone, cnic, address: nz(b.address), branch_id: branchId, status: 'Active', created_by: me.id };
    await createRow(db, T.profiles, profile, profilePerms(id, profile), id);
    await syncBranchTeam(ctx, id, role, branchId, null);

    if (STAFF_ROLES.includes(role) && b.staff) {
      const staff = pickStaff(b.staff);
      checkPhone(staff.emergency_contact_phone);
      await createRow(db, T.staff, staff, staffPerms(id, profile), id);
    }
    if (role === 'rider') {
      const rider = {
        code: `RD-${String(await nextCode(db, 'rider_code', 0)).padStart(4, '0')}`,
        profile_id: id, full_name: fullName, phone: phone || '-', cnic, address: nz(b.address), branch_id: branchId,
        status: 'Available', joined_at: new Date().toISOString().slice(0, 10), ...pickRider(b.rider || {}),
      };
      await createRow(db, T.riders, rider, riderPerms(rider));
    }
    if (role === 'merchant') {
      const updated = await updateRow(db, T.customers, customer.$id, { profile_id: id });
      await reapplyCustomerPerms(ctx, updated);
    }
  } catch (e) {
    await deleteRow(db, T.profiles, id);
    await deleteRow(db, T.staff, id);
    await users.delete({ userId: id }).catch(() => {});
    throw e;
  }
  return { ok: true, id };
}

export async function updateUser(ctx, me, b) {
  requireSuper(me);
  const { db, users } = ctx;
  assert(b.id, 'Missing user id');
  const current = await getRowOrNull(db, T.profiles, b.id);
  assert(current, 'User not found', 404);
  if (b.status && b.id === me.id && b.status !== 'Active') throw new ApiError('You cannot deactivate your own account');

  const patch = {};
  for (const k of ['full_name', 'phone', 'cnic', 'address', 'branch_id', 'status']) if (b[k] !== undefined) patch[k] = nz(b[k]);
  if (patch.full_name === null) delete patch.full_name;
  assert(!(BRANCH_ROLES.includes(current.role) && patch.branch_id === null), 'Branch is required for this role');
  if (patch.phone !== undefined) checkPhone(patch.phone);
  if (patch.cnic !== undefined) checkCnic(patch.cnic);
  if (patch.status !== undefined) assert(['Active', 'Inactive'].includes(patch.status), 'Choose a valid status');
  if (patch.branch_id) await requireBranch(db, patch.branch_id);

  const next = { ...current, ...patch };
  const branchChanged = patch.branch_id !== undefined && patch.branch_id !== current.branch_id;
  if (Object.keys(patch).length) await updateRow(db, T.profiles, b.id, patch, profilePerms(b.id, next));
  if (patch.full_name) await users.updateName({ userId: b.id, name: patch.full_name }).catch(() => {});
  if (branchChanged) await syncBranchTeam(ctx, b.id, current.role, next.branch_id, current.branch_id);

  // An inactive user is also blocked at the auth level, so an open session cannot continue.
  if (patch.status) {
    await users.updateStatus({ userId: b.id, status: patch.status === 'Active' });
    if (patch.status === 'Inactive') await users.deleteSessions({ userId: b.id }).catch(() => {});
  }

  if (STAFF_ROLES.includes(current.role) && (b.staff || branchChanged)) {
    const existing = await getRowOrNull(db, T.staff, b.id);
    const staff = b.staff ? pickStaff(b.staff) : {};
    checkPhone(staff.emergency_contact_phone ?? null);
    if (existing) await updateRow(db, T.staff, b.id, staff, staffPerms(b.id, next));
    else if (b.staff) await createRow(db, T.staff, staff, staffPerms(b.id, next), b.id);
  }

  if (current.role === 'rider') {
    const rider = (await listAll(db, T.riders, [Query.equal('profile_id', b.id), Query.limit(1)]))[0];
    if (rider) {
      const riderPatch = { ...pickRider(b.rider || {}) };
      if (patch.full_name) riderPatch.full_name = patch.full_name;
      if (patch.phone) riderPatch.phone = patch.phone;
      if (patch.cnic !== undefined) riderPatch.cnic = patch.cnic;
      if (patch.address !== undefined) riderPatch.address = patch.address;
      if (patch.branch_id) riderPatch.branch_id = patch.branch_id;
      if (patch.status === 'Inactive') riderPatch.status = 'Inactive';
      // Reactivating a login puts an inactive rider back on the available list.
      if (patch.status === 'Active' && rider.status === 'Inactive') riderPatch.status = 'Available';
      await updateRow(db, T.riders, rider.$id, riderPatch, riderPerms({ ...rider, ...riderPatch }));
    }
  }
  return { ok: true };
}

export async function setUserPassword(ctx, me, b) {
  requireSuper(me);
  assert(b.id && strongPassword(b.password), PASSWORD_RULE);
  assert(await getRowOrNull(ctx.db, T.profiles, b.id), 'User not found', 404);
  await ctx.users.updatePassword({ userId: b.id, password: b.password });
  return { ok: true };
}

/** Records the sign-in time on the caller's own profile. */
export async function touchLogin(ctx, me) {
  if (!me) return { ok: false };
  await updateRow(ctx.db, T.profiles, me.id, { last_login: new Date().toISOString() });
  return { ok: true };
}
