# Selections Logix Suite

**Ship. Collect. Control.** An all-in-one logistics management frontend by Selections Technologies, covering courier, COD, cargo, warehouse, customs, returns, finance and support.

This is a frontend only. All data is mock data and no backend or external service is called.

## Run it

Requires Node 18 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run preview    # serve the production bundle
npm run check:data # verify the mock data's counts and cross-links
```

When deploying `dist/`, configure the host to send unknown paths to `index.html`, because routing happens in the browser.

## Demo logins

On the login page, use a one-click role button, or sign in with any account below. The password is `demo123`.

| Role | Email | Sees |
| --- | --- | --- |
| Super Admin | admin@selections.demo | Everything |
| Branch Manager | lahore.manager@selections.demo | Own branch: operations, riders, customers, reports |
| Accountant | accounts@selections.demo | COD, reconciliation, payouts, invoices, ledgers, rates |
| Warehouse Staff | warehouse@selections.demo | Inventory, inbound, pick & pack, hub scan, returns |
| Rider | rider@selections.demo | Mobile rider app and own dashboard |
| Merchant / Customer | merchant@selections.demo | Own shipments, COD ledger, payouts, invoices, tickets, API |

Switch role at any time from the profile menu. Public tracking needs no login: `/track/SLX100001`.

## Try this flow

Each step feeds the next, across roles:

1. **Merchant:** Create Shipment, with a COD amount. Note the AWB and open the public tracking link.
2. **Branch Manager:** move the parcel along with Parcel Scan or Update status, and assign a rider on the Dispatch Board.
3. **Rider:** in Today's Run, mark a parcel delivered (OTP, signature or photo) and collect the COD, then Deposit cash. Enter a lower amount to create a shortage.
4. **Accountant:** Rider Reconciliation shows the shortage in red. Reconcile it, then Merchant Payouts > Create payouts > Approve > Mark paid.
5. **Merchant:** the COD ledger and payouts reflect it.
6. **Super Admin:** Audit Log lists all of it.

## What is simulated

- **Saved data:** changes persist in this browser's localStorage. Reset them at Settings > Demo data.
- **Messages and integrations:** WhatsApp, SMS, email, courier APIs, payment gateways and store connections only change on-screen state and logs.
- **Auth:** there is no real security. Accounts and the password are in the client bundle.
- **Permissions:** the matrix's **View** column really controls the sidebar and screen access, and **Export** hides the export button on the main shipment, customer and report lists. Create, Edit and Delete are stored but not enforced per button; role-specific screens handle those limits instead.
- **Rates:** FX rates, HS codes and duty rates are dummy values, not current figures.

## How the numbers stay consistent

Mock data is generated from fixed seeds in `src/data`, with dates relative to today. The COD chain is derived, not random: delivered COD shipment > COD transaction > rider deposit > merchant payout. Dashboards, lists and reports all use the selectors in `src/data/helpers.js`.

All money aggregates use PKR as the base and convert for display. A label or rider screen shows the actual collection currency.

## Project structure

```
src/
  components/  ui, layout, charts, tables, forms, print
  pages/       one folder per module
  data/        seeded mock data and selectors
  store/       Zustand: data (the mock backend), auth, UI
  hooks/       money, translation, scoping, permissions
  utils/       pricing engine, formatters, status map, export
  routes/      one table drives routes, guards, sidebar and breadcrumbs
```

To add a screen, add one entry to `routeTable` in `src/routes/index.jsx`.

## Stack

React 18, Vite, React Router 6, Tailwind CSS, Zustand, react-hook-form with zod, Recharts, lucide-react, papaparse, xlsx, jsPDF, html2canvas, qrcode.react, react-barcode and date-fns.
