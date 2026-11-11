// Starting state of the operations store: every record list is empty and only configuration
// is filled in. Branches, customers (merchants), riders and users are loaded from the
// database after sign-in (see hooks/useDbSync.js).
import * as cfg from './config.js';
import { DEFAULT_RATE_CARD } from '../utils/pricing.js';

export function seed() {
  return {
    // From the database
    branches: [], merchants: [], riders: [], users: [],
    // Operational records
    shipments: [], codTransactions: [], riderDeposits: [], payouts: [], manifests: [],
    invoices: [], expenses: [], otherIncome: [], transfers: [], merchantOverrides: [], partnerRates: [],
    inventory: [], stockMoves: [], inbounds: [], pickOrders: [], materials: [],
    cargoBookings: [], carriers: [], consolidations: [], customsFiles: [],
    returnsList: [], claims: [], tickets: [], feedback: [],
    sendLog: [], notifications: [], auditLog: [], scheduledReports: [], printHistory: [],
    // Configuration
    cannedResponses: cfg.cannedResponses,
    templates: cfg.templates,
    integrations: cfg.integrations,
    storeIntegrations: cfg.storeIntegrations,
    settings: cfg.defaultSettings,
    permissions: cfg.defaultPermissions,
    rateCard: DEFAULT_RATE_CARD,
  };
}
