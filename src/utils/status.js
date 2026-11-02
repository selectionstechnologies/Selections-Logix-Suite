// Central status vocabulary: shipment flow, badge tones and helper groups.

export const STATUS = {
  BOOKED: 'Booked',
  PICKED: 'Picked Up',
  ORIGIN: 'At Origin Hub',
  TRANSIT: 'In Transit',
  DEST: 'At Destination Hub',
  OFD: 'Out for Delivery',
  DELIVERED: 'Delivered',
  FAILED: 'Failed Attempt',
  REATTEMPT: 'Re-attempt',
  RTO: 'Return to Origin',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
};

export const SHIPMENT_STATUSES = Object.values(STATUS);

/** Allowed next statuses. Bulk and detail actions only offer valid moves. */
export const NEXT_STATUS = {
  [STATUS.BOOKED]: [STATUS.PICKED, STATUS.CANCELLED],
  [STATUS.PICKED]: [STATUS.ORIGIN, STATUS.CANCELLED],
  [STATUS.ORIGIN]: [STATUS.TRANSIT],
  [STATUS.TRANSIT]: [STATUS.DEST],
  [STATUS.DEST]: [STATUS.OFD],
  [STATUS.OFD]: [STATUS.DELIVERED, STATUS.FAILED],
  [STATUS.FAILED]: [STATUS.REATTEMPT, STATUS.RTO],
  [STATUS.REATTEMPT]: [STATUS.OFD, STATUS.RTO],
  [STATUS.RTO]: [STATUS.RETURNED],
  [STATUS.DELIVERED]: [],
  [STATUS.RETURNED]: [],
  [STATUS.CANCELLED]: [],
};

/** Happy path shown in stepper / timelines. */
export const HAPPY_PATH = [STATUS.BOOKED, STATUS.PICKED, STATUS.ORIGIN, STATUS.TRANSIT, STATUS.DEST, STATUS.OFD, STATUS.DELIVERED];

export const TERMINAL = [STATUS.DELIVERED, STATUS.RETURNED, STATUS.CANCELLED];
export const RTO_GROUP = [STATUS.RTO, STATUS.RETURNED];
export const NDR_GROUP = [STATUS.FAILED, STATUS.REATTEMPT];

export const isTerminal = (s) => TERMINAL.includes(s);
/** Late against ETA. Exceptions already in the NDR/RTO flows are tracked there, not here. */
export const isDelayed = (shipment, now = new Date()) => !isTerminal(shipment.status)
  && !NDR_GROUP.includes(shipment.status) && !RTO_GROUP.includes(shipment.status)
  && new Date(shipment.eta) < now;

export const NDR_REASONS = [
  'Customer not available', 'Wrong address', 'Phone unreachable', 'Refused to accept',
  'COD amount not ready', 'Rescheduled by customer', 'Area not accessible',
];

/**
 * Badge tones. By brief, green is not used: "good" states are dark yellow on
 * light yellow, active states are yellow, neutral gray, and problems red.
 */
const TONES = {
  good: 'bg-primary-light text-primary-dark border-primary/40',
  active: 'bg-primary text-ink border-primary',
  neutral: 'bg-gray-100 text-gray-700 border-gray-200',
  bad: 'bg-danger-light text-danger-dark border-danger/30',
};

const TONE_BY_STATUS = {
  // shipment
  Delivered: 'good',
  'Picked Up': 'active', 'At Origin Hub': 'active', 'In Transit': 'active', 'At Destination Hub': 'active', 'Out for Delivery': 'active', 'Re-attempt': 'active',
  Booked: 'neutral', Pending: 'neutral',
  'Failed Attempt': 'bad', 'Return to Origin': 'bad', Returned: 'bad', Cancelled: 'bad',
  // finance
  Paid: 'good', Reconciled: 'good', Approved: 'good', Deposited: 'active', Collected: 'active', Sent: 'active', Draft: 'neutral', None: 'neutral',
  Overdue: 'bad', Rejected: 'bad', Shortage: 'bad', Excess: 'bad', Unpaid: 'bad', Partial: 'active', Prepaid: 'good', Matched: 'good',
  // generic
  Active: 'good', Inactive: 'neutral', Suspended: 'bad', Verified: 'good', Connected: 'good', Disconnected: 'neutral', 'On Leave': 'neutral', 'On Route': 'active', Available: 'good',
  // support
  Open: 'active', 'In Progress': 'active', Resolved: 'good', Closed: 'neutral', Breached: 'bad', Low: 'neutral', Medium: 'active', High: 'bad', Urgent: 'bad', New: 'active',
  // warehouse / cargo / customs
  'In Stock': 'good', 'Low Stock': 'bad', 'Out of Stock': 'bad', Received: 'good', Expected: 'neutral', Receiving: 'active',
  Picking: 'active', Packing: 'active', 'Ready to Ship': 'good', Open_: 'active',
  Quoted: 'neutral', Confirmed: 'active', Loaded: 'active', Departed: 'active', Arrived: 'active', Completed: 'good',
  Documents: 'neutral', Filed: 'active', Assessment: 'active', 'Duty Paid': 'active', Cleared: 'good', Held: 'bad',
  // manifest
  Created: 'neutral', Dispatched: 'active',
  // returns / claims
  'In Return': 'active', Restocked: 'good', 'Returned to Merchant': 'good', Filed_: 'active', 'Under Review': 'active', Settled: 'good',
  // comms
  Failed: 'bad', Queued: 'neutral', Delivered_: 'good', Scheduled: 'active', Paused: 'neutral',
};

export const statusTone = (s) => TONES[TONE_BY_STATUS[s] || 'neutral'];
export const statusGroup = (s) => TONE_BY_STATUS[s] || 'neutral';
