-- Selections Logix Suite: core accounts schema.
-- Roles, user profiles, branches, customer (merchant) accounts with pickup/return
-- addresses, points of contact, bank details and KYC documents, riders and staff.
--
-- Run this once in Supabase: Dashboard > SQL Editor > paste > Run
-- (or `supabase db push` if you use the Supabase CLI).


-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('super_admin', 'branch_manager', 'accountant', 'warehouse', 'rider', 'merchant');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Branches (text ids such as 'LHE' so they line up with the city map in the app)
-- ---------------------------------------------------------------------------
create table if not exists public.branches (
  id               text primary key check (id ~ '^[A-Z0-9]{2,10}$'),
  code             text not null unique,
  name             text not null,
  type             text not null default 'Office' check (type in ('Hub', 'Office', 'Warehouse', 'Franchise')),
  city             text not null,
  address          text,
  phone            text,
  email            text,
  hours            text,
  status           text not null default 'Active' check (status in ('Active', 'Inactive')),
  target_shipments integer not null default 0,
  target_revenue   numeric(14, 2) not null default 0,
  commission_pct   numeric(5, 2) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles: one row per login, created by the admin-users Edge Function
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text not null unique,
  phone       text,
  cnic        text,
  address     text,
  role        public.app_role not null,
  branch_id   text references public.branches (id) on delete set null,
  status      text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_login  timestamptz,
  -- Branch managers and warehouse staff always work for one branch.
  constraint profiles_branch_required check (role not in ('branch_manager', 'warehouse', 'rider') or branch_id is not null)
);

-- Extra HR fields for staff roles (manager, accountant, warehouse, admin).
create table if not exists public.staff_details (
  profile_id              uuid primary key references public.profiles (id) on delete cascade,
  employee_code           text unique,
  designation             text,
  department              text,
  joining_date            date,
  shift                   text check (shift is null or shift in ('Morning', 'Evening', 'Night', 'General')),
  salary                  numeric(12, 2),
  emergency_contact_name  text,
  emergency_contact_phone text,
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Riders
-- ---------------------------------------------------------------------------
create sequence if not exists public.rider_code_seq start 1;

create table if not exists public.riders (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique default ('RD-' || lpad(nextval('public.rider_code_seq')::text, 4, '0')),
  profile_id              uuid unique references public.profiles (id) on delete set null,
  full_name               text not null,
  phone                   text not null,
  cnic                    text,
  address                 text,
  branch_id               text not null references public.branches (id),
  city                    text,
  zone                    text,
  vehicle_type            text not null default 'Motorcycle' check (vehicle_type in ('Motorcycle', 'Bicycle', 'Car', 'Van', 'Truck')),
  vehicle_plate           text,
  license_no              text,
  license_expiry          date,
  emergency_contact_name  text,
  emergency_contact_phone text,
  status                  text not null default 'Available' check (status in ('Available', 'On Route', 'On Leave', 'Inactive')),
  joined_at               date not null default current_date,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Banks (drop-down list on the customer form)
-- ---------------------------------------------------------------------------
create table if not exists public.banks (
  name    text primary key,
  country text not null default 'PK',
  active  boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Customer accounts (merchants / customers)
-- ---------------------------------------------------------------------------
create sequence if not exists public.customer_code_seq start 1001;

create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  account_no      text not null unique default ('SLX-C' || nextval('public.customer_code_seq')::text),
  business_name   text not null,
  customer_type   text not null check (customer_type in ('E-commerce Merchant', 'Corporate', 'SME / Retail', 'Individual', 'Marketplace Seller')),
  owner_name      text not null,
  cnic            text check (cnic is null or cnic ~ '^\d{5}-\d{7}-\d$'),
  ntn             text,
  phone           text not null,
  email           text,
  office_address  text,
  city            text,
  branch_id       text references public.branches (id),
  -- Bank detail: IBAN, account title and bank only.
  bank_name       text references public.banks (name) on update cascade,
  account_title   text,
  iban            text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  -- Commercial terms
  rate_card       text not null default 'Standard',
  discount_pct    numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  credit_limit    numeric(14, 2) not null default 0,
  status          text not null default 'Active' check (status in ('Active', 'Inactive', 'Suspended')),
  kyc_status      text not null default 'Pending' check (kyc_status in ('Pending', 'Verified', 'Rejected')),
  notes           text,
  profile_id      uuid unique references public.profiles (id) on delete set null, -- portal login
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists customers_branch_idx on public.customers (branch_id);

-- Multiple pickup addresses; each carries its return address (or "same as pickup").
create table if not exists public.customer_pickup_addresses (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references public.customers (id) on delete cascade,
  label                  text not null default 'Main',
  address                text not null,
  city                   text not null,
  contact_name           text,
  phone                  text,
  return_same_as_pickup  boolean not null default true,
  return_address         text,
  return_city            text,
  return_phone           text,
  is_default             boolean not null default false,
  sort_order             integer not null default 0,
  created_at             timestamptz not null default now(),
  constraint return_address_required check (return_same_as_pickup or (return_address is not null and return_city is not null))
);
create index if not exists pickup_customer_idx on public.customer_pickup_addresses (customer_id);

-- Points of contact (POC)
create table if not exists public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  name         text not null,
  designation  text,
  phone        text not null,
  email        text,
  is_primary   boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists contacts_customer_idx on public.customer_contacts (customer_id);

-- KYC documents and cheque copy (files live in the private 'customer-docs' bucket)
create table if not exists public.customer_documents (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  doc_type      text not null check (doc_type in ('CNIC Front', 'CNIC Back', 'Cheque', 'NTN Certificate', 'Business Registration', 'Agreement', 'Other')),
  file_name     text not null,
  storage_path  text not null unique,
  mime_type     text,
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by   uuid references public.profiles (id) on delete set null,
  uploaded_at   timestamptz not null default now()
);
create index if not exists docs_customer_idx on public.customer_documents (customer_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['branches', 'profiles', 'staff_details', 'riders', 'customers'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers used by RLS. SECURITY DEFINER so they can read profiles without
-- recursing through profiles' own policies.
-- ---------------------------------------------------------------------------
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'Active'
$$;

create or replace function public.my_branch() returns text
language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid() and status = 'Active'
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'super_admin', false)
$$;

create or replace function public.my_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.customers where profile_id = auth.uid()
$$;

create or replace function public.my_rider_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.riders where profile_id = auth.uid()
$$;

-- Who may see / change a customer account.
create or replace function public.can_view_customer(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.customers c
    where c.id = cid and (
      public.my_role() in ('super_admin', 'accountant')
      or (public.my_role() = 'branch_manager' and c.branch_id = public.my_branch())
      or c.profile_id = auth.uid()
    )
  )
$$;

-- Child records (pickups, contacts, documents). The merchant may keep their own up to date.
create or replace function public.can_edit_customer(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.customers c
    where c.id = cid and (
      public.my_role() = 'super_admin'
      or (public.my_role() = 'branch_manager' and c.branch_id = public.my_branch())
      or c.profile_id = auth.uid()
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.branches                  enable row level security;
alter table public.profiles                  enable row level security;
alter table public.staff_details             enable row level security;
alter table public.riders                    enable row level security;
alter table public.banks                     enable row level security;
alter table public.customers                 enable row level security;
alter table public.customer_pickup_addresses enable row level security;
alter table public.customer_contacts         enable row level security;
alter table public.customer_documents        enable row level security;

-- Drop-and-create keeps this file re-runnable.
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('branches', 'profiles', 'staff_details', 'riders', 'banks', 'customers', 'customer_pickup_addresses', 'customer_contacts', 'customer_documents')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

-- branches: everyone signed in reads; only super admin writes.
create policy branches_read  on public.branches for select to authenticated using (true);
create policy branches_write on public.branches for all    to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- banks: read for all, write for super admin.
create policy banks_read  on public.banks for select to authenticated using (true);
create policy banks_write on public.banks for all    to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- profiles: self, super admin, and a branch manager for their own branch's people.
-- Inserts happen only in the Edge Function (service role), so there is no insert policy.
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.is_super_admin()
  or (public.my_role() = 'branch_manager' and branch_id = public.my_branch())
  or (public.my_role() = 'accountant' and role in ('rider', 'merchant'))
);
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- staff_details
create policy staff_read on public.staff_details for select to authenticated using (
  profile_id = auth.uid() or public.is_super_admin()
  or (public.my_role() = 'branch_manager' and exists (select 1 from public.profiles p where p.id = profile_id and p.branch_id = public.my_branch()))
);
create policy staff_write on public.staff_details for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- riders
create policy riders_read on public.riders for select to authenticated using (
  public.my_role() in ('super_admin', 'accountant')
  or (public.my_role() in ('branch_manager', 'warehouse') and branch_id = public.my_branch())
  or profile_id = auth.uid()
);
create policy riders_write on public.riders for all to authenticated using (
  public.is_super_admin() or (public.my_role() = 'branch_manager' and branch_id = public.my_branch())
) with check (
  public.is_super_admin() or (public.my_role() = 'branch_manager' and branch_id = public.my_branch())
);

-- customers: create by super admin or a branch manager (own branch). The merchant reads only.
-- Checks the row's own columns (not can_view_customer) so INSERT ... RETURNING can see the new row.
create policy customers_read on public.customers for select to authenticated using (
  public.my_role() in ('super_admin', 'accountant')
  or (public.my_role() = 'branch_manager' and branch_id = public.my_branch())
  or profile_id = auth.uid()
);
create policy customers_insert on public.customers for insert to authenticated with check (
  public.is_super_admin() or (public.my_role() = 'branch_manager' and branch_id = public.my_branch())
);
create policy customers_update on public.customers for update to authenticated using (
  public.is_super_admin() or (public.my_role() = 'branch_manager' and branch_id = public.my_branch())
) with check (
  public.is_super_admin() or (public.my_role() = 'branch_manager' and branch_id = public.my_branch())
);
create policy customers_delete on public.customers for delete to authenticated using (public.is_super_admin());

-- child tables
create policy pickups_read  on public.customer_pickup_addresses for select to authenticated using (public.can_view_customer(customer_id));
create policy pickups_write on public.customer_pickup_addresses for all    to authenticated using (public.can_edit_customer(customer_id)) with check (public.can_edit_customer(customer_id));
create policy contacts_read  on public.customer_contacts for select to authenticated using (public.can_view_customer(customer_id));
create policy contacts_write on public.customer_contacts for all    to authenticated using (public.can_edit_customer(customer_id)) with check (public.can_edit_customer(customer_id));
create policy docs_read  on public.customer_documents for select to authenticated using (public.can_view_customer(customer_id));
create policy docs_write on public.customer_documents for all    to authenticated using (public.can_edit_customer(customer_id)) with check (public.can_edit_customer(customer_id));

-- ---------------------------------------------------------------------------
-- save_customer: create or update a customer with its pickups and contacts in
-- one transaction. SECURITY INVOKER, so the RLS policies above still apply.
-- ---------------------------------------------------------------------------
create or replace function public.save_customer(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := nullif(payload->>'id', '')::uuid;
  c jsonb := payload->'customer';
  p jsonb;
  i integer := 0;
begin
  if cid is null then
    insert into customers (business_name, customer_type, owner_name, cnic, ntn, phone, email, office_address, city, branch_id,
      bank_name, account_title, iban, rate_card, discount_pct, credit_limit, status, kyc_status, notes, created_by)
    values (c->>'business_name', c->>'customer_type', c->>'owner_name', nullif(c->>'cnic', ''), nullif(c->>'ntn', ''), c->>'phone',
      nullif(c->>'email', ''), nullif(c->>'office_address', ''), nullif(c->>'city', ''), nullif(c->>'branch_id', ''),
      nullif(c->>'bank_name', ''), nullif(c->>'account_title', ''), nullif(upper(replace(c->>'iban', ' ', '')), ''),
      coalesce(nullif(c->>'rate_card', ''), 'Standard'), coalesce(nullif(c->>'discount_pct', '')::numeric, 0),
      coalesce(nullif(c->>'credit_limit', '')::numeric, 0), coalesce(nullif(c->>'status', ''), 'Active'),
      coalesce(nullif(c->>'kyc_status', ''), 'Pending'), nullif(c->>'notes', ''), auth.uid())
    returning id into cid;
  else
    update customers set
      business_name = c->>'business_name', customer_type = c->>'customer_type', owner_name = c->>'owner_name',
      cnic = nullif(c->>'cnic', ''), ntn = nullif(c->>'ntn', ''), phone = c->>'phone', email = nullif(c->>'email', ''),
      office_address = nullif(c->>'office_address', ''), city = nullif(c->>'city', ''), branch_id = nullif(c->>'branch_id', ''),
      bank_name = nullif(c->>'bank_name', ''), account_title = nullif(c->>'account_title', ''),
      iban = nullif(upper(replace(c->>'iban', ' ', '')), ''), rate_card = coalesce(nullif(c->>'rate_card', ''), 'Standard'),
      discount_pct = coalesce(nullif(c->>'discount_pct', '')::numeric, 0), credit_limit = coalesce(nullif(c->>'credit_limit', '')::numeric, 0),
      status = coalesce(nullif(c->>'status', ''), 'Active'), kyc_status = coalesce(nullif(c->>'kyc_status', ''), 'Pending'),
      notes = nullif(c->>'notes', '')
    where id = cid;
    if not found then raise exception 'Customer not found or not permitted'; end if;
  end if;

  if payload ? 'pickups' then
    delete from customer_pickup_addresses where customer_id = cid;
    i := 0;
    for p in select * from jsonb_array_elements(payload->'pickups') loop
      insert into customer_pickup_addresses (customer_id, label, address, city, contact_name, phone, return_same_as_pickup,
        return_address, return_city, return_phone, is_default, sort_order)
      values (cid, coalesce(nullif(p->>'label', ''), 'Pickup ' || (i + 1)), p->>'address', p->>'city', nullif(p->>'contact_name', ''),
        nullif(p->>'phone', ''), coalesce((p->>'return_same_as_pickup')::boolean, true),
        nullif(p->>'return_address', ''), nullif(p->>'return_city', ''), nullif(p->>'return_phone', ''), i = 0, i);
      i := i + 1;
    end loop;
  end if;

  if payload ? 'contacts' then
    delete from customer_contacts where customer_id = cid;
    i := 0;
    for p in select * from jsonb_array_elements(payload->'contacts') loop
      insert into customer_contacts (customer_id, name, designation, phone, email, is_primary, sort_order)
      values (cid, p->>'name', nullif(p->>'designation', ''), p->>'phone', nullif(p->>'email', ''), i = 0, i);
      i := i + 1;
    end loop;
  end if;

  return cid;
end $$;

grant execute on function public.save_customer(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for customer documents, 10 MB per file.
-- Object path: <customer_id>/<random>-<file name>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-docs', 'customer-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists customer_docs_read   on storage.objects;
drop policy if exists customer_docs_insert on storage.objects;
drop policy if exists customer_docs_delete on storage.objects;

create policy customer_docs_read on storage.objects for select to authenticated using (
  bucket_id = 'customer-docs' and public.can_view_customer(((storage.foldername(name))[1])::uuid)
);
create policy customer_docs_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'customer-docs' and public.can_edit_customer(((storage.foldername(name))[1])::uuid)
);
create policy customer_docs_delete on storage.objects for delete to authenticated using (
  bucket_id = 'customer-docs' and public.can_edit_customer(((storage.foldername(name))[1])::uuid)
);

-- ---------------------------------------------------------------------------
-- Seed data: banks and the six network branches
-- ---------------------------------------------------------------------------
insert into public.banks (name, country) values
  ('Allied Bank', 'PK'), ('Askari Bank', 'PK'), ('Bank Alfalah', 'PK'), ('Bank AL Habib', 'PK'), ('BankIslami', 'PK'),
  ('Dubai Islamic Bank Pakistan', 'PK'), ('Faysal Bank', 'PK'), ('Habib Bank Limited (HBL)', 'PK'), ('Habib Metropolitan Bank', 'PK'),
  ('JS Bank', 'PK'), ('MCB Bank', 'PK'), ('Meezan Bank', 'PK'), ('National Bank of Pakistan', 'PK'), ('Soneri Bank', 'PK'),
  ('Standard Chartered Pakistan', 'PK'), ('United Bank Limited (UBL)', 'PK'), ('Bank of Punjab', 'PK'), ('Silkbank', 'PK'),
  ('JazzCash (Mobilink Bank)', 'PK'), ('Easypaisa (Telenor Bank)', 'PK'),
  ('Emirates NBD', 'AE'), ('ADCB', 'AE'), ('First Abu Dhabi Bank', 'AE'), ('Mashreq', 'AE'), ('Dubai Islamic Bank', 'AE')
on conflict (name) do nothing;

insert into public.branches (id, code, name, type, city, address, phone, hours, target_shipments, target_revenue, commission_pct) values
  ('LHE', 'LHE-01', 'Lahore Main Hub',    'Hub',       'Lahore',    '42 Ferozepur Road, Gulberg III, Lahore',  '+92 42 3577 1100', '08:00 - 22:00', 90, 95000, 0),
  ('KHI', 'KHI-01', 'Karachi Port Hub',   'Hub',       'Karachi',   'Plot 18, SITE Area, Karachi',             '+92 21 3255 8800', '08:00 - 22:00', 80, 85000, 0),
  ('ISB', 'ISB-01', 'Islamabad Office',   'Office',    'Islamabad', 'Office 7, I-9 Markaz, Islamabad',         '+92 51 444 2200',  '09:00 - 20:00', 50, 55000, 4),
  ('PEW', 'PEW-01', 'Peshawar Franchise', 'Franchise', 'Peshawar',  'Ring Road, Hayatabad Phase 3, Peshawar',  '+92 91 581 3300',  '09:00 - 19:00', 30, 30000, 12),
  ('DXB', 'DXB-01', 'Dubai Warehouse',    'Warehouse', 'Dubai',     'Unit 12, Al Quoz Industrial 3, Dubai',    '+971 4 338 9000',  '08:00 - 20:00', 35, 90000, 0),
  ('SHJ', 'SHJ-01', 'Sharjah Office',     'Office',    'Sharjah',   'Shop 4, Industrial Area 6, Sharjah',      '+971 6 533 1200',  '09:00 - 18:00', 20, 45000, 6)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- First Super Admin (run once, after creating the user in
-- Dashboard > Authentication > Users > Add user, with "Auto Confirm" ticked):
--
--   insert into public.profiles (id, full_name, email, role)
--   select id, 'Your Name', email, 'super_admin' from auth.users where email = 'you@example.com';
-- ---------------------------------------------------------------------------
