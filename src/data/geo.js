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

// Delivery zones per city (dummy). Names match rider zones ("Lahore North") so a parcel can be routed to a rider.
const zone = (city, side, areas) => ({ value: `${city} ${side}`, side, areas });
export const ZONES = {
  Lahore: [
    zone('Lahore', 'Central', 'Gulberg, Model Town, Garden Town'),
    zone('Lahore', 'North', 'Shahdara, Walled City, Ravi Road'),
    zone('Lahore', 'South', 'DHA, Bahria Town, Askari'),
    zone('Lahore', 'East', 'Cantt, Harbanspura, Wapda Town'),
    zone('Lahore', 'West', 'Johar Town, Iqbal Town, Thokar'),
  ],
  Faisalabad: [
    zone('Faisalabad', 'Central', 'Clock Tower, D Ground, Peoples Colony'),
    zone('Faisalabad', 'North', 'Madina Town, Samanabad'),
    zone('Faisalabad', 'South', 'Jinnah Colony, Gulistan Colony'),
  ],
  Multan: [
    zone('Multan', 'Central', 'Hussain Agahi, Gulgasht'),
    zone('Multan', 'North', 'Bosan Road, Shah Rukn-e-Alam'),
    zone('Multan', 'South', 'Cantt, Mumtazabad'),
  ],
  Karachi: [
    zone('Karachi', 'Central', 'Saddar, PECHS, Tariq Road'),
    zone('Karachi', 'North', 'North Nazimabad, Gulshan, FB Area'),
    zone('Karachi', 'South', 'Clifton, DHA, Defence View'),
    zone('Karachi', 'East', 'Korangi, Malir, Landhi'),
    zone('Karachi', 'West', 'SITE, Orangi, Baldia'),
  ],
  Quetta: [
    zone('Quetta', 'Central', 'Jinnah Road, Satellite Town'),
    zone('Quetta', 'North', 'Samungli Road, Airport Road'),
  ],
  Islamabad: [
    zone('Islamabad', 'Central', 'Blue Area, F-6, F-7'),
    zone('Islamabad', 'North', 'E-11, F-10, F-11'),
    zone('Islamabad', 'South', 'G-9, G-10, I-8, I-9'),
    zone('Islamabad', 'East', 'Bahria Town, DHA, PWD'),
  ],
  Rawalpindi: [
    zone('Rawalpindi', 'Central', 'Saddar, Raja Bazaar'),
    zone('Rawalpindi', 'North', 'Satellite Town, Commercial Market'),
    zone('Rawalpindi', 'South', 'Chaklala, Westridge'),
  ],
  Peshawar: [
    zone('Peshawar', 'Central', 'Saddar, University Road'),
    zone('Peshawar', 'West', 'Hayatabad, Karkhano'),
    zone('Peshawar', 'North', 'Gulbahar, Warsak Road'),
  ],
  Dubai: [
    zone('Dubai', 'Central', 'Bur Dubai, Karama, Downtown'),
    zone('Dubai', 'North', 'Deira, Al Qusais, Al Nahda'),
    zone('Dubai', 'South', 'Al Barsha, JLT, Marina'),
    zone('Dubai', 'East', 'Al Quoz, Mirdif, Silicon Oasis'),
  ],
  Sharjah: [
    zone('Sharjah', 'Central', 'Al Majaz, Rolla, Al Nahda'),
    zone('Sharjah', 'North', 'Al Khan, Al Taawun'),
    zone('Sharjah', 'East', 'Industrial Area, Muweilah'),
  ],
};

export const branches = [
  { id: 'LHE', code: 'LHE-01', name: 'Lahore Main Hub', type: 'Hub', city: 'Lahore', address: '42 Ferozepur Road, Gulberg III, Lahore', manager: 'Bilal Ahmed', phone: '+92 42 3577 1100', hours: '08:00 - 22:00', status: 'Active', targetShipments: 90, targetRevenue: 95000, commissionPct: 0, cash: 0 },
  { id: 'KHI', code: 'KHI-01', name: 'Karachi Port Hub', type: 'Hub', city: 'Karachi', address: 'Plot 18, SITE Area, Karachi', manager: 'Hina Siddiqui', phone: '+92 21 3255 8800', hours: '08:00 - 22:00', status: 'Active', targetShipments: 80, targetRevenue: 85000, commissionPct: 0, cash: 0 },
  { id: 'ISB', code: 'ISB-01', name: 'Islamabad Office', type: 'Office', city: 'Islamabad', address: 'Office 7, I-9 Markaz, Islamabad', manager: 'Usman Tariq', phone: '+92 51 444 2200', hours: '09:00 - 20:00', status: 'Active', targetShipments: 50, targetRevenue: 55000, commissionPct: 4, cash: 0 },
  { id: 'PEW', code: 'PEW-01', name: 'Peshawar Franchise', type: 'Franchise', city: 'Peshawar', address: 'Ring Road, Hayatabad Phase 3, Peshawar', manager: 'Zainab Khan', phone: '+92 91 581 3300', hours: '09:00 - 19:00', status: 'Active', targetShipments: 30, targetRevenue: 30000, commissionPct: 12, cash: 0 },
  { id: 'DXB', code: 'DXB-01', name: 'Dubai Warehouse', type: 'Warehouse', city: 'Dubai', address: 'Unit 12, Al Quoz Industrial 3, Dubai', manager: 'Omar Farooq', phone: '+971 4 338 9000', hours: '08:00 - 20:00', status: 'Active', targetShipments: 35, targetRevenue: 90000, commissionPct: 0, cash: 0 },
  { id: 'SHJ', code: 'SHJ-01', name: 'Sharjah Office', type: 'Office', city: 'Sharjah', address: 'Shop 4, Industrial Area 6, Sharjah', manager: 'Sana Mirza', phone: '+971 6 533 1200', hours: '09:00 - 18:00', status: 'Active', targetShipments: 20, targetRevenue: 45000, commissionPct: 6, cash: 0 },
];

export const BRANCH_TYPES = ['Hub', 'Office', 'Warehouse', 'Franchise'];
