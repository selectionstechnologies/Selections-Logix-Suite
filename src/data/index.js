// Single entry point used to seed the store.
import { branches } from './geo.js';
import { merchants, riders, users } from './people.js';
import { shipments, codTransactions, riderDeposits, payouts, manifests } from './shipments.js';
import { invoices, expenses, otherIncome, transfers, merchantOverrides, partnerRates } from './finance.js';
import * as ops from './operations.js';
import { DEFAULT_RATE_CARD } from '../utils/pricing.js';

export function seed() {
  return {
    branches, merchants, riders, users, shipments, codTransactions, riderDeposits, payouts, manifests,
    invoices, expenses, otherIncome, transfers, merchantOverrides, partnerRates,
    inventory: ops.inventory,
    stockMoves: ops.stockMoves,
    inbounds: ops.inbounds,
    pickOrders: ops.pickOrders,
    materials: ops.materials,
    cargoBookings: ops.cargoBookings,
    carriers: ops.carriers,
    consolidations: ops.consolidations,
    customsFiles: ops.customsFiles,
    returnsList: ops.returnsList,
    claims: ops.claims,
    tickets: ops.tickets,
    cannedResponses: ops.cannedResponses,
    feedback: ops.feedback,
    templates: ops.templates,
    sendLog: ops.sendLog,
    notifications: ops.notifications,
    auditLog: ops.auditLog,
    integrations: ops.integrations,
    storeIntegrations: ops.storeIntegrations,
    scheduledReports: ops.scheduledReports,
    settings: ops.defaultSettings,
    permissions: ops.defaultPermissions,
    rateCard: DEFAULT_RATE_CARD,
    printHistory: [],
  };
}
