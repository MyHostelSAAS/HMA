const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

// Email Transporter (Gmail Setup)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Admin, Owner, Warden Login
router.post('/login', async (req, res) => {
  const { email, password, role } = req.body;
  console.log(`--- LOGIN ATTEMPT --- Email: ${email}, Role: ${role}`);
  let table = '';

  if (role === 'admin') table = 'admins';
  else if (role === 'owner') table = 'owners';
  else if (role === 'warden') table = 'wardens';
  else {
    console.log(`--- LOGIN FAILED --- Invalid role: ${role}`);
    return res.status(400).json({ error: 'Invalid role specified.' });
  }

  try {
    const result = await db.query(`SELECT * FROM ${table} WHERE email = $1`, [email]);
    console.log(`--- DB QUERY --- Table: ${table}, Found: ${result.rows.length > 0}`);
    
    if (result.rows.length === 0) {
      console.log(`--- LOGIN FAILED --- User not found in ${table}`);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    console.log(`--- AUTH DEBUG --- Input: ${password}, DB Hash: ${user.password}`);
    const isMatch = await bcrypt.compare(password, user.password);
    console.log(`--- BCRYPT CHECK --- Match: ${isMatch}`);
    
    if (!isMatch) {
      console.log(`--- LOGIN FAILED --- Password mismatch for ${email}`);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const payload = { id: user.admin_id || user.owner_id || user.warden_id, role: role, name: user.name };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'secret_key', { expiresIn: '1d' });

    console.log(`--- LOGIN SUCCESS --- User: ${user.name}, Role: ${role}`);
    res.json({ token, user: payload });
  } catch (err) {
    console.error(`--- LOGIN ERROR ---`, err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Forgot Password Endpoint
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  console.log(`--- FORGOT PASSWORD ATTEMPT --- Email: ${email}`);

  try {
    // Check in all tables
    let user = null;
    let table = '';
    
    const adminCheck = await db.query('SELECT * FROM admins WHERE email = $1', [email]);
    if (adminCheck.rows.length > 0) {
      user = adminCheck.rows[0];
      table = 'admins';
    } else {
      const ownerCheck = await db.query('SELECT * FROM owners WHERE email = $1', [email]);
      if (ownerCheck.rows.length > 0) {
        user = ownerCheck.rows[0];
        table = 'owners';
      } else {
        const wardenCheck = await db.query('SELECT * FROM wardens WHERE email = $1', [email]);
        if (wardenCheck.rows.length > 0) {
          user = wardenCheck.rows[0];
          table = 'wardens';
        }
      }
    }

    if (!user) {
      console.log(`--- FORGOT PWD FAILED --- Email not registered: ${email}`);
      return res.status(404).json({ error: 'This email is not registered in the portal. Please contact admin.' });
    }

    // Generate Token and Expiry
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Save to Database
    await db.query(`UPDATE ${table} SET reset_token = $1, reset_expiry = $2 WHERE email = $3`, [token, expiry, email]);

    // Send Email
    try {
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}&email=${email}`;
      
      const mailOptions = {
        from: `"My Hostel" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Reset Request - My Hostel',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #2563eb;">My Hostel Portal</h2>
            <p>Hello,</p>
            <p>You requested to reset your password. Please click the button below to continue. This link will expire in 15 minutes.</p>
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      console.log(`--- RESET EMAIL SENT --- User: ${user.name}, Email: ${email}`);
      res.json({ message: 'Password reset link sent to your email.' });
    } catch (mailErr) {
      console.error(`--- EMAIL SENDING FAILED ---`, mailErr);
      
      // FALLBACK: Log the link to the console so the admin/user can still recover during development
      const fallbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}&email=${email}`;
      console.log(`\n!!! FALLBACK RESET LINK (EMAIL FAILED) !!!\nURL: ${fallbackUrl}\n`);
      
      res.status(500).json({ 
        error: 'Email service is currently unavailable. Please contact admin with your email address for a manual reset link.',
        dev_note: 'Admin can find the reset link in the server logs.'
      });
    }

  } catch (err) {
    console.error(`--- FORGOT PWD ERROR ---`, err);
    res.status(500).json({ error: 'Server error. Could not send email.' });
  }
});

// Reset Password Endpoint
router.post('/reset-password', async (req, res) => {
  const { token, email, password } = req.body;
  console.log(`--- RESET PASSWORD ATTEMPT --- Email: ${email}`);

  try {
    // Check all tables for the token
    let table = '';
    let user = null;

    const adminCheck = await db.query('SELECT * FROM admins WHERE email = $1 AND reset_token = $2 AND reset_expiry > NOW()', [email, token]);
    if (adminCheck.rows.length > 0) {
      user = adminCheck.rows[0];
      table = 'admins';
    } else {
      const ownerCheck = await db.query('SELECT * FROM owners WHERE email = $1 AND reset_token = $2 AND reset_expiry > NOW()', [email, token]);
      if (ownerCheck.rows.length > 0) {
        user = ownerCheck.rows[0];
        table = 'owners';
      } else {
        const wardenCheck = await db.query('SELECT * FROM wardens WHERE email = $1 AND reset_token = $2 AND reset_expiry > NOW()', [email, token]);
        if (wardenCheck.rows.length > 0) {
          user = wardenCheck.rows[0];
          table = 'wardens';
        }
      }
    }

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }

    // Hash New Password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Update Password and Clear Token
    await db.query(`UPDATE ${table} SET password = $1, reset_token = NULL, reset_expiry = NULL WHERE email = $2`, [hashedPassword, email]);

    console.log(`--- PASSWORD RESET SUCCESSFUL --- User: ${user.name}`);
    res.json({ message: 'Password reset successful! You can now login with your new password.' });

  } catch (err) {
    console.error(`--- RESET PWD ERROR ---`, err);
    res.status(500).json({ error: 'Server error. Could not reset password.' });
  }
});

// Admin Registration (Initial setup or through other admin)
router.post('/register/admin', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const result = await db.query(
      'INSERT INTO admins (name, email, password) VALUES ($1, $2, $3) RETURNING admin_id, name, email',
      [name, email, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
