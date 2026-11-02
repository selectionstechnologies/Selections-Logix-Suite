// Cities and branches. Six branches serve the ten cities the network covers.

export const CITIES = [
  { name: 'Lahore', code: 'LHE', country: 'PK', region: 'Punjab', branchId: 'LHE', currency: 'PKR' },
  { name: 'Faisalabad', code: 'FSD', country: 'PK', region: 'Punjab', branchId: 'LHE', currency: 'PKR' },
  { name: 'Multan', code: 'MUX', country: 'PK', region: 'Punjab', branchId: 'LHE', currency: 'PKR' },
  { name: 'Karachi', code: 'KHI', country: 'PK', region: 'Sindh', branchId: 'KHI', currency: 'PKR' },
  { name: 'Quetta', code: 'UET', country: 'PK', region: 'Balochistan', branchId: 'KHI', currency: 'PKR', remote: true },
  { name: 'Islamabad', code: 'ISB', country: 'PK', region: 'Capital', branchId: 'ISB', currency: 'PKR' },
  { name: 'Rawalpindi', code: 'RWP', country: 'PK', region: 'Capital', branchId: 'ISB', currency: 'PKR' },
  { name: 'Peshawar', code: 'PEW', country: 'PK', region: 'KPK', branchId: 'PEW', currency: 'PKR', remote: true },
  { name: 'Dubai', code: 'DXB', country: 'AE', region: 'UAE', branchId: 'DXB', currency: 'AED' },
  { name: 'Sharjah', code: 'SHJ', country: 'AE', region: 'UAE', branchId: 'SHJ', currency: 'AED' },
];

export const CITY_MAP = Object.fromEntries(CITIES.map((c) => [c.name, c]));
export const CITY_NAMES = CITIES.map((c) => c.name);

export const branches = [
  { id: 'LHE', code: 'LHE-01', name: 'Lahore Main Hub', type: 'Hub', city: 'Lahore', address: '42 Ferozepur Road, Gulberg III, Lahore', manager: 'Bilal Ahmed', phone: '+92 42 3577 1100', hours: '08:00 - 22:00', status: 'Active', targetShipments: 90, targetRevenue: 95000, commissionPct: 0, cash: 0 },
  { id: 'KHI', code: 'KHI-01', name: 'Karachi Port Hub', type: 'Hub', city: 'Karachi', address: 'Plot 18, SITE Area, Karachi', manager: 'Hina Siddiqui', phone: '+92 21 3255 8800', hours: '08:00 - 22:00', status: 'Active', targetShipments: 80, targetRevenue: 85000, commissionPct: 0, cash: 0 },
  { id: 'ISB', code: 'ISB-01', name: 'Islamabad Office', type: 'Office', city: 'Islamabad', address: 'Office 7, I-9 Markaz, Islamabad', manager: 'Usman Tariq', phone: '+92 51 444 2200', hours: '09:00 - 20:00', status: 'Active', targetShipments: 50, targetRevenue: 55000, commissionPct: 4, cash: 0 },
  { id: 'PEW', code: 'PEW-01', name: 'Peshawar Franchise', type: 'Franchise', city: 'Peshawar', address: 'Ring Road, Hayatabad Phase 3, Peshawar', manager: 'Zainab Khan', phone: '+92 91 581 3300', hours: '09:00 - 19:00', status: 'Active', targetShipments: 30, targetRevenue: 30000, commissionPct: 12, cash: 0 },
  { id: 'DXB', code: 'DXB-01', name: 'Dubai Warehouse', type: 'Warehouse', city: 'Dubai', address: 'Unit 12, Al Quoz Industrial 3, Dubai', manager: 'Omar Farooq', phone: '+971 4 338 9000', hours: '08:00 - 20:00', status: 'Active', targetShipments: 35, targetRevenue: 90000, commissionPct: 0, cash: 0 },
  { id: 'SHJ', code: 'SHJ-01', name: 'Sharjah Office', type: 'Office', city: 'Sharjah', address: 'Shop 4, Industrial Area 6, Sharjah', manager: 'Sana Mirza', phone: '+971 6 533 1200', hours: '09:00 - 18:00', status: 'Active', targetShipments: 20, targetRevenue: 45000, commissionPct: 6, cash: 0 },
];

export const BRANCH_TYPES = ['Hub', 'Office', 'Warehouse', 'Franchise'];
