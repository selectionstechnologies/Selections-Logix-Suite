// Merchants (40), riders (25) and staff users (12), generated from a fixed seed.
import { branches, CITY_MAP } from './geo.js';
import { makeRng } from './rng.js';

const rng = makeRng(2024);

const MERCHANT_NAMES = [
  'Zaryab Fashion House', 'Noor Cosmetics', 'Rang Lifestyle', 'Mehran Electronics', 'Saffron Home', 'Chenab Textiles', 'Bazaar24', 'Ravi Footwear',
  'Attar & Oud Co.', 'TechNest Pakistan', 'Little Stars Kids', 'Desi Organics', 'Margalla Books', 'Kashmir Crafts', 'FitZone Sports', 'PetPal Supplies',
  'Hamza Auto Parts', 'Gulshan Bakers Supply', 'Indus Mobiles', 'Sindh Handicrafts', 'Al Noor Perfumes', 'Marina Gadgets', 'Oasis Abayas', 'Creek Trading LLC',
  'Sultan Spices', 'Pearl Jewellers', 'Falcon Office Supplies', 'Silk Route Traders', 'Hira Pharmacy', 'Rehman Stationers', 'Ahmed Rahim', 'Fatima Noor',
  'Tariq Mahmood', 'Ayesha Malik', 'Imran Qureshi', 'Global Pharma Ltd', 'Packages Industries Corp', 'Crescent Motors', 'Unity Foods Group', 'Emirates Medical Trading',
];
const FIRST = ['Ali', 'Hamza', 'Usman', 'Bilal', 'Asad', 'Faisal', 'Kamran', 'Waqas', 'Junaid', 'Shahid', 'Adeel', 'Rizwan', 'Naveed', 'Saad', 'Imran', 'Zubair', 'Tahir', 'Yasir', 'Arif', 'Danish', 'Salman', 'Haris', 'Nabeel', 'Omer', 'Rashid'];
const LAST = ['Khan', 'Ahmed', 'Malik', 'Hussain', 'Raza', 'Iqbal', 'Sheikh', 'Butt', 'Akhtar', 'Mirza', 'Qureshi', 'Javed', 'Abbas', 'Nawaz', 'Shah'];
const BANKS = ['HBL', 'Meezan Bank', 'UBL', 'Bank Alfalah', 'MCB', 'Emirates NBD', 'ADCB'];
const VEHICLES = ['Motorcycle', 'Motorcycle', 'Motorcycle', 'Van', 'Bicycle'];

const merchantCity = (i) => {
  if (i === 0) return 'Lahore';
  if ([20, 21, 22, 23, 39].includes(i)) return i % 2 ? 'Dubai' : 'Sharjah';
  return rng.pick(['Lahore', 'Lahore', 'Karachi', 'Karachi', 'Islamabad', 'Faisalabad', 'Multan', 'Peshawar', 'Rawalpindi']);
};

export const merchants = MERCHANT_NAMES.map((name, i) => {
  const type = i >= 35 ? 'Corporate' : i >= 30 ? 'Individual' : 'Merchant';
  const city = merchantCity(i);
  const id = `M${String(i + 1).padStart(3, '0')}`;
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
  const uae = CITY_MAP[city].country === 'AE';
  return {
    id,
    name,
    type,
    contact: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    email: `contact@${slug.slice(0, 14)}.example.com`,
    phone: uae ? `+971 5${rng.int(0, 8)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}` : `+92 3${rng.int(0, 4)}${rng.int(0, 9)} ${rng.int(1000000, 9999999)}`,
    city,
    address: `${rng.int(1, 200)}-${rng.pick(['A', 'B', 'C', 'D'])}, ${rng.pick(['Main Boulevard', 'Commercial Area', 'Trade Centre', 'Business Square'])}, ${city}`,
    branchId: CITY_MAP[city].branchId,
    status: i % 13 === 12 ? 'Suspended' : i % 9 === 8 ? 'Inactive' : 'Active',
    kyc: i % 7 === 6 ? 'Pending' : 'Verified',
    kycDocs: i % 7 === 6 ? [] : [{ name: 'CNIC-copy.pdf', size: '312 KB' }, { name: 'Business-registration.pdf', size: '540 KB' }],
    bank: rng.pick(BANKS),
    accountTitle: name,
    iban: `${uae ? 'AE' : 'PK'}${rng.int(10, 99)}SLXB${rng.int(1000000000, 9999999999)}${rng.int(100000, 999999)}`,
    creditLimit: type === 'Corporate' ? 1500000 : type === 'Individual' ? 25000 : rng.pick([150000, 250000, 500000]),
    rateCard: type === 'Corporate' ? 'Corporate Contract' : rng.chance(0.3) ? 'Merchant Plus' : 'Standard',
    discountPct: type === 'Corporate' ? 12 : rng.chance(0.3) ? 6 : 0,
    joinedAt: rng.daysAgo(700, 90).toISOString(),
    pickups: [{ id: `${id}-P1`, label: 'Main warehouse', address: `Warehouse ${rng.int(1, 40)}, Industrial Estate, ${city}`, city, phone: '' }],
    receivers: [],
    apiKey: `slx_live_${id.toLowerCase()}_${rng.int(10000000, 99999999).toString(36)}${rng.int(10000000, 99999999).toString(36)}`,
  };
});

const riderCounts = { LHE: 8, KHI: 7, ISB: 4, PEW: 2, DXB: 3, SHJ: 1 };
const riderList = [];
Object.entries(riderCounts).forEach(([branchId, count]) => {
  for (let n = 0; n < count; n += 1) {
    const i = riderList.length;
    const city = branches.find((b) => b.id === branchId).city;
    const uae = CITY_MAP[city].country === 'AE';
    riderList.push({
      id: `R${String(i + 1).padStart(3, '0')}`,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`,
      phone: uae ? `+971 5${rng.int(0, 8)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}` : `+92 3${rng.int(0, 4)}${rng.int(0, 9)} ${rng.int(1000000, 9999999)}`,
      branchId,
      city,
      zone: `${city} ${rng.pick(['North', 'South', 'East', 'West', 'Central'])}`,
      vehicle: VEHICLES[i % VEHICLES.length],
      plate: uae ? `${rng.pick(['D', 'S'])} ${rng.int(10000, 99999)}` : `${rng.pick(['LEA', 'KHI', 'ICT', 'PSH'])}-${rng.int(100, 9999)}`,
      license: `DL-${rng.int(100000, 999999)}`,
      status: i % 11 === 10 ? 'On Leave' : i % 2 ? 'On Route' : 'Available',
      rating: Math.round((3.6 + rng.next() * 1.4) * 10) / 10,
      joinedAt: rng.daysAgo(900, 60).toISOString(),
      currency: CITY_MAP[city].currency,
    });
  }
});
export const riders = riderList;

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  branch_manager: 'Branch Manager',
  accountant: 'Accountant',
  warehouse: 'Warehouse Staff',
  rider: 'Rider',
  merchant: 'Merchant / Customer',
};

// 12 staff accounts. The first of each role doubles as its demo login.
const staff = [
  ['U01', 'Kashif Rehman', 'admin@selections.demo', 'super_admin', null],
  ['U02', 'Bilal Ahmed', 'lahore.manager@selections.demo', 'branch_manager', 'LHE'],
  ['U03', 'Maria Yousaf', 'accounts@selections.demo', 'accountant', null],
  ['U04', 'Nadeem Akhtar', 'warehouse@selections.demo', 'warehouse', 'LHE'],
  ['U05', riders[0].name, 'rider@selections.demo', 'rider', 'LHE', { riderId: riders[0].id }],
  ['U06', merchants[0].contact, 'merchant@selections.demo', 'merchant', 'LHE', { merchantId: merchants[0].id }],
  ['U07', 'Hina Siddiqui', 'karachi.manager@selections.demo', 'branch_manager', 'KHI'],
  ['U08', 'Usman Tariq', 'islamabad.manager@selections.demo', 'branch_manager', 'ISB'],
  ['U09', 'Omar Farooq', 'dubai.manager@selections.demo', 'branch_manager', 'DXB'],
  ['U10', 'Saba Javed', 'accounts2@selections.demo', 'accountant', 'KHI'],
  ['U11', 'Rizwan Shah', 'warehouse.dxb@selections.demo', 'warehouse', 'DXB'],
  ['U12', 'Ayesha Nawaz', 'ops@selections.demo', 'super_admin', null],
];

export const users = staff.map(([id, name, email, role, branchId, extra]) => ({
  id, name, email, role, branchId, status: 'Active', lastLogin: rng.daysAgo(5, 0).toISOString(), ...(extra || {}),
}));
