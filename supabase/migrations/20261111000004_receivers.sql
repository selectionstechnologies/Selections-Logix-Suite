-- Receivers (consignees) saved per customer account, so a returning receiver is found by phone.
-- One record per phone number per customer: the same number cannot be saved twice for a customer.
-- Run after 20261111000003_field_validation.sql. Safe to run again.

create table if not exists public.receivers (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers (id) on delete cascade,
  phone           text not null,
  -- Last 10 digits, so 0300 1234567, +92 300 1234567 and 03001234567 are the same number.
  phone_key       text generated always as (right(regexp_replace(phone, '\D', '', 'g'), 10)) stored,
  alt_phone       text,
  name            text not null check (length(trim(name)) between 2 and 80),
  cnic            text,
  address         text not null check (length(trim(address)) between 5 and 250),
  landmark        text,
  city            text not null,
  zone            text,
  shipments_count integer not null default 0,
  last_used_at    timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint receivers_phone_unique unique (customer_id, phone_key),
  constraint receivers_phone_valid check (public.is_valid_phone(phone) and public.is_valid_phone(alt_phone)),
  constraint receivers_cnic_valid check (cnic is null or cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$')
);
create index if not exists receivers_cnic_idx on public.receivers (customer_id, cnic);

drop trigger if exists receivers_touch on public.receivers;
create trigger receivers_touch before update on public.receivers for each row execute function public.touch_updated_at();

alter table public.receivers enable row level security;
drop policy if exists receivers_read on public.receivers;
drop policy if exists receivers_write on public.receivers;
-- Whoever can see / book for the customer account can see / save its receivers.
create policy receivers_read on public.receivers for select to authenticated using (public.can_view_customer(customer_id));
create policy receivers_write on public.receivers for all to authenticated
  using (public.can_edit_customer(customer_id)) with check (public.can_edit_customer(customer_id));

grant select, insert, update, delete on public.receivers to authenticated;

-- Called after each booking: saves a new receiver, or refreshes the saved one for that number
-- and counts the shipment. SECURITY INVOKER, so the policies above apply.
create or replace function public.save_receiver(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  rid uuid;
begin
  insert into receivers (customer_id, phone, alt_phone, name, cnic, address, landmark, city, zone, shipments_count, last_used_at, created_by)
  values ((payload->>'customer_id')::uuid, trim(payload->>'phone'), nullif(trim(payload->>'alt_phone'), ''), trim(payload->>'name'),
    nullif(trim(payload->>'cnic'), ''), trim(payload->>'address'), nullif(trim(payload->>'landmark'), ''), payload->>'city',
    nullif(payload->>'zone', ''), 1, now(), auth.uid())
  on conflict (customer_id, phone_key) do update set
    phone = excluded.phone,
    alt_phone = excluded.alt_phone,
    name = excluded.name,
    cnic = coalesce(excluded.cnic, receivers.cnic),
    address = excluded.address,
    landmark = excluded.landmark,
    city = excluded.city,
    zone = excluded.zone,
    shipments_count = receivers.shipments_count + 1,
    last_used_at = now()
  returning id into rid;
  return rid;
end $$;

grant execute on function public.save_receiver(jsonb) to authenticated;
