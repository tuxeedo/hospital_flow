import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import db from './db.js';
import {
  authenticateToken,
  requireRole,
  hashPassword,
  comparePassword,
  generateToken,
  encrypt,
  decrypt,
  auditLog,
  validatePassword,
  validatePhone,
  validateCitizenship,
  validateNID
} from './auth.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Create HTTP and WebSocket Server
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade
httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

// Helper to broadcast queue updates to all live clients
function broadcastQueueUpdate() {
  const message = JSON.stringify({ type: 'QUEUE_UPDATE', timestamp: new Date() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ================= AUTH ROUTES =================

// Register Patient
app.post('/api/auth/register', (req, res) => {
  const { username, password, name, phone, dob, gender, citizenshipNo, nationalId, bloodGroup, allergies, emergencyContact, address } = req.body;

  if (!username || !password || !name || !phone || !dob || !gender) {
    return res.status(400).json({ error: 'Missing required registration fields' });
  }

  // Input Validation Rules
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters, contain a capital letter, a number, and a special character.' });
  }

  if (!validatePhone(phone)) {
    return res.status(400).json({ error: 'Phone number must start with +977 followed by exactly 10 digits (e.g. +9779841234567).' });
  }

  if (citizenshipNo && !validateCitizenship(citizenshipNo)) {
    return res.status(400).json({ error: 'Citizenship number does not match Nepali format (e.g. 77-01-72-12345).' });
  }

  if (nationalId && !validateNID(nationalId)) {
    return res.status(400).json({ error: 'National ID (NID) must be a standard 10-digit number.' });
  }

  // Check if username/phone already exists to prevent duplicate profiles
  db.get("SELECT id FROM users WHERE username = ?", [username], (err, userExists) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (userExists) {
      return res.status(400).json({ error: 'Username already registered' });
    }

    db.get("SELECT id FROM patient_profiles WHERE phone = ?", [phone], (err, profileExists) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (profileExists) {
        return res.status(400).json({ error: 'Phone number already associated with a patient profile' });
      }

      // Hash password and encrypt sensitive IDs
      const passwordHash = hashPassword(password);
      const encryptedCitizenship = encrypt(citizenshipNo);
      const encryptedNID = encrypt(nationalId);

      db.run(
        "INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, 'Patient', ?, ?)",
        [username, passwordHash, name, phone],
        function (err) {
          if (err) return res.status(500).json({ error: 'Error creating user account' });
          const userId = this.lastID;

          db.run(
            `INSERT INTO patient_profiles 
             (user_id, name, phone, dob, gender, citizenship_no_encrypted, national_id_encrypted, blood_group, allergies, emergency_contact, address) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, name, phone, dob, gender, encryptedCitizenship, encryptedNID, bloodGroup, allergies, emergencyContact, address],
            function (err) {
              if (err) {
                // Rollback user
                db.run("DELETE FROM users WHERE id = ?", [userId]);
                return res.status(500).json({ error: 'Error creating patient profile' });
              }

              const token = generateToken({ id: userId, username, role: 'Patient', name });
              auditLog(userId, 'PATIENT_REGISTER', `Registered patient: ${name}`, req);
              res.status(201).json({ token, role: 'Patient', name });
            }
          );
        }
      );
    });
  });
});

// Login (Unified)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user || !comparePassword(password, user.password_hash)) {
      auditLog('anonymous', 'LOGIN_FAILED', `Failed login attempt for username: ${username}`, req);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken(user);
    auditLog(user.id, 'LOGIN_SUCCESS', `User logged in: ${user.name} (${user.role})`, req);
    res.json({ token, role: user.role, name: user.name, username: user.username });
  });
});

// Get Logged In User
app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get("SELECT id, username, role, name, phone FROM users WHERE id = ?", [req.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found' });
    
    if (user.role === 'Patient') {
      db.get("SELECT * FROM patient_profiles WHERE user_id = ?", [user.id], (err, profile) => {
        if (profile) {
          if (profile.citizenship_no_encrypted) {
            profile.citizenship_no = decrypt(profile.citizenship_no_encrypted);
          }
          if (profile.national_id_encrypted) {
            profile.national_id = decrypt(profile.national_id_encrypted);
          }
        }
        res.json({ user, profile });
      });
    } else {
      res.json({ user });
    }
  });
});


// ================= DIRECTORY ROUTES =================

app.get('/api/directory/departments', (req, res) => {
  db.all("SELECT * FROM departments", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/directory/doctors', (req, res) => {
  db.all(
    `SELECT doctors.id, users.name, doctors.specialization, doctors.room_number, doctors.is_available, departments.name as department_name, departments.id as department_id
     FROM doctors
     JOIN users ON doctors.user_id = users.id
     JOIN departments ON doctors.department_id = departments.id`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

app.get('/api/directory/hospitals', (req, res) => {
  const { specialty } = req.query;
  db.all("SELECT * FROM hospitals ORDER BY distance_km ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    const parsedHospitals = rows.map(h => ({
      ...h,
      specialties: JSON.parse(h.specialties)
    }));

    if (specialty) {
      const filtered = parsedHospitals.filter(h => h.specialties.includes(specialty));
      return res.json(filtered);
    }
    
    res.json(parsedHospitals);
  });
});


// ================= APPOINTMENT & QUEUE ROUTES =================

// Patient Portal: Book Appointment
app.post('/api/appointments/book', authenticateToken, (req, res) => {
  const { doctorId, departmentId, date, time } = req.body;
  const isPatient = req.user.role === 'Patient';
  
  if (!doctorId || !departmentId || !date || !time) {
    return res.status(400).json({ error: 'Missing appointment criteria' });
  }

  // Find patient ID
  const getPatientId = (callback) => {
    if (isPatient) {
      db.get("SELECT id FROM patient_profiles WHERE user_id = ?", [req.user.id], (err, row) => {
        if (err || !row) return callback(new Error('Patient profile not found'));
        callback(null, row.id);
      });
    } else {
      // Walk-in booking by Receptionist
      const { walkinPatientId } = req.body;
      if (!walkinPatientId) return callback(new Error('Patient ID required for walk-in appointment'));
      callback(null, walkinPatientId);
    }
  };

  getPatientId((err, patientId) => {
    if (err) return res.status(404).json({ error: err.message });

    // Prevent double booking for the same slot
    db.get(
      "SELECT id FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'Cancelled'",
      [doctorId, date, time],
      (err, doubleBooking) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (doubleBooking) {
          return res.status(400).json({ error: 'This appointment slot is already booked' });
        }

        // Generate Token Number for the day
        db.get(
          "SELECT COUNT(*) as count FROM appointments WHERE doctor_id = ? AND appointment_date = ?",
          [doctorId, date],
          (err, row) => {
            const tokenNumber = (row ? row.count : 0) + 1;

            db.run(
              `INSERT INTO appointments (patient_id, doctor_id, department_id, appointment_date, appointment_time, token_number)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [patientId, doctorId, departmentId, date, time],
              function (err) {
                if (err) return res.status(500).json({ error: 'Failed to book appointment' });
                
                const appointmentId = this.lastID;
                auditLog(req.user.id, 'APPOINTMENT_BOOK', `Booked appointment ID: ${appointmentId} Token: ${tokenNumber}`, req);

                res.status(201).json({
                  message: 'Appointment booked successfully',
                  appointmentId,
                  tokenNumber,
                  qrCodeData: `HOSPFLOW-APT-${appointmentId}`
                });
              }
            );
          }
        );
      }
    );
  });
});

// Get My Appointments
app.get('/api/appointments/my', authenticateToken, (req, res) => {
  if (req.user.role !== 'Patient') {
    return res.status(403).json({ error: 'Patient access only' });
  }

  db.get("SELECT id FROM patient_profiles WHERE user_id = ?", [req.user.id], (err, profile) => {
    if (err || !profile) return res.status(404).json({ error: 'Profile not found' });

    db.all(
      `SELECT appointments.*, users.name as doctor_name, departments.name as department_name, doctors.room_number
       FROM appointments
       JOIN doctors ON appointments.doctor_id = doctors.id
       JOIN users ON doctors.user_id = users.id
       JOIN departments ON appointments.department_id = departments.id
       WHERE appointments.patient_id = ?
       ORDER BY appointments.appointment_date DESC, appointments.appointment_time DESC`,
      [profile.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
      }
    );
  });
});

// Receptionist: Check-in (Add to smart queue)
app.post('/api/appointments/checkin', authenticateToken, requireRole(['Receptionist', 'Admin']), (req, res) => {
  const { appointmentId, priority } = req.body;

  if (!appointmentId) return res.status(400).json({ error: 'Appointment ID required' });

  db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId], (err, apt) => {
    if (err || !apt) return res.status(404).json({ error: 'Appointment not found' });
    if (apt.status !== 'Scheduled') return res.status(400).json({ error: `Cannot check-in. Current status: ${apt.status}` });

    db.run("UPDATE appointments SET status = 'CheckedIn' WHERE id = ?", [appointmentId], (err) => {
      if (err) return res.status(500).json({ error: 'Database update failed' });

      // Add to Queue
      db.run(
        `INSERT INTO smart_queue (appointment_id, patient_id, department_id, doctor_id, token_number, priority)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [appointmentId, apt.patient_id, apt.department_id, apt.doctor_id, apt.token_number, priority || 'Normal'],
        function (err) {
          if (err) return res.status(500).json({ error: 'Failed to insert into live queue' });
          
          auditLog(req.user.id, 'APPOINTMENT_CHECKIN', `Checked in appointment: ${appointmentId} to Live Queue`, req);
          broadcastQueueUpdate();
          res.json({ message: 'Checked in successfully. Added to department queue.', queueId: this.lastID });
        }
      );
    });
  });
});

// Receptionist: Register Walk-in Visit directly
app.post('/api/walkin/register', authenticateToken, requireRole(['Receptionist', 'Admin']), (req, res) => {
  const { name, phone, dob, gender, bloodGroup, allergies, departmentId, doctorId, priority, citizenshipNo, nationalId } = req.body;

  if (!name || !phone || !dob || !gender || !departmentId) {
    return res.status(400).json({ error: 'Missing required walk-in details' });
  }

  if (!validatePhone(phone)) {
    return res.status(400).json({ error: 'Phone number must start with +977 followed by exactly 10 digits.' });
  }

  if (citizenshipNo && !validateCitizenship(citizenshipNo)) {
    return res.status(400).json({ error: 'Citizenship number does not match Nepali format (e.g. 77-01-72-12345).' });
  }

  if (nationalId && !validateNID(nationalId)) {
    return res.status(400).json({ error: 'National ID (NID) must be a standard 10-digit number.' });
  }

  db.serialize(() => {
    // 1. Find or create patient profile
    db.get("SELECT id FROM patient_profiles WHERE phone = ?", [phone], (err, profile) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      const proceedWithProfile = (patientId) => {
        // 2. Generate a token number for today
        const todayStr = new Date().toISOString().split('T')[0];
        db.get(
          "SELECT COUNT(*) as count FROM appointments WHERE doctor_id = ? AND appointment_date = ?",
          [doctorId, todayStr],
          (err, countRow) => {
            const tokenNumber = (countRow ? countRow.count : 0) + 1;

            // 3. Create CheckedIn Appointment
            db.run(
              `INSERT INTO appointments (patient_id, doctor_id, department_id, appointment_date, appointment_time, token_number, status)
               VALUES (?, ?, ?, ?, 'Walk-in', ?, 'CheckedIn')`,
              [patientId, doctorId, departmentId, todayStr, tokenNumber],
              function (err) {
                if (err) return res.status(500).json({ error: 'Walk-in booking error' });
                const appointmentId = this.lastID;

                // 4. Add to smart queue
                db.run(
                  `INSERT INTO smart_queue (appointment_id, patient_id, department_id, doctor_id, token_number, priority)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [appointmentId, patientId, departmentId, doctorId, tokenNumber, priority || 'Normal'],
                  function (err) {
                    if (err) return res.status(500).json({ error: 'Walk-in queue addition error' });
                    
                    auditLog(req.user.id, 'WALKIN_REGISTER', `Walk-in registration patient ID: ${patientId}, Token: ${tokenNumber}`, req);
                    broadcastQueueUpdate();
                    res.status(201).json({
                      message: 'Walk-in registered and queued successfully',
                      patientId,
                      tokenNumber,
                      appointmentId
                    });
                  }
                );
              }
            );
          }
        );
      };

      if (profile) {
        proceedWithProfile(profile.id);
      } else {
        // Create new walk-in profile
        const encryptedCitizenship = encrypt(citizenshipNo);
        const encryptedNID = encrypt(nationalId);

        db.run(
          `INSERT INTO patient_profiles (name, phone, dob, gender, blood_group, allergies, citizenship_no_encrypted, national_id_encrypted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [name, phone, dob, gender, bloodGroup, allergies, encryptedCitizenship, encryptedNID],
          function (err) {
            if (err) return res.status(500).json({ error: 'Error creating patient profile' });
            proceedWithProfile(this.lastID);
          }
        );
      }
    });
  });
});

// Live Queue Status API
app.get('/api/queue/status', (req, res) => {
  // Returns department-level counts and current serving numbers
  db.all(
    `SELECT 
      departments.id as department_id, 
      departments.name as department_name, 
      departments.code as department_code,
      COUNT(CASE WHEN smart_queue.status = 'Waiting' THEN 1 END) as waiting_count,
      MIN(CASE WHEN smart_queue.status = 'Waiting' THEN smart_queue.token_number END) as next_token,
      MAX(CASE WHEN smart_queue.status = 'Serving' THEN smart_queue.token_number END) as currently_serving
     FROM departments
     LEFT JOIN smart_queue ON departments.id = smart_queue.department_id
     GROUP BY departments.id`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

// Get queue status for a specific patient
app.get('/api/queue/my-position/:appointmentId', (req, res) => {
  const { appointmentId } = req.params;

  db.get(
    `SELECT q.*, d.name as department_name, doc_u.name as doctor_name
     FROM smart_queue q
     JOIN departments d ON q.department_id = d.id
     JOIN doctors doc ON q.doctor_id = doc.id
     JOIN users doc_u ON doc.user_id = doc_u.id
     WHERE q.appointment_id = ?`,
    [appointmentId],
    (err, myQueue) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!myQueue) return res.status(404).json({ error: 'Active queue token not found' });

      // Count how many patients with higher priority or earlier checkin are waiting in front
      let priorityWeight = "CASE WHEN priority = 'Emergency' THEN 1 WHEN priority = 'Disabled' THEN 2 WHEN priority = 'Pregnant' THEN 3 WHEN priority = 'Senior' THEN 4 WHEN priority = 'Child' THEN 5 ELSE 6 END";
      
      db.get(
        `SELECT COUNT(*) as count 
         FROM smart_queue 
         WHERE department_id = ? 
           AND status = 'Waiting' 
           AND (
             ${priorityWeight} < (SELECT ${priorityWeight} FROM smart_queue WHERE id = ?) 
             OR (
               ${priorityWeight} = (SELECT ${priorityWeight} FROM smart_queue WHERE id = ?) 
               AND checkin_time < ?
             )
           )`,
        [myQueue.department_id, myQueue.id, myQueue.id, myQueue.checkin_time],
        (err, countRow) => {
          if (err) return res.status(500).json({ error: 'Database error counting position' });
          
          res.json({
            myQueue,
            position: countRow.count + 1,
            estimated_wait_mins: (countRow.count + 1) * 12 // Assume ~12 mins average consultation
          });
        }
      );
    }
  );
});


// ================= DOCTOR DASHBOARD ROUTES =================

// List doctor's active patient queue
app.get('/api/doctor/queue', authenticateToken, requireRole(['Doctor', 'Admin']), (req, res) => {
  // Find doctor's user id mapping
  db.get("SELECT id FROM doctors WHERE user_id = ?", [req.user.id], (err, doc) => {
    if (err || !doc) return res.status(404).json({ error: 'Doctor record not found' });

    db.all(
      `SELECT q.id as queue_id, q.token_number, q.priority, q.status, q.appointment_id,
              p.id as patient_id, p.name as patient_name, p.dob, p.gender, p.blood_group, p.allergies, p.insurance_status
       FROM smart_queue q
       JOIN patient_profiles p ON q.patient_id = p.id
       WHERE q.doctor_id = ? AND q.status IN ('Waiting', 'Serving')
       ORDER BY 
         CASE q.priority
           WHEN 'Emergency' THEN 1
           WHEN 'Disabled' THEN 2
           WHEN 'Pregnant' THEN 3
           WHEN 'Senior' THEN 4
           WHEN 'Child' THEN 5
           ELSE 6
         END, q.checkin_time ASC`,
      [doc.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ doctorId: doc.id, queue: rows });
      }
    );
  });
});

// Call next patient / Serve Patient
app.post('/api/doctor/serve', authenticateToken, requireRole(['Doctor', 'Admin']), (req, res) => {
  const { queueId } = req.body;

  db.get("SELECT * FROM smart_queue WHERE id = ?", [queueId], (err, qItem) => {
    if (err || !qItem) return res.status(404).json({ error: 'Queue item not found' });

    // Set any currently serving patient by this doctor to Completed
    db.run(
      "UPDATE smart_queue SET status = 'Completed' WHERE doctor_id = ? AND status = 'Serving'",
      [qItem.doctor_id],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to update current patient' });

        db.run("UPDATE smart_queue SET status = 'Serving' WHERE id = ?", [queueId], (err) => {
          if (err) return res.status(500).json({ error: 'Failed to serve next patient' });

          db.run("UPDATE appointments SET status = 'Serving' WHERE id = ?", [qItem.appointment_id]);
          
          auditLog(req.user.id, 'DOCTOR_SERVE_START', `Doctor serving patient queue item ID: ${queueId}`, req);
          broadcastQueueUpdate();
          res.json({ message: 'Patient called. Status updated to Serving.' });
        });
      }
    );
  });
});

// Complete Consultation, Save Diagnosis & E-Prescription
app.post('/api/doctor/consultation/complete', authenticateToken, requireRole(['Doctor', 'Admin']), (req, res) => {
  const { appointmentId, patientId, notes, prescriptions } = req.body; // prescriptions = Array of { medicine_name, dosage, frequency, duration, instructions }

  if (!patientId || !appointmentId) {
    return res.status(400).json({ error: 'Missing required consultation identifiers' });
  }

  db.get("SELECT id FROM doctors WHERE user_id = ?", [req.user.id], (err, doc) => {
    if (err || !doc) return res.status(404).json({ error: 'Doctor not found' });

    db.serialize(() => {
      // 1. Create prescription entry
      db.run(
        "INSERT INTO prescriptions (patient_id, doctor_id, appointment_id, notes) VALUES (?, ?, ?, ?)",
        [patientId, doc.id, appointmentId, notes || ''],
        function (err) {
          if (err) return res.status(500).json({ error: 'Failed to record consultation prescription' });
          const prescriptionId = this.lastID;

          // 2. Insert items if any
          if (prescriptions && prescriptions.length > 0) {
            const stmtItem = db.prepare(
              `INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency, duration, instructions)
               VALUES (?, ?, ?, ?, ?, ?)`
            );
            prescriptions.forEach(p => {
              stmtItem.run(prescriptionId, p.medicine_name, p.dosage, p.frequency, p.duration, p.instructions || '');
            });
            stmtItem.finalize();
          }

          // 3. Mark Queue as Completed
          db.run(
            "UPDATE smart_queue SET status = 'Completed' WHERE appointment_id = ?",
            [appointmentId],
            (err) => {
              if (err) return res.status(500).json({ error: 'Failed to clear queue status' });

              db.run("UPDATE appointments SET status = 'Completed' WHERE id = ?", [appointmentId]);

              // 4. Create Billing Record (Basic setup: consultation fee + registration)
              const consultationFee = 200.0;
              const registrationFee = 50.0;
              const subtotal = consultationFee + registrationFee;
              
              // Calculate medicine totals if medicines prescribed
              db.all(
                "SELECT unit_price FROM pharmacy_inventory WHERE medicine_name IN (SELECT medicine_name FROM prescription_items WHERE prescription_id = ?)",
                [prescriptionId],
                (err, prices) => {
                  let medicineSubtotal = 0;
                  if (!err && prices) {
                    // Quick simulation: assume 10 units/tablets per prescription item
                    medicineSubtotal = prices.reduce((sum, item) => sum + (item.unit_price * 10), 0);
                  }
                  
                  const total = subtotal + medicineSubtotal;

                  db.run(
                    `INSERT INTO billing (patient_id, appointment_id, total_amount, net_payable, status)
                     VALUES (?, ?, ?, ?, 'Unpaid')`,
                    [patientId, appointmentId, total, total],
                    (err) => {
                      auditLog(req.user.id, 'CONSULTATION_COMPLETE', `Completed appointment ${appointmentId}, added billing and prescriptions`, req);
                      broadcastQueueUpdate();
                      res.json({ message: 'Consultation recorded, prescription sent, billing generated.', prescriptionId });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});

// Patient medical history
app.get('/api/patients/:patientId/history', authenticateToken, (req, res) => {
  const { patientId } = req.params;

  // Security: Patient can only view their own history. Staff can view anyone.
  if (req.user.role === 'Patient') {
    db.get("SELECT id FROM patient_profiles WHERE user_id = ?", [req.user.id], (err, profile) => {
      if (err || !profile || String(profile.id) !== String(patientId)) {
        return res.status(403).json({ error: 'Unauthorized to view this patient profile' });
      }
      fetchHistory();
    });
  } else {
    fetchHistory();
  }

  function fetchHistory() {
    db.all(
      `SELECT p.id as prescription_id, p.notes, p.created_at, u.name as doctor_name, d.name as department_name
       FROM prescriptions p
       JOIN doctors doc ON p.doctor_id = doc.id
       JOIN users u ON doc.user_id = u.id
       JOIN departments d ON doc.department_id = d.id
       WHERE p.patient_id = ?
       ORDER BY p.created_at DESC`,
      [patientId],
      (err, prescriptions) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        if (prescriptions.length === 0) {
          return res.json({ prescriptions: [] });
        }

        // Fetch prescription items
        const rxIds = prescriptions.map(p => p.prescription_id);
        const placeholders = rxIds.map(() => '?').join(',');
        
        db.all(
          `SELECT * FROM prescription_items WHERE prescription_id IN (${placeholders})`,
          rxIds,
          (err, items) => {
            if (err) return res.status(500).json({ error: 'Database error loading items' });

            const history = prescriptions.map(p => {
              return {
                ...p,
                items: items.filter(item => item.prescription_id === p.prescription_id)
              };
            });

            res.json({ prescriptions: history });
          }
        );
      }
    );
  }
});


// ================= PHARMACY ROUTES =================

// List pending prescriptions
app.get('/api/pharmacy/prescriptions', authenticateToken, requireRole(['Pharmacist', 'Admin']), (req, res) => {
  db.all(
    `SELECT rx.id as prescription_id, rx.created_at, p.name as patient_name, p.phone as patient_phone, u.name as doctor_name
     FROM prescriptions rx
     JOIN patient_profiles p ON rx.patient_id = p.id
     JOIN doctors d ON rx.doctor_id = d.id
     JOIN users u ON d.user_id = u.id
     WHERE rx.id IN (SELECT DISTINCT prescription_id FROM prescription_items WHERE status = 'Pending')
     ORDER BY rx.created_at ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

// View single prescription items and check stock levels
app.get('/api/pharmacy/prescriptions/:rxId', authenticateToken, requireRole(['Pharmacist', 'Admin']), (req, res) => {
  const { rxId } = req.params;

  db.all(
    `SELECT pi.*, inv.stock_qty, inv.unit_price, inv.expiry_date
     FROM prescription_items pi
     LEFT JOIN pharmacy_inventory inv ON pi.medicine_name = inv.medicine_name
     WHERE pi.prescription_id = ?`,
    [rxId],
    (err, items) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(items);
    }
  );
});

// Dispense Prescription items with inventory deduction
app.post('/api/pharmacy/dispense', authenticateToken, requireRole(['Pharmacist', 'Admin']), (req, res) => {
  const { prescriptionId, items } = req.body; // items = Array of { itemId, quantityDispensed, substitutedMedicine }

  if (!prescriptionId || !items || items.length === 0) {
    return res.status(400).json({ error: 'Prescription details missing' });
  }

  db.serialize(() => {
    let transactionSuccess = true;
    let itemsCompleted = 0;

    items.forEach((item) => {
      db.get(
        "SELECT pi.medicine_name, inv.stock_qty FROM prescription_items pi LEFT JOIN pharmacy_inventory inv ON pi.medicine_name = inv.medicine_name WHERE pi.id = ?",
        [item.itemId],
        (err, row) => {
          if (err || !row) {
            transactionSuccess = false;
            return;
          }

          const medicineDispensed = item.substitutedMedicine || row.medicine_name;
          const dispenseQty = 10; // Mock: dispense standard 10 units per request

          // Deduct from inventory
          db.run(
            "UPDATE pharmacy_inventory SET stock_qty = MAX(0, stock_qty - ?) WHERE medicine_name = ?",
            [dispenseQty, medicineDispensed],
            (err) => {
              if (err) transactionSuccess = false;

              // Update prescription item status
              db.run(
                "UPDATE prescription_items SET status = ?, substituted_medicine = ? WHERE id = ?",
                [item.substitutedMedicine ? 'Substituted' : 'Dispensed', item.substitutedMedicine || null, item.itemId],
                (err) => {
                  if (err) transactionSuccess = false;

                  itemsCompleted++;
                  if (itemsCompleted === items.length) {
                    if (transactionSuccess) {
                      auditLog(req.user.id, 'PHARMACY_DISPENSE', `Dispensed prescription items for rx ID: ${prescriptionId}`, req);
                      res.json({ message: 'Prescription items dispensed successfully' });
                    } else {
                      res.status(500).json({ error: 'Error occurred during stock updates' });
                    }
                  }
                }
              );
            }
          );
        }
      );
    });
  });
});

// Pharmacy Inventory Management
app.get('/api/pharmacy/inventory', authenticateToken, requireRole(['Pharmacist', 'Admin']), (req, res) => {
  db.all("SELECT * FROM pharmacy_inventory", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/pharmacy/inventory/update', authenticateToken, requireRole(['Pharmacist', 'Admin']), (req, res) => {
  const { medicine_name, stock_qty, unit_price, expiry_date } = req.body;

  db.run(
    `INSERT INTO pharmacy_inventory (medicine_name, stock_qty, unit_price, expiry_date)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(medicine_name) DO UPDATE SET
       stock_qty = stock_qty + excluded.stock_qty,
       unit_price = excluded.unit_price,
       expiry_date = excluded.expiry_date`,
    [medicine_name, stock_qty, unit_price, expiry_date],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update inventory' });
      auditLog(req.user.id, 'INVENTORY_STOCK_UPDATE', `Updated stock for: ${medicine_name}`, req);
      res.json({ message: 'Stock updated successfully' });
    }
  );
});


// ================= BILLING ROUTES =================

// Get unpaid bills (Cashier panel)
app.get('/api/billing/pending', authenticateToken, requireRole(['Cashier', 'Admin']), (req, res) => {
  db.all(
    `SELECT b.*, p.name as patient_name, p.phone as patient_phone, u.name as doctor_name, dept.name as department_name
     FROM billing b
     JOIN patient_profiles p ON b.patient_id = p.id
     LEFT JOIN appointments apt ON b.appointment_id = apt.id
     LEFT JOIN doctors doc ON apt.doctor_id = doc.id
     LEFT JOIN users u ON doc.user_id = u.id
     LEFT JOIN departments dept ON apt.department_id = dept.id
     WHERE b.status = 'Unpaid'
     ORDER BY b.created_at ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

// Update patient insurance verification details
app.post('/api/billing/verify-insurance', authenticateToken, requireRole(['Cashier', 'Receptionist', 'Admin']), (req, res) => {
  const { patientId, insuranceProvider, insuranceNo, status } = req.body;

  db.run(
    "UPDATE patient_profiles SET insurance_provider = ?, insurance_no = ?, insurance_status = ? WHERE id = ?",
    [insuranceProvider, insuranceNo, status, patientId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update insurance status' });
      auditLog(req.user.id, 'INSURANCE_VERIFY', `Verified insurance for patient: ${patientId} Status: ${status}`, req);
      res.json({ message: 'Insurance details updated successfully' });
    }
  );
});

// Pay Bill
app.post('/api/billing/:billId/pay', authenticateToken, requireRole(['Cashier', 'Admin']), (req, res) => {
  const { billId } = req.params;
  const { paymentMethod, transactionId, discountAmount, insuranceCovered } = req.body;

  db.get("SELECT * FROM billing WHERE id = ?", [billId], (err, bill) => {
    if (err || !bill) return res.status(404).json({ error: 'Bill record not found' });
    if (bill.status === 'Paid') return res.status(400).json({ error: 'Bill is already paid' });

    const discount = discountAmount || 0;
    const insurance = insuranceCovered || 0;
    const netPayable = Math.max(0, bill.total_amount - discount - insurance);

    db.run(
      `UPDATE billing 
       SET status = 'Paid', payment_method = ?, transaction_id = ?, discount_amount = ?, insurance_covered = ?, net_payable = ?
       WHERE id = ?`,
      [paymentMethod, transactionId || `TXN-${Date.now()}`, discount, insurance, netPayable, billId],
      (err) => {
        if (err) return res.status(500).json({ error: 'Payment processing failed' });
        auditLog(req.user.id, 'BILL_PAID', `Paid bill ID: ${billId} net: NRs. ${netPayable} via ${paymentMethod}`, req);
        res.json({ message: 'Bill paid successfully', netPayable });
      }
    );
  });
});


// ================= ADMIN ANALYTICS =================

app.get('/api/admin/analytics', authenticateToken, requireRole(['Admin']), (req, res) => {
  // Aggregate KPIs
  const queries = {
    totalPatients: "SELECT COUNT(*) as count FROM patient_profiles",
    appointmentsToday: "SELECT COUNT(*) as count FROM appointments WHERE appointment_date = date('now')",
    avgWaitTime: "SELECT AVG(estimated_wait_mins) as wait FROM smart_queue WHERE status = 'Completed'",
    deptStats: `SELECT d.name as department, COUNT(q.id) as patient_count 
                FROM departments d 
                LEFT JOIN smart_queue q ON d.id = q.department_id 
                GROUP BY d.id`,
    revenueByMethod: "SELECT payment_method, SUM(net_payable) as revenue FROM billing WHERE status = 'Paid' GROUP BY payment_method",
    noShowRate: `SELECT 
                  (COUNT(CASE WHEN status = 'Missed' THEN 1 END) * 100.0 / COUNT(*)) as rate 
                 FROM appointments`
  };

  db.serialize(() => {
    const results = {};
    let pendingQueries = Object.keys(queries).length;

    Object.entries(queries).forEach(([key, sql]) => {
      db.all(sql, [], (err, rows) => {
        if (!err) {
          results[key] = rows;
        }
        pendingQueries--;
        if (pendingQueries === 0) {
          res.json(results);
        }
      });
    });
  });
});

app.get('/api/admin/audit-logs', authenticateToken, requireRole(['Admin']), (req, res) => {
  db.all(
    `SELECT audit_logs.*, users.name as user_name, users.role 
     FROM audit_logs 
     LEFT JOIN users ON audit_logs.user_id = users.id 
     ORDER BY audit_logs.timestamp DESC LIMIT 100`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    }
  );
});

// Run Server
httpServer.listen(PORT, () => {
  console.log(`HospitalFlow server running on port ${PORT}`);
});
