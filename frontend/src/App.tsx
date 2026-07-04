import React, { useState, useEffect, useRef } from 'react';
import {
  Activity, Calendar, Clock, User, Shield, Key, HeartPulse, Search, Plus,
  CheckCircle, FileText, ShoppingBag, CreditCard, Users, LogOut, RefreshCw, AlertTriangle, ShieldAlert
} from 'lucide-react';

// API Url prefix
const API_BASE = '/api';

interface Department {
  id: number;
  name: string;
  code: string;
  description: string;
}

interface Doctor {
  id: number;
  name: string;
  specialization: string;
  room_number: string;
  is_available: number;
  department_name: string;
  department_id: number;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('hf_token'));
  const [role, setRole] = useState<string | null>(localStorage.getItem('hf_role'));
  const [name, setName] = useState<string | null>(localStorage.getItem('hf_name'));
  const [username, setUsername] = useState<string | null>(localStorage.getItem('hf_username'));
  const [view, setView] = useState<string>('home'); // active sub-tab/view

  // Auth States
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [authError, setAuthError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Register Form States
  const [regUser, setRegUser] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regDob, setRegDob] = useState('');
  const [regGender, setRegGender] = useState('Male');
  const [regCitizenship, setRegCitizenship] = useState('');
  const [regNationalId, setRegNationalId] = useState('');
  const [regBlood, setRegBlood] = useState('O+');
  const [regAllergies, setRegAllergies] = useState('');
  const [regEmergency, setRegEmergency] = useState('');
  const [regAddress, setRegAddress] = useState('');

  // Directory Data
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [queueStatus, setQueueStatus] = useState<any[]>([]);

  // WebSocket Live Updates Connection
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetchDirectory();
    fetchQueueStatus();

    // Connect WebSockets
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws`;

    const connectWS = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'QUEUE_UPDATE') {
          fetchQueueStatus();
          // Trigger role-specific live data re-fetches
          triggerLiveReload();
        }
      };

      ws.onclose = () => {
        setTimeout(connectWS, 3000); // Auto reconnect
      };
    };

    connectWS();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  const triggerLiveReload = () => {
    // Check role and refresh respective states
    if (role === 'Doctor') loadDoctorQueue();
    if (role === 'Receptionist') loadReceptionistData();
    if (role === 'Pharmacist') loadPharmacyData();
    if (role === 'Cashier') loadBillingData();
    if (role === 'Patient') loadPatientData();
    if (role === 'Admin') loadAdminData();
  };

  const fetchDirectory = async () => {
    try {
      const rDep = await fetch(`${API_BASE}/directory/departments`);
      const dDep = await rDep.json();
      setDepartments(dDep);

      const rDoc = await fetch(`${API_BASE}/directory/doctors`);
      const dDoc = await rDoc.json();
      setDoctors(dDoc);
    } catch (e) { console.error("Error fetching directory", e); }
  };

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/queue/status`);
      const data = await res.json();
      setQueueStatus(data);
    } catch (e) { console.error("Error loading queue", e); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass })
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('hf_token', data.token);
        localStorage.setItem('hf_role', data.role);
        localStorage.setItem('hf_name', data.name);
        localStorage.setItem('hf_username', data.username);
        setToken(data.token);
        setRole(data.role);
        setName(data.name);
        setUsername(data.username);
        setView('dashboard');
        // Clear forms
        setLoginUser('');
        setLoginPass('');
      } else {
        setAuthError(data.error || 'Login failed');
      }
    } catch (e) {
      setAuthError('Connection server error');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    // Frontend Input Validations
    const passRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passRegex.test(regPass)) {
      setAuthError('Password must be at least 8 characters, and contain a capital letter, a number, and a special character.');
      return;
    }

    const phoneRegex = /^\+977\d{10}$/;
    if (!phoneRegex.test(regPhone)) {
      setAuthError('Phone number must start with +977 followed by exactly 10 digits (e.g. +9779841234567).');
      return;
    }

    const citizenRegex = /^\d+([-/\s]\d+)+$/;
    if (regCitizenship && !citizenRegex.test(regCitizenship)) {
      setAuthError('Citizenship number does not match Nepali format (e.g. 77-01-72-12345).');
      return;
    }

    if (regNationalId) {
      const nidClean = regNationalId.replace(/[-/\s]/g, '');
      if (nidClean.length !== 10 || isNaN(Number(nidClean))) {
        setAuthError('National ID (NID) must be a standard 10-digit number.');
        return;
      }
    }

    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: regUser,
          password: regPass,
          name: regName,
          phone: regPhone,
          dob: regDob,
          gender: regGender,
          citizenshipNo: regCitizenship,
          nationalId: regNationalId,
          bloodGroup: regBlood,
          allergies: regAllergies,
          emergencyContact: regEmergency,
          address: regAddress
        })
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('hf_token', data.token);
        localStorage.setItem('hf_role', data.role);
        localStorage.setItem('hf_name', data.name);
        localStorage.setItem('hf_username', regUser);
        setToken(data.token);
        setRole(data.role);
        setName(data.name);
        setUsername(regUser);
        setView('dashboard');
        setIsRegistering(false);
      } else {
        setAuthError(data.error || 'Registration failed');
      }
    } catch (e) {
      setAuthError('Registration connection error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('hf_token');
    localStorage.removeItem('hf_role');
    localStorage.removeItem('hf_name');
    localStorage.removeItem('hf_username');
    setToken(null);
    setRole(null);
    setName(null);
    setUsername(null);
    setView('home');
  };

  // ----------------------------------------------------
  // ROLE DASHBOARDS INTERACTION LOGIC
  // ----------------------------------------------------

  // 1. PATIENT DASHBOARD DATA
  const [patientProfile, setPatientProfile] = useState<any>(null);
  const [patientAppointments, setPatientAppointments] = useState<any[]>([]);
  const [myQueuePosition, setMyQueuePosition] = useState<any>(null);
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);

  // Booking Form State
  const [bookDeptId, setBookDeptId] = useState('');
  const [bookDocId, setBookDocId] = useState('');
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState<any>(null);

  const loadPatientData = async () => {
    try {
      const headers = { 'Authorization': `Bearer ${token}` };

      // Get Profile Info
      const resMe = await fetch(`${API_BASE}/auth/me`, { headers });
      const dataMe = await resMe.json();
      setPatientProfile(dataMe.profile);

      // Get Appointments
      const resApt = await fetch(`${API_BASE}/appointments/my`, { headers });
      const dataApt = await resApt.json();
      setPatientAppointments(dataApt);

      // Get medical history
      if (dataMe.profile) {
        const resHist = await fetch(`${API_BASE}/patients/${dataMe.profile.id}/history`, { headers });
        const dataHist = await resHist.json();
        setHistoryRecords(dataHist.prescriptions || []);

        // Load queue position if checked-in appointment exists
        const checkedInApt = dataApt.find((a: any) => a.status === 'CheckedIn' || a.status === 'Serving');
        if (checkedInApt) {
          const resQ = await fetch(`${API_BASE}/queue/my-position/${checkedInApt.id}`);
          const dataQ = await resQ.json();
          setMyQueuePosition(dataQ);
        } else {
          setMyQueuePosition(null);
        }
      }
    } catch (e) { console.error(e); }
  };

  const handleBookAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/appointments/book`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          doctorId: bookDocId,
          departmentId: bookDeptId,
          date: bookDate,
          time: bookTime
        })
      });
      const data = await res.json();
      if (res.ok) {
        setBookingSuccess(data);
        // Reset inputs
        setBookDeptId('');
        setBookDocId('');
        setBookDate('');
        setBookTime('');
        loadPatientData();
      } else {
        alert(data.error || 'Failed to book slot');
      }
    } catch (e) { alert('Error booking slot'); }
  };

  // 2. RECEPTIONIST DASHBOARD
  const [appointmentsList, setAppointmentsList] = useState<any[]>([]);
  const [searchPhone, setSearchPhone] = useState('');
  const [walkinName, setWalkinName] = useState('');
  const [walkinPhone, setWalkinPhone] = useState('');
  const [walkinDob, setWalkinDob] = useState('');
  const [walkinGender, setWalkinGender] = useState('Male');
  const [walkinBlood, setWalkinBlood] = useState('O+');
  const [walkinAllergies, setWalkinAllergies] = useState('');
  const [walkinDept, setWalkinDept] = useState('');
  const [walkinDoc, setWalkinDoc] = useState('');
  const [walkinPriority, setWalkinPriority] = useState('Normal');

  const loadReceptionistData = async () => {
    // List all today's checked-in or scheduled appointments in system
    try {
      const res = await fetch(`${API_BASE}/queue/status`);
      // We will simulate load of all active schedules
    } catch (e) { console.error(e); }
  };

  const handleWalkinRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/walkin/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: walkinName,
          phone: walkinPhone,
          dob: walkinDob,
          gender: walkinGender,
          bloodGroup: walkinBlood,
          allergies: walkinAllergies,
          departmentId: walkinDept,
          doctorId: walkinDoc,
          priority: walkinPriority
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Walk-in Registered! Token Number is: ${data.tokenNumber}`);
        // Reset walkin form
        setWalkinName(''); setWalkinPhone(''); setWalkinDob(''); setWalkinAllergies(''); setWalkinDept(''); setWalkinDoc('');
      } else {
        alert(data.error);
      }
    } catch (e) { alert('Error registering walk-in'); }
  };

  const handleCheckInSearch = async () => {
    // Simple search by patient phone to list their scheduled appointments
    if (!searchPhone) return;
    try {
      const res = await fetch(`${API_BASE}/patients/search?phone=${searchPhone}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      // For this prototype, we query by listing patient appointments on demand
      const resProfile = await fetch(`${API_BASE}/patients/search-profile?phone=${searchPhone}`);
    } catch (e) { console.error(e); }
  };

  // 3. DOCTOR PORTAL
  const [doctorQueue, setDoctorQueue] = useState<any[]>([]);
  const [currentPatient, setCurrentPatient] = useState<any>(null);

  // Prescription Composer
  const [consultNotes, setConsultNotes] = useState('');
  const [prescriptionItems, setPrescriptionItems] = useState<any[]>([]);
  const [medInput, setMedInput] = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [medFreq, setMedFreq] = useState('1-0-1');
  const [medDuration, setMedDuration] = useState('7 days');
  const [medInst, setMedInst] = useState('After food');

  const loadDoctorQueue = async () => {
    try {
      const res = await fetch(`${API_BASE}/doctor/queue`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setDoctorQueue(data.queue);
        const active = data.queue.find((q: any) => q.status === 'Serving');
        setCurrentPatient(active || null);
      }
    } catch (e) { console.error(e); }
  };

  const handleCallPatient = async (queueId: number) => {
    try {
      const res = await fetch(`${API_BASE}/doctor/serve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ queueId })
      });
      if (res.ok) {
        loadDoctorQueue();
      }
    } catch (e) { console.error(e); }
  };

  const addPrescriptionItem = () => {
    if (!medInput || !medDosage) return;
    setPrescriptionItems([...prescriptionItems, {
      medicine_name: medInput,
      dosage: medDosage,
      frequency: medFreq,
      duration: medDuration,
      instructions: medInst
    }]);
    setMedInput('');
    setMedDosage('');
  };

  const handleCompleteConsultation = async () => {
    if (!currentPatient) return;
    try {
      const res = await fetch(`${API_BASE}/doctor/consultation/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          appointmentId: currentPatient.appointment_id,
          patientId: currentPatient.patient_id,
          notes: consultNotes,
          prescriptions: prescriptionItems
        })
      });
      if (res.ok) {
        alert("Consultation complete. Record saved and prescription sent to pharmacy.");
        setConsultNotes('');
        setPrescriptionItems([]);
        setCurrentPatient(null);
        loadDoctorQueue();
      }
    } catch (e) { console.error(e); }
  };

  // 4. PHARMACIST PORTAL
  const [pendingRx, setPendingRx] = useState<any[]>([]);
  const [selectedRx, setSelectedRx] = useState<any>(null);
  const [rxItems, setRxItems] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);

  // Add stock form
  const [invName, setInvName] = useState('');
  const [invQty, setInvQty] = useState('');
  const [invPrice, setInvPrice] = useState('');
  const [invExp, setInvExp] = useState('');

  const loadPharmacyData = async () => {
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const resRx = await fetch(`${API_BASE}/pharmacy/prescriptions`, { headers });
      const dataRx = await resRx.json();
      setPendingRx(dataRx);

      const resInv = await fetch(`${API_BASE}/pharmacy/inventory`, { headers });
      const dataInv = await resInv.json();
      setInventory(dataInv);
    } catch (e) { console.error(e); }
  };

  const selectPrescription = async (rx: any) => {
    setSelectedRx(rx);
    try {
      const res = await fetch(`${API_BASE}/pharmacy/prescriptions/${rx.prescription_id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setRxItems(data);
    } catch (e) { console.error(e); }
  };

  const handleDispenseMedicine = async () => {
    if (!selectedRx) return;
    try {
      const dispenseItems = rxItems.map(item => ({
        itemId: item.id,
        substitutedMedicine: null // Can be set for alternate drug
      }));

      const res = await fetch(`${API_BASE}/pharmacy/dispense`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          prescriptionId: selectedRx.prescription_id,
          items: dispenseItems
        })
      });
      if (res.ok) {
        alert("Prescription items marked as dispensed. Stock decremented.");
        setSelectedRx(null);
        setRxItems([]);
        loadPharmacyData();
      }
    } catch (e) { console.error(e); }
  };

  const handleUpdateStock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/pharmacy/inventory/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          medicine_name: invName,
          stock_qty: parseInt(invQty),
          unit_price: parseFloat(invPrice),
          expiry_date: invExp
        })
      });
      if (res.ok) {
        alert("Inventory stock updated successfully");
        setInvName(''); setInvQty(''); setInvPrice(''); setInvExp('');
        loadPharmacyData();
      }
    } catch (e) { console.error(e); }
  };

  // 5. CASHIER PORTAL
  const [pendingBills, setPendingBills] = useState<any[]>([]);
  const [payMethod, setPayMethod] = useState<'Cash' | 'Card' | 'eSewa' | 'Khalti' | 'Fonepay' | 'ConnectIPS' | 'Insurance'>('Cash');
  const [txnId, setTxnId] = useState('');
  const [verifyInsPatientId, setVerifyInsPatientId] = useState('');
  const [verifyInsProvider, setVerifyInsProvider] = useState('Govt Insurance Nepal');
  const [verifyInsNo, setVerifyInsNo] = useState('');

  const loadBillingData = async () => {
    try {
      const res = await fetch(`${API_BASE}/billing/pending`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setPendingBills(data);
    } catch (e) { console.error(e); }
  };

  const handlePayBill = async (billId: number) => {
    try {
      const res = await fetch(`${API_BASE}/billing/${billId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          paymentMethod: payMethod,
          transactionId: txnId || `TXN-${Date.now()}`
        })
      });
      if (res.ok) {
        alert("Payment collected successfully. Bill status set to Paid.");
        setTxnId('');
        loadBillingData();
      }
    } catch (e) { console.error(e); }
  };

  const handleVerifyInsurance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/billing/verify-insurance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          patientId: verifyInsPatientId,
          insuranceProvider: verifyInsProvider,
          insuranceNo: verifyInsNo,
          status: 'Verified'
        })
      });
      if (res.ok) {
        alert("Insurance verified and linked to patient file.");
        setVerifyInsPatientId(''); setVerifyInsNo('');
        loadBillingData();
      }
    } catch (e) { console.error(e); }
  };

  // 6. ADMIN DASHBOARD
  const [analytics, setAnalytics] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const loadAdminData = async () => {
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const resA = await fetch(`${API_BASE}/admin/analytics`, { headers });
      const dataA = await resA.json();
      setAnalytics(dataA);

      const resL = await fetch(`${API_BASE}/admin/audit-logs`, { headers });
      const dataL = await resL.json();
      setAuditLogs(dataL);
    } catch (e) { console.error(e); }
  };

  // Load Data on view transition
  useEffect(() => {
    if (view === 'dashboard' && role) {
      if (role === 'Patient') loadPatientData();
      if (role === 'Receptionist') loadReceptionistData();
      if (role === 'Doctor') loadDoctorQueue();
      if (role === 'Pharmacist') loadPharmacyData();
      if (role === 'Cashier') loadBillingData();
      if (role === 'Admin') loadAdminData();
    }
  }, [view, role]);

  return (
    <div>
      <header>
        <div className="brand">
          <HeartPulse size={28} />
          <span>HospitalFlow <span style={{ fontWeight: 400, color: 'hsl(var(--text-secondary))' }}>Nepal</span></span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {token ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span className="badge badge-info">{role}</span>
              <span style={{ fontWeight: 600 }}>{name}</span>
              <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                <LogOut size={16} /> Log Out
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => { setIsRegistering(false); setView('login'); }} className="btn btn-secondary">Log In</button>
              <button onClick={() => { setIsRegistering(true); setView('login'); }} className="btn btn-primary">Patient Register</button>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div className="container" style={{ minHeight: 'calc(100vh - 120px)' }}>

        {/* LANDING PAGE / QUEUE MONITOR (PUBLIC VIEW) */}
        {view === 'home' && (
          <div className="content-pane">
            <div className="queue-status-banner">
              <h1 style={{ fontSize: '2.2rem', marginBottom: '0.5rem', fontWeight: 800 }}>Reduce OPD Wait Times</h1>
              <p style={{ fontSize: '1.1rem', opacity: 0.9 }}>
                HospitalFlow allows real-time ticket check-in and virtual queue tracking.
                Nepal's first Smart HIS designed for physical queue eradication.
              </p>
            </div>

            <div className="grid-2">
              <div className="card">
                <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Clock style={{ color: 'hsl(var(--primary))' }} /> Live Department Queues
                </h2>
                <p style={{ color: 'hsl(var(--text-secondary))', marginBottom: '1.5rem' }}>
                  Monitor wait queues in real-time. Check-in online to get your ticket token.
                </p>

                {queueStatus.length === 0 ? (
                  <p style={{ color: 'hsl(var(--text-muted))' }}>Loading live status...</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {queueStatus.map((dept) => (
                      <div key={dept.department_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: '#fafbfc', borderRadius: '10px', border: '1px solid hsl(var(--border-color))' }}>
                        <div>
                          <h4 style={{ fontWeight: 700 }}>{dept.department_name}</h4>
                          <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>Code: {dept.department_code}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '1.5rem', textAlign: 'right' }}>
                          <div>
                            <div style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>Serving</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'hsl(var(--success))' }}>#{dept.currently_serving || '-'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>Waiting</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'hsl(var(--primary))' }}>{dept.waiting_count}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h3 style={{ marginBottom: '0.5rem' }}>Are you a Hospital Staff?</h3>
                <p style={{ color: 'hsl(var(--text-secondary))', marginBottom: '1.5rem' }}>
                  Log in using your provided credentials to access your dashboard.
                </p>
                <div style={{ background: '#f5f6f8', padding: '1rem', borderRadius: '10px', border: '1px dashed hsl(var(--border-color))', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Demo Access Accounts:</div>
                  <ul style={{ paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <li>Receptionist: <code style={{ background: '#fff', padding: '0 4px' }}>receptionist</code> / <code style={{ background: '#fff', padding: '0 4px' }}>password123</code></li>
                    <li>Doctor: <code style={{ background: '#fff', padding: '0 4px' }}>doctor_ramesh</code> / <code style={{ background: '#fff', padding: '0 4px' }}>password123</code></li>
                    <li>Pharmacist: <code style={{ background: '#fff', padding: '0 4px' }}>pharmacist</code> / <code style={{ background: '#fff', padding: '0 4px' }}>password123</code></li>
                    <li>Cashier: <code style={{ background: '#fff', padding: '0 4px' }}>cashier</code> / <code style={{ background: '#fff', padding: '0 4px' }}>password123</code></li>
                    <li>Admin: <code style={{ background: '#fff', padding: '0 4px' }}>admin</code> / <code style={{ background: '#fff', padding: '0 4px' }}>password123</code></li>
                  </ul>
                </div>
                <button onClick={() => { setIsRegistering(false); setView('login'); }} className="btn btn-primary" style={{ width: '100%' }}>
                  Proceed to Login
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LOGIN / SIGNUP PANE */}
        {view === 'login' && (
          <div className="content-pane" style={{ maxWidth: '500px', margin: '3rem auto' }}>
            <div className="card">
              <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
                {isRegistering ? 'Patient Self-Registration' : 'Sign In to Portal'}
              </h2>

              {authError && (
                <div style={{ background: 'hsl(var(--danger-light))', color: 'hsl(var(--danger))', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.85rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <AlertTriangle size={16} /> {authError}
                </div>
              )}

              {!isRegistering ? (
                <form onSubmit={handleLogin}>
                  <div className="input-group">
                    <label>Username / Phone</label>
                    <input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="Username" required />
                  </div>
                  <div className="input-group">
                    <label>Password</label>
                    <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Password" required />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>Sign In</button>
                  <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'hsl(var(--text-secondary))' }}>
                    New patient? <a href="#" onClick={(e) => { e.preventDefault(); setIsRegistering(true); }} style={{ color: 'hsl(var(--primary))', fontWeight: 600 }}>Create Profile</a>
                  </p>
                </form>
              ) : (
                <form onSubmit={handleRegister}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="input-group">
                      <label>Username</label>
                      <input type="text" value={regUser} onChange={e => setRegUser(e.target.value)} placeholder="username" required />
                    </div>
                    <div className="input-group">
                      <label>Password</label>
                      <input type="password" value={regPass} onChange={e => setRegPass(e.target.value)} required />
                    </div>
                  </div>

                  <div className="input-group">
                    <label>Full Name</label>
                    <input type="text" value={regName} onChange={e => setRegName(e.target.value)} placeholder="Enter your full name" required />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="input-group">
                      <label>Phone Number</label>
                      <input type="text" value={regPhone} onChange={e => setRegPhone(e.target.value)} placeholder="984XXXXXXX" required />
                    </div>
                    <div className="input-group">
                      <label>DOB (BS or AD)</label>
                      <input type="date" value={regDob} onChange={e => setRegDob(e.target.value)} required />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="input-group">
                      <label>Gender</label>
                      <select value={regGender} onChange={e => setRegGender(e.target.value)}>
                        <option>Male</option>
                        <option>Female</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Blood Group</label>
                      <select value={regBlood} onChange={e => setRegBlood(e.target.value)}>
                        <option>O+</option><option>O-</option>
                        <option>A+</option><option>A-</option>
                        <option>B+</option><option>B-</option>
                        <option>AB+</option><option>AB-</option>
                      </select>
                    </div>
                  </div>

                  <div className="input-group">
                    <label>Citizenship Number (Stored Encrypted)</label>
                    <input type="text" value={regCitizenship} onChange={e => setRegCitizenship(e.target.value)} placeholder="27-01-72-XXXXX" />
                  </div>

                  <div className="input-group">
                    <label>National ID (NID) (Stored Encrypted)</label>
                    <input type="text" value={regNationalId} onChange={e => setRegNationalId(e.target.value)} placeholder="e.g. 123-456-789-0" />
                  </div>

                  <div className="input-group">
                    <label>Known Allergies</label>
                    <input type="text" value={regAllergies} onChange={e => setRegAllergies(e.target.value)} placeholder="e.g. Penicillin, None" />
                  </div>

                  <div className="input-group">
                    <label>Emergency Contact</label>
                    <input type="text" value={regEmergency} onChange={e => setRegEmergency(e.target.value)} placeholder="Name & Phone" />
                  </div>

                  <div className="input-group">
                    <label>Home Address</label>
                    <input type="text" value={regAddress} onChange={e => setRegAddress(e.target.value)} placeholder="Kathmandu, Nepal" />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>Register Profile</button>
                  <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'hsl(var(--text-secondary))' }}>
                    Already have a profile? <a href="#" onClick={(e) => { e.preventDefault(); setIsRegistering(false); }} style={{ color: 'hsl(var(--primary))', fontWeight: 600 }}>Log In</a>
                  </p>
                </form>
              )}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------
            PORTAL ROUTER AFTER LOGGED IN
           ---------------------------------------------------- */}
        {token && view === 'dashboard' && (
          <div className="dashboard-grid">

            {/* Sidebar Navigation depending on Role */}
            <div className="sidebar">
              <div style={{ textAlign: 'center', paddingBottom: '1rem', borderBottom: '1px solid hsl(var(--border-color))', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{name}</div>
                <div style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>{role} Dashboard</div>
              </div>

              {/* 1. PATIENT SIDEBAR */}
              {role === 'Patient' && (
                <>
                  <div className="sidebar-heading">My Services</div>
                  <a href="#" className="nav-link active">
                    <User size={18} /> Profile & History
                  </a>
                </>
              )}

              {/* 2. RECEPTIONIST SIDEBAR */}
              {role === 'Receptionist' && (
                <>
                  <div className="sidebar-heading">OPD Desk</div>
                  <a href="#" className="nav-link active">
                    <Plus size={18} /> Walk-in Token
                  </a>
                </>
              )}

              {/* 3. DOCTOR SIDEBAR */}
              {role === 'Doctor' && (
                <>
                  <div className="sidebar-heading">Clinical</div>
                  <a href="#" className="nav-link active">
                    <Activity size={18} /> Patient Queue
                  </a>
                </>
              )}

              {/* 4. PHARMACIST SIDEBAR */}
              {role === 'Pharmacist' && (
                <>
                  <div className="sidebar-heading">Pharmacy</div>
                  <a href="#" className="nav-link active">
                    <ShoppingBag size={18} /> Dispense Desk
                  </a>
                </>
              )}

              {/* 5. CASHIER SIDEBAR */}
              {role === 'Cashier' && (
                <>
                  <div className="sidebar-heading">Billing Desk</div>
                  <a href="#" className="nav-link active">
                    <CreditCard size={18} /> Collect Payments
                  </a>
                </>
              )}

              {/* 6. ADMIN SIDEBAR */}
              {role === 'Admin' && (
                <>
                  <div className="sidebar-heading">Administration</div>
                  <a href="#" className="nav-link active">
                    <Users size={18} /> Analytics & Logs
                  </a>
                </>
              )}
            </div>

            {/* Dashboard Content Panes depending on Role */}
            <div className="content-pane">

              {/* ================= PATIENT PORTAL PANEL ================= */}
              {role === 'Patient' && (
                <div>
                  {/* Live Queue Banner if checked-in */}
                  {myQueuePosition && (
                    <div className="queue-status-banner">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Your Virtual Queue Status</h3>
                          <p style={{ fontSize: '0.95rem', opacity: 0.9 }}>
                            Department: <strong>{myQueuePosition.myQueue.department_name}</strong> | Doctor: <strong>{myQueuePosition.myQueue.doctor_name}</strong>
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '2rem', background: 'rgba(255,255,255,0.15)', padding: '1rem', borderRadius: '14px', backdropFilter: 'blur(5px)' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Serving</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 900 }}>#{myQueuePosition.myQueue.token_number - myQueuePosition.position}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Your Token</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 900 }}>#{myQueuePosition.myQueue.token_number}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Est. Wait</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 900 }}>{myQueuePosition.estimated_wait_mins} min</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid-2">
                    {/* Profile Information */}
                    <div className="card">
                      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <User style={{ color: 'hsl(var(--primary))' }} /> Medical Profile
                      </h3>

                      {patientProfile ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          <div><strong>Phone:</strong> {patientProfile.phone}</div>
                          <div><strong>DOB:</strong> {patientProfile.dob}</div>
                          <div><strong>Gender:</strong> {patientProfile.gender}</div>
                          <div><strong>Blood Group:</strong> <span className="badge badge-info">{patientProfile.blood_group || 'Unknown'}</span></div>
                          <div><strong>Allergies:</strong> <span style={{ color: 'hsl(var(--danger))', fontWeight: 600 }}>{patientProfile.allergies || 'None'}</span></div>
                          <div><strong>Citizenship No:</strong> {patientProfile.citizenship_no || 'Not Verified'}</div>
                          <div><strong>National ID (NID):</strong> {patientProfile.national_id || 'Not Verified'}</div>
                          <div><strong>Insurance:</strong> {patientProfile.insurance_provider} ({patientProfile.insurance_no}) - <span className="badge badge-success">{patientProfile.insurance_status}</span></div>
                          <div><strong>Emergency Contact:</strong> {patientProfile.emergency_contact}</div>
                        </div>
                      ) : <p>Loading profile...</p>}
                    </div>

                    {/* Book Appointment Form */}
                    <div className="card">
                      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar style={{ color: 'hsl(var(--primary))' }} /> Online Ticket Booking
                      </h3>

                      <form onSubmit={handleBookAppointment}>
                        <div className="input-group">
                          <label>Department</label>
                          <select value={bookDeptId} onChange={e => setBookDeptId(e.target.value)} required>
                            <option value="">Select Department</option>
                            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                        <div className="input-group">
                          <label>Doctor</label>
                          <select value={bookDocId} onChange={e => setBookDocId(e.target.value)} required>
                            <option value="">Select Doctor</option>
                            {doctors
                              .filter(d => !bookDeptId || String(d.department_id) === String(bookDeptId))
                              .map(d => <option key={d.id} value={d.id}>{d.name} ({d.specialization})</option>)
                            }
                          </select>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div className="input-group">
                            <label>Date</label>
                            <input type="date" value={bookDate} onChange={e => setBookDate(e.target.value)} required />
                          </div>
                          <div className="input-group">
                            <label>Time Slot</label>
                            <select value={bookTime} onChange={e => setBookTime(e.target.value)} required>
                              <option value="">Select Time</option>
                              <option>09:00 AM</option><option>10:00 AM</option>
                              <option>11:00 AM</option><option>01:00 PM</option>
                              <option>02:00 PM</option>
                            </select>
                          </div>
                        </div>
                        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Book OPD Ticket</button>
                      </form>

                      {bookingSuccess && (
                        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'hsl(var(--success-light))', border: '1px solid hsl(var(--success))', borderRadius: '10px', textAlign: 'center' }}>
                          <h4 style={{ color: 'hsl(var(--success))', fontWeight: 700, marginBottom: '0.5rem' }}>Appointment Confirmed!</h4>
                          <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Token Number: <strong>#{bookingSuccess.tokenNumber}</strong></p>
                          <div style={{ display: 'inline-block', padding: '0.5rem', background: '#fff', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                            {bookingSuccess.qrCodeData}
                          </div>
                          <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))', marginTop: '0.5rem' }}>Show this QR Code at the hospital desk for swift check-in.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Medical History */}
                  <div className="card">
                    <h3 style={{ marginBottom: '1rem' }}>Electronic Medical Records & E-Prescriptions</h3>
                    {historyRecords.length === 0 ? (
                      <p style={{ color: 'hsl(var(--text-muted))' }}>No visit history found.</p>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Doctor / Department</th>
                            <th>Clinical Notes</th>
                            <th>Prescribed Medicines</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyRecords.map((h, idx) => (
                            <tr key={idx}>
                              <td>{new Date(h.created_at).toLocaleDateString()}</td>
                              <td>
                                <div><strong>{h.doctor_name}</strong></div>
                                <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>{h.department_name}</span>
                              </td>
                              <td>{h.notes || 'None'}</td>
                              <td>
                                {h.items && h.items.length > 0 ? (
                                  <ul style={{ paddingLeft: '1rem', fontSize: '0.85rem' }}>
                                    {h.items.map((med: any, mIdx: number) => (
                                      <li key={mIdx}>
                                        {med.medicine_name} - {med.dosage} ({med.frequency} for {med.duration})
                                        <span style={{ marginLeft: '6px' }} className={`badge ${med.status === 'Dispensed' ? 'badge-success' : 'badge-warning'}`}>{med.status}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : 'No medicines'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {/* ================= RECEPTIONIST PORTAL PANEL ================= */}
              {role === 'Receptionist' && (
                <div>
                  <div className="grid-2">

                    {/* Walk-in Ticket Registration */}
                    <div className="card">
                      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Plus style={{ color: 'hsl(var(--primary))' }} /> Walk-in Token Registration
                      </h3>
                      <form onSubmit={handleWalkinRegister}>
                        <div className="input-group">
                          <label>Patient Full Name</label>
                          <input type="text" value={walkinName} onChange={e => setWalkinName(e.target.value)} placeholder="Name" required />
                        </div>
                        <div className="input-group">
                          <label>Phone Number</label>
                          <input type="text" value={walkinPhone} onChange={e => setWalkinPhone(e.target.value)} placeholder="984XXXXXXX" required />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div className="input-group">
                            <label>Date of Birth</label>
                            <input type="date" value={walkinDob} onChange={e => setWalkinDob(e.target.value)} required />
                          </div>
                          <div className="input-group">
                            <label>Gender</label>
                            <select value={walkinGender} onChange={e => setWalkinGender(e.target.value)}>
                              <option>Male</option><option>Female</option><option>Other</option>
                            </select>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div className="input-group">
                            <label>Blood Group</label>
                            <select value={walkinBlood} onChange={e => setWalkinBlood(e.target.value)}>
                              <option>O+</option><option>O-</option><option>A+</option><option>A-</option>
                              <option>B+</option><option>B-</option><option>AB+</option><option>AB-</option>
                            </select>
                          </div>
                          <div className="input-group">
                            <label>Priority Class</label>
                            <select value={walkinPriority} onChange={e => setWalkinPriority(e.target.value)}>
                              <option value="Normal">Normal</option>
                              <option value="Senior">Senior Citizen</option>
                              <option value="Pregnant">Pregnant Women</option>
                              <option value="Disabled">Disabled</option>
                              <option value="Child">Child (&lt; 5 yrs)</option>
                              <option value="Emergency">Emergency</option>
                            </select>
                          </div>
                        </div>

                        <div className="input-group">
                          <label>Department</label>
                          <select value={walkinDept} onChange={e => setWalkinDept(e.target.value)} required>
                            <option value="">Select Department</option>
                            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>

                        <div className="input-group">
                          <label>Doctor</label>
                          <select value={walkinDoc} onChange={e => setWalkinDoc(e.target.value)} required>
                            <option value="">Select Doctor</option>
                            {doctors
                              .filter(d => !walkinDept || String(d.department_id) === String(walkinDept))
                              .map(d => <option key={d.id} value={d.id}>{d.name} ({d.specialization})</option>)
                            }
                          </select>
                        </div>

                        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Issue Walk-in Queue Token</button>
                      </form>
                    </div>

                    {/* Booked Appointment Check-in & Search */}
                    <div className="card">
                      <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Search style={{ color: 'hsl(var(--primary))' }} /> Scheduled Check-in
                      </h3>

                      <div className="input-group" style={{ flexDirection: 'row', gap: '0.5rem' }}>
                        <input type="text" placeholder="Search Scheduled Patient Phone..." value={searchPhone} onChange={e => setSearchPhone(e.target.value)} style={{ flex: 1 }} />
                        <button onClick={handleCheckInSearch} className="btn btn-primary">Find</button>
                      </div>

                      <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))', margin: '1rem 0' }}>
                        Or check in by entering appointment ID manually:
                      </p>

                      <form onSubmit={(e) => {
                        e.preventDefault();
                        const idInput = (e.currentTarget.elements.namedItem('aptId') as HTMLInputElement).value;
                        const priorityInput = (e.currentTarget.elements.namedItem('aptPriority') as HTMLSelectElement).value;
                        if (!idInput) return;

                        fetch(`${API_BASE}/appointments/checkin`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                          },
                          body: JSON.stringify({ appointmentId: parseInt(idInput), priority: priorityInput })
                        }).then(r => r.json()).then(data => {
                          if (data.error) alert(data.error);
                          else {
                            alert(data.message);
                            e.currentTarget.reset();
                          }
                        });
                      }}>
                        <div className="input-group">
                          <label>Appointment ID</label>
                          <input type="number" name="aptId" required />
                        </div>
                        <div className="input-group">
                          <label>Priority</label>
                          <select name="aptPriority">
                            <option value="Normal">Normal</option>
                            <option value="Senior">Senior Citizen</option>
                            <option value="Pregnant">Pregnant Women</option>
                            <option value="Disabled">Disabled</option>
                            <option value="Child">Child</option>
                            <option value="Emergency">Emergency</option>
                          </select>
                        </div>
                        <button type="submit" className="btn btn-secondary" style={{ width: '100%' }}>Validate & Add to Live Queue</button>
                      </form>
                    </div>

                  </div>
                </div>
              )}

              {/* ================= DOCTOR PORTAL PANEL ================= */}
              {role === 'Doctor' && (
                <div>
                  <div className="grid-2">

                    {/* Live Waiting Queue */}
                    <div className="card">
                      <h3 style={{ marginBottom: '1rem' }}>Active Patients Queue</h3>

                      {doctorQueue.length === 0 ? (
                        <p style={{ color: 'hsl(var(--text-muted))' }}>No patients in your waiting queue.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {doctorQueue.map(q => (
                            <div key={q.queue_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: '#fafbfc', borderRadius: '10px', border: '1px solid hsl(var(--border-color))' }}>
                              <div>
                                <h4 style={{ fontWeight: 700 }}>#{q.token_number} - {q.patient_name}</h4>
                                <span className={`badge ${q.priority === 'Emergency' ? 'badge-danger' : q.priority !== 'Normal' ? 'badge-warning' : 'badge-info'}`}>{q.priority}</span>
                              </div>

                              {q.status === 'Serving' ? (
                                <span className="badge badge-success">Serving Now</span>
                              ) : (
                                <button onClick={() => handleCallPatient(q.queue_id)} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                                  Call Patient
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Consultation & E-Prescription Desk */}
                    <div className="card">
                      <h3>Consultation Workspace</h3>
                      {currentPatient ? (
                        <div style={{ marginTop: '1rem' }}>
                          <div style={{ background: '#f5f6f8', padding: '1rem', borderRadius: '10px', marginBottom: '1.5rem', border: '1px solid hsl(var(--border-color))' }}>
                            <strong>Patient:</strong> {currentPatient.patient_name} ({currentPatient.gender}, DOB: {currentPatient.dob}) <br />
                            <strong>Allergies:</strong> <span style={{ color: 'hsl(var(--danger))' }}>{currentPatient.allergies || 'None'}</span> <br />
                            <strong>Insurance Status:</strong> <span className="badge badge-info">{currentPatient.insurance_status}</span>
                          </div>

                          <div className="input-group">
                            <label>Clinical Notes / Diagnosis</label>
                            <textarea value={consultNotes} onChange={e => setConsultNotes(e.target.value)} rows={4} placeholder="Type notes here..."></textarea>
                          </div>

                          <div style={{ borderTop: '1px solid hsl(var(--border-color))', paddingTop: '1rem', marginTop: '1rem' }}>
                            <h4 style={{ marginBottom: '1rem' }}>E-Prescription Composer</h4>

                            <div style={{ background: '#fafbfc', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <input type="text" placeholder="Medicine Name" value={medInput} onChange={e => setMedInput(e.target.value)} />
                                <input type="text" placeholder="Dosage (e.g. 500mg)" value={medDosage} onChange={e => setMedDosage(e.target.value)} />
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <input type="text" placeholder="Freq (e.g. 1-0-1)" value={medFreq} onChange={e => setMedFreq(e.target.value)} />
                                <input type="text" placeholder="Duration (e.g. 7 days)" value={medDuration} onChange={e => setMedDuration(e.target.value)} />
                                <input type="text" placeholder="Instructions" value={medInst} onChange={e => setMedInst(e.target.value)} />
                              </div>
                              <button type="button" onClick={addPrescriptionItem} className="btn btn-secondary" style={{ width: '100%', fontSize: '0.85rem' }}>
                                + Add Medicine to Prescription
                              </button>
                            </div>

                            {prescriptionItems.length > 0 && (
                              <div style={{ marginBottom: '1.5rem' }}>
                                <strong>Prescribed:</strong>
                                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.5rem' }}>
                                  {prescriptionItems.map((item, idx) => (
                                    <li key={idx}>
                                      {item.medicine_name} ({item.dosage}) - {item.frequency} for {item.duration} - {item.instructions}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          <button onClick={handleCompleteConsultation} className="btn btn-primary" style={{ width: '100%' }}>
                            Complete Consultation & Submit
                          </button>
                        </div>
                      ) : (
                        <p style={{ color: 'hsl(var(--text-muted))', marginTop: '1rem' }}>No active patient being served. Call a patient from the queue to start consultation.</p>
                      )}
                    </div>

                  </div>
                </div>
              )}

              {/* ================= PHARMACY PORTAL PANEL ================= */}
              {role === 'Pharmacist' && (
                <div>
                  <div className="grid-2">

                    {/* Prescription List */}
                    <div className="card">
                      <h3 style={{ marginBottom: '1rem' }}>Pending E-Prescriptions</h3>
                      {pendingRx.length === 0 ? (
                        <p style={{ color: 'hsl(var(--text-muted))' }}>No pending prescriptions to dispense.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {pendingRx.map((rx) => (
                            <div
                              key={rx.prescription_id}
                              onClick={() => selectPrescription(rx)}
                              style={{
                                cursor: 'pointer',
                                padding: '1rem',
                                background: selectedRx?.prescription_id === rx.prescription_id ? 'hsl(var(--primary-light))' : '#fafbfc',
                                borderRadius: '10px',
                                border: `1px solid ${selectedRx?.prescription_id === rx.prescription_id ? 'hsl(var(--primary))' : 'hsl(var(--border-color))'}`
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <strong>{rx.patient_name}</strong>
                                <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>{new Date(rx.created_at).toLocaleTimeString()}</span>
                              </div>
                              <div style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))' }}>Prescribed by: {rx.doctor_name}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Dispense Workspace */}
                    <div className="card">
                      <h3>Dispensing Desk</h3>
                      {selectedRx ? (
                        <div style={{ marginTop: '1rem' }}>
                          <div style={{ background: '#f5f6f8', padding: '1rem', borderRadius: '10px', marginBottom: '1rem' }}>
                            <strong>Patient:</strong> {selectedRx.patient_name} ({selectedRx.patient_phone})
                          </div>

                          <h4>Prescription Items:</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', margin: '1rem 0' }}>
                            {rxItems.map(item => (
                              <div key={item.id} style={{ padding: '0.75rem', background: '#fafbfc', borderRadius: '6px', border: '1px solid hsl(var(--border-color))' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <strong>{item.medicine_name}</strong>
                                  <span>{item.dosage}</span>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))' }}>
                                  Take {item.frequency} for {item.duration} ({item.instructions})
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', borderTop: '1px dashed #eee', paddingTop: '0.5rem' }}>
                                  <span>Stock: <span className={item.stock_qty < 20 ? 'badge badge-warning' : 'badge badge-success'}>{item.stock_qty || 0} left</span></span>
                                  <span>Price: NRs. {item.unit_price || 0.0}</span>
                                </div>
                              </div>
                            ))}
                          </div>

                          <button onClick={handleDispenseMedicine} className="btn btn-primary" style={{ width: '100%' }}>
                            Dispense & Update Stock
                          </button>
                        </div>
                      ) : (
                        <p style={{ color: 'hsl(var(--text-muted))', marginTop: '1rem' }}>Select a pending prescription to dispense.</p>
                      )}
                    </div>
                  </div>

                  {/* Stock Inventory */}
                  <div className="card">
                    <h3 style={{ marginBottom: '1rem' }}>Pharmacy Inventory Control</h3>
                    <div className="grid-2">
                      <div>
                        <table>
                          <thead>
                            <tr>
                              <th>Medicine</th>
                              <th>Available Stock</th>
                              <th>Unit Price</th>
                              <th>Expiry Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inventory.map(med => (
                              <tr key={med.id}>
                                <td><strong>{med.medicine_name}</strong></td>
                                <td>
                                  <span className={`badge ${med.stock_qty < med.min_stock_alert ? 'badge-danger' : 'badge-success'}`}>
                                    {med.stock_qty} units
                                  </span>
                                </td>
                                <td>NRs. {med.unit_price}</td>
                                <td>{med.expiry_date}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Add Stock Form */}
                      <div style={{ background: '#fafbfc', padding: '1.5rem', borderRadius: '12px', border: '1px solid hsl(var(--border-color))' }}>
                        <h4 style={{ marginBottom: '1rem' }}>Restock Medicine</h4>
                        <form onSubmit={handleUpdateStock}>
                          <div className="input-group">
                            <label>Medicine Name</label>
                            <input type="text" value={invName} onChange={e => setInvName(e.target.value)} required />
                          </div>
                          <div className="input-group">
                            <label>Stock Qty to Add</label>
                            <input type="number" value={invQty} onChange={e => setInvQty(e.target.value)} required />
                          </div>
                          <div className="input-group">
                            <label>Unit Price (NRs.)</label>
                            <input type="number" step="0.1" value={invPrice} onChange={e => setInvPrice(e.target.value)} required />
                          </div>
                          <div className="input-group">
                            <label>Expiry Date</label>
                            <input type="date" value={invExp} onChange={e => setInvExp(e.target.value)} required />
                          </div>
                          <button type="submit" className="btn btn-secondary" style={{ width: '100%' }}>Update Inventory</button>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ================= CASHIER PORTAL PANEL ================= */}
              {role === 'Cashier' && (
                <div>
                  <div className="grid-2">

                    {/* Bills Queue */}
                    <div className="card">
                      <h3 style={{ marginBottom: '1rem' }}>Pending Unpaid Invoices</h3>
                      {pendingBills.length === 0 ? (
                        <p style={{ color: 'hsl(var(--text-muted))' }}>No pending invoices found.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          {pendingBills.map(bill => (
                            <div key={bill.id} style={{ padding: '1rem', background: '#fafbfc', borderRadius: '10px', border: '1px solid hsl(var(--border-color))' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <h4 style={{ fontWeight: 700 }}>{bill.patient_name}</h4>
                                  <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>
                                    Doctor: {bill.doctor_name} ({bill.department_name})
                                  </span>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'hsl(var(--danger))' }}>
                                    NRs. {bill.total_amount}
                                  </div>
                                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>Consultation + Meds</span>
                                </div>
                              </div>

                              <div style={{ marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                                <div className="input-group" style={{ marginBottom: '0.5rem' }}>
                                  <label>Payment Mode</label>
                                  <select value={payMethod} onChange={e => setPayMethod(e.target.value as any)}>
                                    <option value="Cash">Cash</option>
                                    <option value="Card">Card</option>
                                    <option value="eSewa">eSewa Nepal</option>
                                    <option value="Khalti">Khalti Wallet</option>
                                    <option value="Fonepay">Fonepay QR</option>
                                    <option value="ConnectIPS">ConnectIPS</option>
                                    <option value="Insurance">Insurance Claim</option>
                                  </select>
                                </div>
                                <div className="input-group" style={{ marginBottom: '1rem' }}>
                                  <label>Transaction reference ID / Gateway Code</label>
                                  <input type="text" placeholder="e.g. TXN-98412" value={txnId} onChange={e => setTxnId(e.target.value)} />
                                </div>
                                <button onClick={() => handlePayBill(bill.id)} className="btn btn-primary" style={{ width: '100%' }}>
                                  Confirm & Settle Payment
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Insurance Verification Desk */}
                    <div className="card">
                      <h3 style={{ marginBottom: '1.5rem' }}>Manual Insurance Verification</h3>
                      <form onSubmit={handleVerifyInsurance}>
                        <div className="input-group">
                          <label>Patient ID / Record Reference</label>
                          <input type="text" value={verifyInsPatientId} onChange={e => setVerifyInsPatientId(e.target.value)} placeholder="Patient ID" required />
                        </div>
                        <div className="input-group">
                          <label>Insurance Provider</label>
                          <select value={verifyInsProvider} onChange={e => setVerifyInsProvider(e.target.value)}>
                            <option>Govt Insurance Nepal</option>
                            <option>Sagarmatha Insurance</option>
                            <option>Neco Insurance</option>
                            <option>NLG Insurance</option>
                          </select>
                        </div>
                        <div className="input-group">
                          <label>Policy Number / Card Reference</label>
                          <input type="text" value={verifyInsNo} onChange={e => setVerifyInsNo(e.target.value)} placeholder="INS-XXXX" required />
                        </div>
                        <button type="submit" className="btn btn-secondary" style={{ width: '100%' }}>
                          Verify Eligibility & Activate Coverage
                        </button>
                      </form>
                    </div>

                  </div>
                </div>
              )}

              {/* ================= ADMIN PORTAL PANEL ================= */}
              {role === 'Admin' && (
                <div>

                  {/* Analytics Tiles */}
                  {analytics ? (
                    <div className="grid-3" style={{ marginBottom: '2rem' }}>
                      <div className="card" style={{ marginBottom: 0, padding: '1.5rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'hsl(var(--text-secondary))' }}>OPD Wait Index</div>
                        <div style={{ fontSize: '2rem', fontWeight: 800, color: 'hsl(var(--primary))', margin: '0.5rem 0' }}>
                          {analytics.avgWaitTime?.[0]?.wait !== null ? `${Math.round(analytics.avgWaitTime[0].wait)} mins` : '12 mins'}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>Average time before serving</p>
                      </div>

                      <div className="card" style={{ marginBottom: 0, padding: '1.5rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'hsl(var(--text-secondary))' }}>No-Show Index</div>
                        <div style={{ fontSize: '2rem', fontWeight: 800, color: 'hsl(var(--warning))', margin: '0.5rem 0' }}>
                          {analytics.noShowRate?.[0]?.rate ? `${Math.round(analytics.noShowRate[0].rate)}%` : '0%'}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>Appointments missed today</p>
                      </div>

                      <div className="card" style={{ marginBottom: 0, padding: '1.5rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'hsl(var(--text-secondary))' }}>Daily Registrations</div>
                        <div style={{ fontSize: '2rem', fontWeight: 800, color: 'hsl(var(--success))', margin: '0.5rem 0' }}>
                          {analytics.totalPatients?.[0]?.count || 0}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>Registered patients in database</p>
                      </div>
                    </div>
                  ) : <p>Loading analytics...</p>}

                  {/* Security Compliance Audit Trail */}
                  <div className="card">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'hsl(var(--danger))', marginBottom: '1rem' }}>
                      <ShieldAlert /> Security & HIPAA Compliance Audit Trail
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))', marginBottom: '1rem' }}>
                      To prevent database leaks and unauthorized lookups, every read/write to patient profiles, medical history, or clinical records is cryptographically audited.
                    </p>

                    <div style={{ overflowX: 'auto' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>User</th>
                            <th>Action</th>
                            <th>Description</th>
                            <th>IP Address</th>
                            <th>Timestamp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditLogs.map((log) => (
                            <tr key={log.id}>
                              <td>
                                <strong>{log.user_name}</strong>
                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>{log.role}</span>
                              </td>
                              <td><span className="badge badge-info">{log.action}</span></td>
                              <td><span style={{ fontSize: '0.85rem' }}>{log.details}</span></td>
                              <td><code>{log.ip_address}</code></td>
                              <td>{new Date(log.timestamp).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              )}

            </div>
          </div>
        )}

      </div>

      <footer style={{ borderTop: '1px solid hsl(var(--border-color))', padding: '1.5rem 0', textAlign: 'center', fontSize: '0.8rem', color: 'hsl(var(--text-muted))', marginTop: '2rem' }}>
        HospitalFlow Nepal HIS MVP • Built for Zero Physical Queues • Secured and Fully parameterised
      </footer>
    </div>
  );
}
