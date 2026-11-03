import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bike, Building2, Calculator, Crown, PackageSearch, Store, Warehouse } from 'lucide-react';
import { useAuth, demoUserFor, DEMO_PASSWORD } from '../../store/authStore.js';
import { useUI, toast } from '../../store/uiStore.js';
import { ROLE_LABELS } from '../../data/people.js';
import { Logo } from '../../components/layout/AppLayout.jsx';
import { FieldError } from '../../components/forms/EntityForm.jsx';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const ROLE_ICONS = { super_admin: Crown, branch_manager: Building2, accountant: Calculator, warehouse: Warehouse, rider: Bike, merchant: Store };

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, loginAs } = useAuth();
  const { setBranch } = useUI();
  const [failed, setFailed] = useState(false);
  const { register, handleSubmit, setValue, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  const onSubmit = ({ email, password }) => {
    const found = login(email, password);
    setFailed(!found);
    if (found) {
      setBranch('ALL');
      toast.success(`Welcome back, ${found.name}`);
      navigate(location.state?.from || '/', { replace: true });
    }
  };

  const quick = (role) => {
    setValue('email', demoUserFor(role).email);
    setValue('password', DEMO_PASSWORD);
    loginAs(role);
    setBranch('ALL');
    navigate('/', { replace: true });
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
              <input id="email" type="email" autoComplete="username" className={`input ${errors.email ? 'input-error' : ''}`} {...register('email')} />
              <FieldError message={errors.email?.message} />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <input id="password" type="password" autoComplete="current-password" className={`input ${errors.password ? 'input-error' : ''}`} {...register('password')} />
              <FieldError message={errors.password?.message} />
            </div>
            {failed && <p role="alert" className="rounded-lg bg-danger-light px-3 py-2 text-sm text-danger-dark">Email or password is incorrect. Use a demo account below (password: {DEMO_PASSWORD}).</p>}
            <button type="submit" className="btn-primary w-full">Sign in</button>
          </form>

          <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-muted">Quick demo login</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(ROLE_LABELS).map(([role, label]) => {
              const Icon = ROLE_ICONS[role];
              return (
                <button key={role} type="button" onClick={() => quick(role)} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-start text-sm font-medium transition-colors hover:border-primary-hover hover:bg-primary-light">
                  <Icon size={16} className="shrink-0 text-ink-muted" aria-hidden />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
          <Link to="/track" className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-ink-muted hover:text-ink">
            <PackageSearch size={16} aria-hidden /> Track a parcel
          </Link>
        </div>
      </section>
    </div>
  );
}
