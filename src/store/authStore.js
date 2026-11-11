// Real authentication through Supabase Auth. `user` keeps the shape the screens already use
// ({ id, name, email, role, branchId, merchantId, riderId }) so role scoping works unchanged.
import { create } from 'zustand';
import { supabase, supabaseConfigured } from '../lib/supabase.js';
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

export const useAuth = create((set, get) => ({
  user: null,
  ready: false, // false until the stored session has been checked
  error: null,

  /** Called once at start-up: restores the session and follows sign-in/out from other tabs. */
  init: async () => {
    if (!supabaseConfigured) { set({ ready: true, error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.' }); return; }
    const { data } = await supabase.auth.getSession();
    await get().loadProfile(data.session?.user?.id);
    set({ ready: true });
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') set({ user: null });
      // Run outside the auth callback; Supabase warns against awaiting inside it.
      else if (event === 'SIGNED_IN' && session?.user?.id !== get().user?.id) setTimeout(() => get().loadProfile(session.user.id), 0);
    });
  },

  loadProfile: async (userId) => {
    if (!userId) { set({ user: null }); return null; }
    try {
      const p = await fetchMyProfile(userId);
      if (!p) {
        await supabase.auth.signOut();
        set({ user: null, error: 'This login has no profile yet. Ask the Super Admin to set up your account.' });
        return null;
      }
      if (p.status !== 'Active') {
        await supabase.auth.signOut();
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
    if (!supabaseConfigured) return { error: get().error || 'Supabase is not configured' };
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { error: error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message };
    const user = await get().loadProfile(data.user.id);
    return user ? { user } : { error: get().error };
  },

  logout: async () => {
    set({ user: null });
    if (supabaseConfigured) await supabase.auth.signOut();
  },

  refresh: () => get().loadProfile(get().user?.id),
}));
