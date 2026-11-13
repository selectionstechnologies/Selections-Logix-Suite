// Real authentication through Appwrite. `user` keeps the shape the screens already use
// ({ id, name, email, role, branchId, merchantId, riderId }) so role scoping works unchanged.
import { create } from 'zustand';
import { account, appwriteConfigured, callApi, clearStoredSession, friendlyError, markSession, storedSessionAllowed } from '../lib/appwrite.js';
import { fetchMyProfile } from '../lib/api.js';

const toUser = (p) => ({
  id: p.id,
  name: p.full_name,
  email: p.email,
  phone: p.phone,
  role: p.role,
  branchId: p.branch_id,
  status: p.status,
  merchantId: p.customer_id, // the customer account a merchant login belongs to
  riderId: p.rider_id,
});

const NOT_CONFIGURED = 'Appwrite is not configured. Set VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID in .env.';

async function currentUserId() {
  try { return (await account.get()).$id; } catch { return null; }
}

async function signOut() {
  await account.deleteSession({ sessionId: 'current' }).catch(() => {});
  clearStoredSession();
}

export const useAuth = create((set, get) => ({
  user: null,
  ready: false, // false until the stored session has been checked
  error: null,

  /** Called once at start-up: restores the session and follows sign-in/out from other tabs. */
  init: async () => {
    if (!appwriteConfigured) { set({ ready: true, error: NOT_CONFIGURED }); return; }
    if (!storedSessionAllowed()) clearStoredSession(); // "Remember me" was off and the browser was closed
    await get().loadProfile(await currentUserId());
    set({ ready: true });
    // The SDK keeps the session in localStorage, so another tab signing in or out changes that key.
    window.addEventListener('storage', (e) => {
      if (e.key !== 'cookieFallback' && e.key !== null) return;
      currentUserId().then((id) => { if (id !== get().user?.id) get().loadProfile(id); });
    });
  },

  loadProfile: async (userId) => {
    if (!userId) { set({ user: null }); return null; }
    try {
      let p = await fetchMyProfile(userId);
      if (!p) {
        // A fresh project: the first login becomes the Super Admin and the reference data is written.
        const boot = await callApi('bootstrap').catch(() => null);
        if (boot?.created) p = await fetchMyProfile(userId);
      }
      if (!p) {
        await signOut();
        set({ user: null, error: 'This login has no profile yet. Ask the Super Admin to set up your account.' });
        return null;
      }
      if (p.status !== 'Active') {
        await signOut();
        set({ user: null, error: 'Your account is inactive. Contact the Super Admin.' });
        return null;
      }
      const user = toUser(p);
      set({ user, error: null });
      return user;
    } catch (e) {
      set({ user: null, error: e.message });
      return null;
    }
  },

  /** Returns { user } or { error }. */
  login: async (email, password) => {
    if (!appwriteConfigured) return { error: get().error || NOT_CONFIGURED };
    clearStoredSession();
    let session;
    try {
      session = await account.createEmailPasswordSession({ email: email.trim(), password });
    } catch (e) {
      return { error: friendlyError(e.message) };
    }
    markSession();
    const user = await get().loadProfile(session.userId);
    if (user) callApi('profiles.touch_login').catch(() => {});
    return user ? { user } : { error: get().error };
  },

  logout: async () => {
    set({ user: null });
    if (appwriteConfigured) await signOut();
  },

  refresh: () => get().loadProfile(get().user?.id),
}));
