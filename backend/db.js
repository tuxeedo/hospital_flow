import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. Audit Logs (to log all read/write actions on sensitive health data)
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 2. Users Table (Patient accounts & Staff accounts)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Patient', 'Receptionist', 'Doctor', 'Pharmacist', 'Cashier', 'Admin')),
    name TEXT NOT NULL,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 3. Departments Table
  db.run(`CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    description TEXT
  )`);

  // 4. Doctors Table
  db.run(`CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    department_id INTEGER NOT NULL,
    specialization TEXT,
    room_number TEXT,
    is_available INTEGER DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(department_id) REFERENCES departments(id)
  )`);

  // 5. Patient Profiles (Protected personal and medical info)
  db.run(`CREATE TABLE IF NOT EXISTS patient_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE, -- Null for walk-ins without online account
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    dob TEXT NOT NULL,
    gender TEXT NOT NULL,
    citizenship_no_encrypted TEXT,
    national_id_encrypted TEXT,
    blood_group TEXT,
    allergies TEXT,
    insurance_provider TEXT,
    insurance_no TEXT,
    insurance_status TEXT DEFAULT 'Unverified',
    emergency_contact TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 5b. Hospitals Table (For specialized referrals and proximity maps)
  db.run(`CREATE TABLE IF NOT EXISTS hospitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    distance_km REAL NOT NULL,
    specialties TEXT NOT NULL, -- JSON array of specialized departments
    contact_phone TEXT
  )`);

  // 6. Appointments Table
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    appointment_date TEXT NOT NULL,
    appointment_time TEXT NOT NULL,
    token_number INTEGER NOT NULL,
    status TEXT DEFAULT 'Scheduled' CHECK(status IN ('Scheduled', 'CheckedIn', 'Serving', 'Completed', 'Cancelled', 'Missed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(patient_id) REFERENCES patient_profiles(id),
    FOREIGN KEY(doctor_id) REFERENCES doctors(id),
    FOREIGN KEY(department_id) REFERENCES departments(id)
  )`);

  // 7. Smart Queue Table
  db.run(`CREATE TABLE IF NOT EXISTS smart_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER UNIQUE,
    patient_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    doctor_id INTEGER,
    token_number INTEGER NOT NULL,
    priority TEXT DEFAULT 'Normal' CHECK(priority IN ('Normal', 'Senior', 'Pregnant', 'Disabled', 'Child', 'Emergency')),
    status TEXT DEFAULT 'Waiting' CHECK(status IN ('Waiting', 'Serving', 'Skipped', 'Completed')),
    checkin_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    estimated_wait_mins INTEGER DEFAULT 15,
    FOREIGN KEY(appointment_id) REFERENCES appointments(id),
    FOREIGN KEY(patient_id) REFERENCES patient_profiles(id),
    FOREIGN KEY(department_id) REFERENCES departments(id),
    FOREIGN KEY(doctor_id) REFERENCES doctors(id)
  )`);

  // 8. Electronic Prescriptions
  db.run(`CREATE TABLE IF NOT EXISTS prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    appointment_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(patient_id) REFERENCES patient_profiles(id),
    FOREIGN KEY(doctor_id) REFERENCES doctors(id),
    FOREIGN KEY(appointment_id) REFERENCES appointments(id)
  )`);

  // 9. Prescription Items
  db.run(`CREATE TABLE IF NOT EXISTS prescription_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prescription_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    dosage TEXT NOT NULL, -- e.g. "500mg"
    frequency TEXT NOT NULL, -- e.g. "1-0-1" (morning and night)
    duration TEXT NOT NULL, -- e.g. "7 days"
    instructions TEXT, -- e.g. "After food"
    status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Dispensed', 'Substituted')),
    substituted_medicine TEXT,
    FOREIGN KEY(prescription_id) REFERENCES prescriptions(id)
  )`);

  // 10. Billing Records
  db.run(`CREATE TABLE IF NOT EXISTS billing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    appointment_id INTEGER,
    total_amount REAL NOT NULL,
    discount_amount REAL DEFAULT 0.0,
    insurance_covered REAL DEFAULT 0.0,
    net_payable REAL NOT NULL,
    status TEXT DEFAULT 'Unpaid' CHECK(status IN ('Unpaid', 'Paid', 'Refunded')),
    payment_method TEXT CHECK(payment_method IN ('Cash', 'Card', 'eSewa', 'Khalti', 'Fonepay', 'ConnectIPS', 'Insurance', 'Split')),
    transaction_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(patient_id) REFERENCES patient_profiles(id),
    FOREIGN KEY(appointment_id) REFERENCES appointments(id)
  )`);

  // 11. Pharmacy Inventory
  db.run(`CREATE TABLE IF NOT EXISTS pharmacy_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_name TEXT UNIQUE NOT NULL,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER DEFAULT 20,
    unit_price REAL NOT NULL,
    expiry_date TEXT NOT NULL
  )`);

  // Seed Initial Data
  seedInitialData();
});

function seedInitialData() {
  // Check if users already exist
  db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
    if (err) return console.error(err);
    if (row.count > 0) return; // Already seeded

    console.log("Seeding initial database data...");

    // Setup Roles
    const salt = bcrypt.genSaltSync(10);
    const pReceptionist = bcrypt.hashSync("password123", salt);
    const pDoctor = bcrypt.hashSync("password123", salt);
    const pPharmacist = bcrypt.hashSync("password123", salt);
    const pCashier = bcrypt.hashSync("password123", salt);
    const pAdmin = bcrypt.hashSync("password123", salt);

    const usersToInsert = [
      { u: 'receptionist', p: pReceptionist, r: 'Receptionist', n: 'Sita Sharma', ph: '9841234567' },
      { u: 'doctor_ramesh', p: pDoctor, r: 'Doctor', n: 'Dr. Ramesh Karki', ph: '9847654321' },
      { u: 'doctor_anita', p: pDoctor, r: 'Doctor', n: 'Dr. Anita Adhikari', ph: '9845551234' },
      { u: 'pharmacist', p: pPharmacist, r: 'Pharmacist', n: 'Hari Prasad', ph: '9849998887' },
      { u: 'cashier', p: pCashier, r: 'Cashier', n: 'Maya Devkota', ph: '9846665554' },
      { u: 'admin', p: pAdmin, r: 'Admin', n: 'Admin Bahadur', ph: '9840001112' }
    ];

    const stmtUser = db.prepare("INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, ?, ?, ?)");
    usersToInsert.forEach(u => {
      stmtUser.run(u.u, u.p, u.r, u.n, u.ph);
    });
    stmtUser.finalize();

    // Setup Departments
    const depts = [
      { name: 'General Medicine', code: 'GEN', desc: 'Routine health checkups, fever, hypertension' },
      { name: 'Pediatrics', code: 'PED', desc: 'Child healthcare and vaccinations' },
      { name: 'Orthopedics', code: 'ORT', desc: 'Bones, joints, and fractures care' },
      { name: 'Cardiology', code: 'CAR', desc: 'Heart conditions and diagnostics' },
      { name: 'Gynecology', code: 'GYN', desc: 'Maternal and women health services' }
    ];
    const stmtDept = db.prepare("INSERT INTO departments (name, code, description) VALUES (?, ?, ?)");
    depts.forEach(d => {
      stmtDept.run(d.name, d.code, d.desc);
    });
    stmtDept.finalize();

    // Map Doctors to Departments
    db.serialize(() => {
      db.all("SELECT id, username FROM users WHERE role = 'Doctor'", [], (err, docs) => {
        if (err || !docs) return;
        
        db.all("SELECT id, code FROM departments", [], (err, departments) => {
          if (err || !departments) return;

          const stmtDoc = db.prepare("INSERT INTO doctors (user_id, department_id, specialization, room_number) VALUES (?, ?, ?, ?)");
          
          const drRamesh = docs.find(d => d.username === 'doctor_ramesh');
          const drAnita = docs.find(d => d.username === 'doctor_anita');
          const genDept = departments.find(d => d.code === 'GEN');
          const pedDept = departments.find(d => d.code === 'PED');

          if (drRamesh && genDept) {
            stmtDoc.run(drRamesh.id, genDept.id, 'Internal Medicine Specialist', 'Room 101');
          }
          if (drAnita && pedDept) {
            stmtDoc.run(drAnita.id, pedDept.id, 'Senior Pediatric Consultant', 'Room 105');
          }
          stmtDoc.finalize();
        });
      });
    });

    // Seed Pharmacy Stock
    const meds = [
      { name: 'Paracetamol 500mg', qty: 500, price: 2.0, exp: '2027-12-31' },
      { name: 'Amoxicillin 250mg', qty: 250, price: 12.5, exp: '2026-09-30' },
      { name: 'Ibuprofen 400mg', qty: 150, price: 5.0, exp: '2027-06-15' },
      { name: 'Pantoprazole 40mg', qty: 300, price: 8.0, exp: '2028-03-20' },
      { name: 'Cetirizine 10mg', qty: 400, price: 3.5, exp: '2027-10-10' }
    ];
    const stmtMed = db.prepare("INSERT INTO pharmacy_inventory (medicine_name, stock_qty, unit_price, expiry_date) VALUES (?, ?, ?, ?)");
    meds.forEach(m => {
      stmtMed.run(m.name, m.qty, m.price, m.exp);
    });
    stmtMed.finalize();

    // Seed Specialized Hospitals
    const hosps = [
      { name: 'Bir Hospital', loc: 'Kantipath, Kathmandu', lat: 27.7061, lng: 85.3129, dist: 1.5, specs: '["General Medicine", "Cardiology"]', phone: '01-4221119' },
      { name: 'Patan Hospital', loc: 'Lagankhel, Lalitpur', lat: 27.6685, lng: 85.3204, dist: 4.2, specs: '["Pediatrics", "Gynecology"]', phone: '01-5521034' },
      { name: 'Tribhuvan University Teaching Hospital (TUTH)', loc: 'Maharajgunj, Kathmandu', lat: 27.7342, lng: 85.3302, dist: 3.8, specs: '["Pediatrics", "Orthopedics", "Cardiology"]', phone: '01-4412505' },
      { name: 'Sahid Gangalal National Heart Center', loc: 'Bansbari, Kathmandu', lat: 27.7408, lng: 85.3411, dist: 5.0, specs: '["Cardiology"]', phone: '01-4371322' },
      { name: 'Nepal Cancer Hospital & Research Center', loc: 'Harisiddhi, Lalitpur', lat: 27.6421, lng: 85.3402, dist: 8.5, specs: '["Oncology"]', phone: '01-5251312' }
    ];
    const stmtHosp = db.prepare("INSERT INTO hospitals (name, location, latitude, longitude, distance_km, specialties, contact_phone) VALUES (?, ?, ?, ?, ?, ?, ?)");
    hosps.forEach(h => {
      stmtHosp.run(h.name, h.loc, h.lat, h.lng, h.dist, h.specs, h.phone);
    });
    stmtHosp.finalize();

    console.log("Database seeded successfully.");
  });
}

export default db;
export { dbPath };
