# Selections Logix Suite

**Ship. Collect. Control.** A logistics management app by Selections Technologies, covering courier booking, labels, rider dispatch, COD collection and merchant payouts.

Accounts, roles, branches, customer accounts, riders and staff are stored in Appwrite (Cloud, free plan). There is no sample data: shipments, COD and payouts and the other operational modules start empty and are saved in the browser until they move to the database.

## Run it

Requires Node 18 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run preview    # serve the production bundle
```

When deploying `dist/`, configure the host to send unknown paths to `index.html`, because routing happens in the browser.

## Backend setup (Appwrite)

Accounts, roles, branches, customer accounts, riders and staff are stored in Appwrite. Everything the backend needs is described in `appwrite.config.json` (database, tables, branch teams, bucket, function) and pushed with the Appwrite CLI. Do these steps once per Appwrite project.

1. **Project.** In the [Appwrite console](https://cloud.appwrite.io) create a project (the free plan is enough) and note its **Project ID** and **API endpoint** (for example `https://sgp.cloud.appwrite.io/v1`). Put both in `appwrite.config.json` (`projectId`, `endpoint`, and the `APPWRITE_ENDPOINT` variable under `functions`) and in `.env` (copy `.env.example`).
2. **Web platform.** Console > project > Overview > *Add platform* > Web, hostname `localhost` for development; add the deployed hostname later. Without it the browser gets CORS errors.
3. **Sign in the CLI and push.**
   ```bash
   npm run appwrite:login   # opens the browser once
   npm run appwrite:push    # database, tables, branch teams, customer-docs bucket and the api function
   ```
   `appwrite push all` is safe to run again after `appwrite.config.json` changes. To redeploy only the function after editing `functions/api`: `npm run appwrite:push:function`.
4. **First Super Admin.** Console > Auth > *Create user* with an email and password (name optional), then sign in to the app with it. The first login on an empty project becomes the Super Admin automatically; the bank list, the six branches and the code counters are written at the same time.
5. Every other user is created by the Super Admin under **Administration > Users & Roles**.

**How access control works.** The browser only reads. Every write in `src/lib/api.js` calls the `api` function (`functions/api`), which checks the caller's profile and makes the change with the server key, under the same rules row-level security enforced before: Super Admin everything, Branch Manager their own branch, Accountant read-only on accounts, Merchant their own account. Reads are limited by row permissions: each row lists who may see it (the `superadmin` / `accountant` user labels, the branch team's `manager` role, or the merchant's own user id), and Appwrite only returns rows the signed-in user is on. Documents live in the private `customer-docs` bucket (10 MB per file) with the same per-file permissions; viewing or downloading uses a 2-minute file token issued by the function.

## Roles

| Role | Created from | Form captures | Sees |
| --- | --- | --- | --- |
| Super Admin | Users & Roles | Login, contact, employment | Everything; the only role that creates logins |
| Branch Manager | Users & Roles | Login, branch, employment, emergency contact | Own branch: operations, riders, customers |
| Accountant | Users & Roles | Login, optional branch, employment | COD, rider reconciliation, payouts, rate cards (view), all customer accounts (read only) |
| Warehouse Staff | Users & Roles | Login, branch, shift, employment | Hub operations: shipments, parcel scan, labels |
| Rider | Users & Roles | Login, branch, city, zone, vehicle, plate, licence and expiry, emergency contact | Rider app and own dashboard |
| Merchant / Customer | Customer Accounts (login optional), or Users & Roles for an existing account | See below | Own shipments, COD ledger, payouts, My Account |

**Customer account form:** business name, customer type, shipping plan (COD, Shipment, Corporate and/or Cargo; Create Shipment applies it so payment settings are not chosen per parcel), owner name, CNIC, NTN, phone, email, office address, city, branch; multiple pickup addresses, each with its return address or "same as pickup"; points of contact (name, designation, phone, email); bank detail (bank from a drop-down list, account title, IBAN); documents such as CNIC front/back and cheque copy (PDF, JPG, PNG or WEBP, up to 10 MB each), which can be viewed and downloaded later.

Branch Managers can add customer accounts for their own branch. Access is enforced by the `api` function and row permissions, not only in the screens.

## Try this flow

Create one user per role in Users & Roles first (for the merchant, a customer account with a portal login). Each step feeds the next:

1. **Merchant:** Create Shipment, with a COD amount. Note the AWB and open the public tracking link.
2. **Branch Manager:** move the parcel along with Parcel Scan or Update status, and assign a rider on the Dispatch Board.
3. **Rider:** in Today's Run, mark a parcel delivered (OTP, signature or photo) and collect the COD, then Deposit cash. Enter a lower amount to create a shortage.
4. **Accountant:** Rider Reconciliation shows the shortage in red. Reconcile it, then Merchant Payouts > Create payouts > Approve > Mark paid.
5. **Merchant:** the COD ledger and payouts reflect it.
6. **Super Admin:** Audit Log lists all of it.

## Where data is stored

- **Database (Appwrite):** users and roles, branches, customer accounts with pickup addresses, contacts, bank details and documents, riders, staff, each customer's saved receivers (one per phone number; filled in automatically when the number is typed again), and the rate card with city / province rates (Finance > Rate Cards, editable by the Super Admin).
- **This browser only, for now:** shipments, COD, payouts and the audit log. These start empty and are saved in the browser's localStorage, so they are not shared between computers or users yet. Clear them at Administration > Settings > Local data. Moving them to the database is the next step.
- **Not live yet:** WhatsApp, SMS, email, courier APIs, payment gateways and store connections only change on-screen state.
- **Reference values:** FX rates, HS codes and duty rates are fixed values in the code; check current figures before quoting.

All money aggregates use PKR as the base and convert for display. A label or rider screen shows the actual collection currency.

## Project structure

```
appwrite.config.json   database, tables, branch teams, bucket and function (pushed with the Appwrite CLI)
functions/api/         the api function: every write, with the role checks (users, customers, documents, receivers, branches, pricing)
src/
  components/  ui, layout, charts, tables, forms, print
  pages/       one folder per module
  data/        configuration (permissions, templates, HS codes), cities and selectors
  lib/         Appwrite client (appwrite.js) and database calls (api.js)
  store/       Zustand: operational data, auth (Appwrite), UI
  hooks/       money, translation, scoping, permissions
  utils/       pricing engine, formatters, status map, export
  routes/      one table drives routes, guards, sidebar and breadcrumbs
```

To add a screen, add one entry to `routeTable` in `src/routes/index.jsx`.

## Stack

React 18, Vite, React Router 6, Tailwind CSS, Zustand, react-hook-form with zod, Recharts, lucide-react, papaparse, xlsx, jsPDF, html2canvas, qrcode.react, react-barcode and date-fns.
