-- Shipping plans per customer account: COD, Shipment, Corporate, Cargo (one or more).
-- The booking form reads them so the payment type and billing are not chosen per parcel.
-- Run after 20261111000001_core_accounts.sql. Safe to run again.

alter table public.customers add column if not exists shipping_plans text[] not null default '{}';

alter table public.customers drop constraint if exists customers_shipping_plans_check;
alter table public.customers add constraint customers_shipping_plans_check
  check (shipping_plans <@ array['cod', 'shipment', 'corporate', 'cargo']::text[]);

-- save_customer now also stores shipping_plans.
create or replace function public.save_customer(payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  cid uuid := nullif(payload->>'id', '')::uuid;
  c jsonb := payload->'customer';
  p jsonb;
  i integer := 0;
  plans text[] := coalesce(array(select jsonb_array_elements_text(coalesce(payload->'customer'->'shipping_plans', '[]'::jsonb))), '{}');
begin
  if cid is null then
    insert into customers (business_name, customer_type, owner_name, cnic, ntn, phone, email, office_address, city, branch_id,
      bank_name, account_title, iban, rate_card, discount_pct, credit_limit, status, kyc_status, notes, shipping_plans, created_by)
    values (c->>'business_name', c->>'customer_type', c->>'owner_name', nullif(c->>'cnic', ''), nullif(c->>'ntn', ''), c->>'phone',
      nullif(c->>'email', ''), nullif(c->>'office_address', ''), nullif(c->>'city', ''), nullif(c->>'branch_id', ''),
      nullif(c->>'bank_name', ''), nullif(c->>'account_title', ''), nullif(upper(replace(c->>'iban', ' ', '')), ''),
      coalesce(nullif(c->>'rate_card', ''), 'Standard'), coalesce(nullif(c->>'discount_pct', '')::numeric, 0),
      coalesce(nullif(c->>'credit_limit', '')::numeric, 0), coalesce(nullif(c->>'status', ''), 'Active'),
      coalesce(nullif(c->>'kyc_status', ''), 'Pending'), nullif(c->>'notes', ''), plans, auth.uid())
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
      notes = nullif(c->>'notes', ''), shipping_plans = plans
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
