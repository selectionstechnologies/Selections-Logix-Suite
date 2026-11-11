-- Server-side field rules, matching src/utils/validation.js, so bad data is refused even if
-- it does not come through the app's forms.
-- Constraints are added NOT VALID: rows already saved are left alone, new and edited rows are checked.
-- Run after 20261111000002_shipping_plans.sql. Safe to run again.

-- Pakistan or UAE number. Spaces, dashes and brackets are ignored.
--   PK mobile 03XX XXXXXXX, PK landline (area code not starting with 3), UAE mobile 05X..., UAE landline.
create or replace function public.is_valid_phone(p text) returns boolean
language sql immutable as $$
  select p is null or regexp_replace(p, '[\s()-]', '', 'g')
    ~ '^((\+92|0092|0)(3[0-9]{9}|[124-9][0-9]{8,9})|(\+971|00971|0)(5[0-9]{8}|[1-9][0-9]{7}))$'
$$;

create or replace function public.is_valid_email(e text) returns boolean
language sql immutable as $$
  select e is null or (length(e) <= 254 and e ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$')
$$;

do $$
declare
  c record;
begin
  for c in select * from (values
    ('customers', 'customers_phone_valid', 'public.is_valid_phone(phone)'),
    ('customers', 'customers_email_valid', 'public.is_valid_email(email)'),
    ('customers', 'customers_ntn_valid', $c$ntn is null or ntn ~ '^([0-9]{7}-?[0-9]|[0-9]{13}|[0-9]{5}-[0-9]{7}-[0-9])$'$c$),
    ('customer_pickup_addresses', 'pickups_phone_valid', 'public.is_valid_phone(phone) and public.is_valid_phone(return_phone)'),
    ('customer_contacts', 'contacts_phone_valid', 'public.is_valid_phone(phone)'),
    ('customer_contacts', 'contacts_email_valid', 'public.is_valid_email(email)'),
    ('profiles', 'profiles_phone_valid', 'public.is_valid_phone(phone)'),
    ('profiles', 'profiles_cnic_valid', $c$cnic is null or cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$'$c$),
    ('riders', 'riders_phone_valid', 'public.is_valid_phone(phone) and public.is_valid_phone(emergency_contact_phone)'),
    ('riders', 'riders_cnic_valid', $c$cnic is null or cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$'$c$),
    ('staff_details', 'staff_phone_valid', 'public.is_valid_phone(emergency_contact_phone)'),
    ('branches', 'branches_phone_valid', 'public.is_valid_phone(phone)'),
    ('branches', 'branches_email_valid', 'public.is_valid_email(email)')
  ) as t(tbl, name, expr)
  loop
    execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.name);
    execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
  end loop;
end $$;
