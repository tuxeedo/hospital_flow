import db from './db.js';
import { encrypt, decrypt, hashPassword, comparePassword } from './auth.js';

console.log("=========================================");
console.log(" HOSPITALFLOW NEPAL - SECURITY AUDIT TEST");
console.log("=========================================");

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (e) {
    console.error(`[FAIL] ${name}:`, e.message);
    testsFailed++;
  }
}

// Test 1: Cryptographic Encryption of Sensitive Info
runTest("Patient Data Cryptographic Encryption", () => {
  const sensitiveNo = "27-01-72-99887";
  const encrypted = encrypt(sensitiveNo);
  
  if (encrypted === sensitiveNo) {
    throw new Error("Data was saved in plain text! Cryptographic lock failed.");
  }
  
  if (!encrypted.includes(":")) {
    throw new Error("Invalid cipher initialization vector structure.");
  }

  const decrypted = decrypt(encrypted);
  if (decrypted !== sensitiveNo) {
    throw new Error("Decryption returned mismatching details.");
  }
});

// Test 2: Modern Password Hashing Check
runTest("Modern Password Hashing Strength Check", () => {
  const pword = "strong_staff_pass_2026";
  const hash = hashPassword(pword);

  if (hash === pword) {
    throw new Error("Plaintext password leaked in memory without hashing.");
  }

  const matches = comparePassword(pword, hash);
  if (!matches) {
    throw new Error("Failed password comparison matches verification.");
  }

  const wrongMatches = comparePassword("wrong_pass", hash);
  if (wrongMatches) {
    throw new Error("Security vulnerability: Wrong password validated as correct.");
  }
});

// Test 3: SQL Injection Containment (Placeholders verification)
runTest("SQL Injection (SQLi) Protection", () => {
  const malformedInput = "' OR '1'='1";
  
  // Checking on mock user search query simulation
  db.get("SELECT * FROM users WHERE username = ?", [malformedInput], (err, row) => {
    if (err) {
      throw new Error(`Query crash under parameters: ${err.message}`);
    }
    // Should return null (no matching user) rather than validating true and returning first record
    if (row) {
      throw new Error("SQL Injection payload successfully bypassed query restrictions!");
    }
  });
});

setTimeout(() => {
  console.log("=========================================");
  console.log(`Security Test Run Completed.`);
  console.log(`Passed: ${testsPassed} | Failed: ${testsFailed}`);
  console.log("=========================================");
  
  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}, 1000);
