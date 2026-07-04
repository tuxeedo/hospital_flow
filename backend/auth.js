import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'hospitalflow_super_secret_key_nepal_2026';

export function validatePassword(password) {
  // At least 8 chars, 1 uppercase letter, 1 number, 1 special char
  const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return regex.test(password);
}

export function validatePhone(phone) {
  // Starts with +977 followed by exactly 10 digits
  const regex = /^\+977\d{10}$/;
  return regex.test(phone);
}

export function validateCitizenship(id) {
  // Standard citizenship format contains numbers and hyphens/slashes
  if (!id) return false;
  const regex = /^\d+([-/\s]\d+)+$/;
  return regex.test(id) && id.length >= 6 && id.length <= 25;
}

export function validateNID(id) {
  // NID is 10 digits, optional hyphens
  if (!id) return false;
  const clean = id.replace(/[-/\s]/g, '');
  const regex = /^\d{10}$/;
  return regex.test(clean);
}

// Cryptographic configuration for sensitive patient details
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = crypto.scryptSync('nepal_hospital_secret_key_2026', 'nepal_salt', 32);
const IV_LENGTH = 16;

export function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text) {
  if (!text) return null;
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return '[Decryption Error]';
  }
}

export function hashPassword(password) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

export function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// Authentication Middleware
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}


// Role Validation Middleware (RBAC)
export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      auditLog(
        req.user.id || 'anonymous',
        'UNAUTHORIZED_ACCESS_ATTEMPT',
        `User attempted to access route restricted to: ${allowedRoles.join(', ')}`,
        req
      );
      return res.status(403).json({ error: 'Permission denied for this role' });
    }
    next();
  };
}

// Security Audit Logger
export function auditLog(userId, action, details, req) {
  const ipAddress = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : 'system';
  
  db.run(
    "INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)",
    [String(userId), action, details, ipAddress],
    (err) => {
      if (err) {
        console.error("Audit logging error:", err);
      }
    }
  );
}
