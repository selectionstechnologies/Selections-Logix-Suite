-- Pricing (rate card) in the database, editable only by the Super Admin.
-- `card` holds the whole rate card the booking form prices with:
--   zones (base price for the first 0.5 kg per service), slabs (per-kg above 0.5 kg),
--   fees (fuel %, tax %, COD fee, remote charge, insurance %, markup %),
--   areaRates: overrides for a destination city or a whole province / state.
-- Run after 20261111000004_receivers.sql. Safe to run again.

create table if not exists public.pricing (
  id          text primary key default 'default' check (id = 'default'),
  card        jsonb not null,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

drop trigger if exists pricing_touch on public.pricing;
create trigger pricing_touch before update on public.pricing for each row execute function public.touch_updated_at();

alter table public.pricing enable row level security;
drop policy if exists pricing_read on public.pricing;
drop policy if exists pricing_write on public.pricing;
-- Everyone signed in prices bookings with it; only the Super Admin changes it.
create policy pricing_read on public.pricing for select to authenticated using (true);
create policy pricing_write on public.pricing for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

grant select, insert, update on public.pricing to authenticated;
