# Selections Logix Suite

**Ship. Collect. Control.** An all-in-one logistics management frontend by Selections Technologies, covering courier, COD, cargo, warehouse, customs, returns, finance and support.

Accounts, roles, branches, customer accounts, riders and staff are stored in Supabase (PostgreSQL). There is no sample data: shipments, COD, warehouse, cargo and the other operational modules start empty and are saved in the browser until they move to the database.

## Run it

Requires Node 18 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run preview    # serve the production bundle
```

When deploying `dist/`, configure the host to send unknown paths to `index.html`, because routing happens in the browser.

## Database setup (Supabase)

Accounts, roles, branches, customer accounts, riders and staff are stored in Supabase. Do these steps once per Supabase project.

1. **Environment.** Copy `.env.example` to `.env` and fill in the project URL and the publishable (anon) key from Supabase > Project Settings > API.
2. **Schema.** Open Supabase > SQL Editor and run each file in `supabase/migrations/` in name order (`20261111000001_core_accounts.sql`, `20261111000002_shipping_plans.sql`, `20261111000003_field_validation.sql`, `20261111000004_receivers.sql`, `20261111000005_pricing.sql`). It creates the tables, row-level security, the private `customer-docs` storage bucket (10 MB per file), the bank list and the six branches. Running it again is safe.
3. **Edge Function.** Logins can only be created with the service-role key, so that happens in a server function, never in the browser:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase functions deploy admin-users --no-verify-jwt
   ```
   Or in the dashboard: Edge Functions > Deploy a new function > Via Editor, name it **admin-users**, and paste `supabase/functions/admin-users/index.ts`.
   Then open the function's **Settings** and turn **Verify JWT with legacy secret** OFF: the function checks the caller itself, and projects on the new API keys sign tokens that the legacy check rejects. With the CLI, deploy with `--no-verify-jwt` for the same effect.
   If the function has a different name, set `VITE_ADMIN_USERS_FUNCTION=<name>` in `.env`.
4. **First Super Admin.** In Supabase > Authentication > Users > Add user, create your own account and tick **Auto Confirm User**. Then run this in the SQL Editor:
   ```sql
   insert into public.profiles (id, full_name, email, role)
   select id, 'Your Name', email, 'super_admin' from auth.users where email = 'you@example.com';
   ```
5. Sign in. Every other user is created by the Super Admin under **Administration > Users & Roles**.

## Roles

| Role | Created from | Form captures | Sees |
| --- | --- | --- | --- |
| Super Admin | Users & Roles | Login, contact, employment | Everything; the only role that creates logins |
| Branch Manager | Users & Roles | Login, branch, employment, emergency contact | Own branch: operations, riders, customers, reports |
| Accountant | Users & Roles | Login, optional branch, employment | COD, reconciliation, payouts, invoices, ledgers, all customer accounts (read only) |
| Warehouse Staff | Users & Roles | Login, branch, shift, employment | Inventory, inbound, pick & pack, hub scan, returns |
| Rider | Users & Roles | Login, branch, city, zone, vehicle, plate, licence and expiry, emergency contact | Rider app and own dashboard |
| Merchant / Customer | Customer Accounts (login optional), or Users & Roles for an existing account | See below | Own shipments, COD ledger, payouts, invoices, tickets, My Account |

**Customer account form:** business name, customer type, shipping plan (COD, Shipment, Corporate and/or Cargo; Create Shipment applies it so payment settings are not chosen per parcel), owner name, CNIC, NTN, phone, email, office address, city, branch; multiple pickup addresses, each with its return address or "same as pickup"; points of contact (name, designation, phone, email); bank detail (bank from a drop-down list, account title, IBAN); documents such as CNIC front/back and cheque copy (PDF, JPG, PNG or WEBP, up to 10 MB each), which can be viewed and downloaded later.

Branch Managers can add customer accounts for their own branch. Access is enforced in the database by row-level security, not only in the screens.

## Try this flow

Create one user per role in Users & Roles first (for the merchant, a customer account with a portal login). Each step feeds the next:

1. **Merchant:** Create Shipment, with a COD amount. Note the AWB and open the public tracking link.
2. **Branch Manager:** move the parcel along with Parcel Scan or Update status, and assign a rider on the Dispatch Board.
3. **Rider:** in Today's Run, mark a parcel delivered (OTP, signature or photo) and collect the COD, then Deposit cash. Enter a lower amount to create a shortage.
4. **Accountant:** Rider Reconciliation shows the shortage in red. Reconcile it, then Merchant Payouts > Create payouts > Approve > Mark paid.
5. **Merchant:** the COD ledger and payouts reflect it.
6. **Super Admin:** Audit Log lists all of it.

## Where data is stored

- **Database (Supabase):** users and roles, branches, customer accounts with pickup addresses, contacts, bank details and documents, riders, staff, each customer's saved receivers (one per phone number; filled in automatically when the number is typed again), and the rate card with city / province rates (Finance > Rate Cards, editable by the Super Admin).
- **This browser only, for now:** shipments, COD, payouts, invoices, warehouse, cargo, customs, returns, tickets and the audit log. These start empty and are saved in the browser's localStorage, so they are not shared between computers or users yet. Clear them at Administration > Settings > Local data. Moving them to the database is the next step.
- **Not live yet:** WhatsApp, SMS, email, courier APIs, payment gateways and store connections only change on-screen state.
- **Reference values:** FX rates, HS codes and duty rates are fixed values in the code; check current figures before quoting.

All money aggregates use PKR as the base and convert for display. A label or rider screen shows the actual collection currency.

## Project structure

```
supabase/
  migrations/  database schema and row-level security
  functions/   admin-users Edge Function (creates and manages logins)
src/
  components/  ui, layout, charts, tables, forms, print
  pages/       one folder per module
  data/        configuration (permissions, templates, HS codes), cities and selectors
  lib/         Supabase client and database calls (api.js)
  store/       Zustand: operational data, auth (Supabase), UI
  hooks/       money, translation, scoping, permissions
  utils/       pricing engine, formatters, status map, export
  routes/      one table drives routes, guards, sidebar and breadcrumbs
```

To add a screen, add one entry to `routeTable` in `src/routes/index.jsx`.

## Stack

React 18, Vite, React Router 6, Tailwind CSS, Zustand, react-hook-form with zod, Recharts, lucide-react, papaparse, xlsx, jsPDF, html2canvas, qrcode.react, react-barcode and date-fns.
