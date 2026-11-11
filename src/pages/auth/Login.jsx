import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, PackageSearch } from 'lucide-react';
import { useAuth } from '../../store/authStore.js';
import { useUI, toast } from '../../store/uiStore.js';
import { Logo } from '../../components/layout/AppLayout.jsx';
import { FieldError } from '../../components/forms/EntityForm.jsx';
import { getRemember, setRemember } from '../../lib/supabase.js';

const EMAIL_KEY = 'slx-last-email';
const readEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } };
const writeEmail = (v) => { try { if (v) localStorage.setItem(EMAIL_KEY, v); else localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ } };

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean(),
});

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, ready, login, error: authError } = useAuth();
  const { setBranch } = useUI();
  const [failed, setFailed] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: getRemember() ? readEmail() : '', password: '', remember: getRemember() },
  });

  if (ready && user) return <Navigate to={location.state?.from || '/'} replace />;

  const onSubmit = async ({ email, password, remember }) => {
    setFailed('');
    setRemember(remember); // decides where the session is stored, so set it before signing in
    writeEmail(remember ? email.trim() : '');
    const res = await login(email, password);
    if (res.error) { setFailed(res.error); return; }
    setBranch('ALL');
    toast.success(`Welcome back, ${res.user.name}`);
    navigate(location.state?.from || '/', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <section className="relative flex flex-col justify-between overflow-hidden bg-primary p-6 lg:w-5/12 lg:p-12">
        <div className="absolute -end-20 -top-20 h-72 w-72 rounded-full bg-primary-hover/60" aria-hidden />
        <div className="absolute -bottom-24 -start-16 h-72 w-72 rounded-full bg-danger/90" aria-hidden />
        <div className="relative">
          <span className="inline-block rounded-xl bg-white p-2"><Logo /></span>
        </div>
        <div className="relative mt-8 lg:mt-0">
          <h1 className="text-3xl font-extrabold leading-tight lg:text-5xl">Ship. Collect. Control.</h1>
          <p className="mt-3 max-w-md text-sm lg:text-base">Courier, COD, cargo, warehouse, customs, returns, finance and support in one system.</p>
        </div>
        <p className="relative mt-6 hidden text-xs font-medium text-white lg:block">Selections Technologies</p>
      </section>

      <section className="flex flex-1 items-center justify-center bg-white p-6">
        <div className="w-full max-w-md">
          <h2 className="mb-6 text-xl font-bold">Sign in to your account</h2>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" autoComplete="username" placeholder="you@company.com" className={`input ${errors.email ? 'input-error' : ''}`} {...register('email')} />
              <FieldError message={errors.email?.message} />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <div className="relative">
                <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" className={`input pe-10 ${errors.password ? 'input-error' : ''}`} {...register('password')} />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-e-lg text-ink-muted hover:text-ink"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
                </button>
              </div>
              <FieldError message={errors.password?.message} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary-hover" {...register('remember')} />
              Remember me
            </label>
            {(failed || (!user && authError)) && <p role="alert" className="rounded-lg bg-danger-light px-3 py-2 text-sm text-danger-dark">{failed || authError}</p>}
            <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 size={16} className="animate-spin" aria-hidden />} Sign in
            </button>
          </form>
          <p className="mt-4 text-xs text-ink-muted">Accounts are created by the Super Admin. Forgot your password? Ask your administrator to reset it.</p>

          <Link to="/track" className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-ink-muted hover:text-ink">
            <PackageSearch size={16} aria-hidden /> Track a parcel
          </Link>
        </div>
      </section>
    </div>
  );
}
