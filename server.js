const express = require('express');
const mysql   = require('mysql2');
const bcrypt  = require('bcrypt');
const cors    = require('cors');
const crypto  = require('crypto');
const Razorpay = require('razorpay');
 
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
 
/* ── DATABASE ────────────────────────────────────────────────── */
const db = mysql.createConnection({
  host:     'localhost',
  user:     'root',
  password: 'your_new_password',       // your MySQL password
  database: 'fitfuel'
});
db.connect(err => {
  if (err) { console.error('MySQL Error:', err); return; }
  console.log('MySQL Connected');
});
 
/* ── RAZORPAY  (paste your keys from razorpay.com dashboard) ── */
const razorpay = new Razorpay({
  key_id:     'rzp_test_SjW7tGNsR0LYU8',   // ← Replace
  key_secret: '4wh7465niO9d4o0fLZV0WMAw'     // ← Replace
});
 
/* ── PLAN CONFIG ─────────────────────────────────────────────── */
const PLANS = {
  basic: { name:'Basic Plan',  amount:0,      days:36500 },
  pro:   { name:'Pro Plan',    amount:99900,  days:30    },  // ₹999
  elite: { name:'Elite Plan',  amount:249900, days:30    }   // ₹2499
};
 
/* ── AUTO CREATE TABLES ──────────────────────────────────────── */
db.query(`CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(100) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
 
db.query(`CREATE TABLE IF NOT EXISTS profiles (
  user_id  INT PRIMARY KEY,
  age      INT, height FLOAT, weight FLOAT,
  gender   VARCHAR(10), activity VARCHAR(20), goal VARCHAR(20),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`);
 
db.query(`CREATE TABLE IF NOT EXISTS subscriptions (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  user_id             INT NOT NULL,
  plan                VARCHAR(20) NOT NULL DEFAULT 'basic',
  razorpay_order_id   VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  status              ENUM('pending','active','expired') DEFAULT 'pending',
  starts_at           DATETIME,
  expires_at          DATETIME,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`, err => { if(!err) console.log('All tables ready'); });
 
/* ── REGISTER ────────────────────────────────────────────────── */
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.json({ error: 'All fields are required' });
 
  try {
    const hash = await bcrypt.hash(password, 10);
    db.query(
      'INSERT INTO users(name,email,password) VALUES(?,?,?)',
      [name, email, hash],
      (err, result) => {
        if (err) return res.json({ error: 'Email already registered' });
 
        // Give new user a free Basic plan
        db.query(
          `INSERT INTO subscriptions(user_id,plan,status,starts_at,expires_at)
           VALUES(?,'basic','active',NOW(),DATE_ADD(NOW(),INTERVAL 36500 DAY))`,
          [result.insertId]
        );
        res.json({ success: true });
      }
    );
  } catch(e) {
    res.json({ error: 'Server error' });
  }
});
 
/* ── LOGIN ───────────────────────────────────────────────────── */
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.json({ error: 'Email and password required' });
 
  db.query('SELECT * FROM users WHERE email=?', [email], async (err, rows) => {
    if (err || !rows.length) return res.json({ error: 'User not found' });
 
    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok) return res.json({ error: 'Wrong password' });
 
    res.json({ userId: rows[0].id, name: rows[0].name, email: rows[0].email });
  });
});
 
/* ── SAVE PROFILE ────────────────────────────────────────────── */
app.post('/profile', (req, res) => {
  const { userId, age, height, weight, gender, activity, goal } = req.body;
  db.query('DELETE FROM profiles WHERE user_id=?', [userId], () => {
    db.query(
      'INSERT INTO profiles VALUES(?,?,?,?,?,?,?)',
      [userId, age, height, weight, gender, activity, goal],
      () => res.json({ success: true })
    );
  });
});
 
/* ── DIET CALCULATION ────────────────────────────────────────── */
app.post('/diet', (req, res) => {
  const { age, height, weight, gender, activity, goal } = req.body;
  let bmr = gender === 'male'
    ? 10*weight + 6.25*height - 5*age + 5
    : 10*weight + 6.25*height - 5*age - 161;
 
  const act = { low:1.2, medium:1.55, high:1.9 };
  let calories = bmr * (act[activity] || 1.2);
  if (goal === 'bulk') calories += 300;
  if (goal === 'cut')  calories -= 300;
 
  res.json({
    calories: Math.round(calories),
    protein:  Math.round(weight * 2),
    carbs:    Math.round(calories * 0.5 / 4),
    fats:     Math.round(calories * 0.25 / 9)
  });
});
 
/* ── GET MY PLAN ─────────────────────────────────────────────── */
app.get('/my-plan', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ plan:'basic', status:'active' });
 
  db.query(
    `SELECT plan, status, starts_at, expires_at
     FROM subscriptions WHERE user_id=? AND status='active'
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
    (err, rows) => {
      if (err || !rows.length) return res.json({ plan:'basic', status:'active' });
      const sub = rows[0];
      if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
        db.query("UPDATE subscriptions SET status='expired' WHERE user_id=?", [userId]);
        return res.json({ plan:'basic', status:'active' });
      }
      res.json(sub);
    }
  );
});
 
/* ── CREATE RAZORPAY ORDER ───────────────────────────────────── */
app.post('/create-order', async (req, res) => {
  const { userId, plan } = req.body;
  if (!PLANS[plan]) return res.json({ error:'Invalid plan' });
  if (!userId)      return res.json({ error:'Please login first' });
 
  const planInfo = PLANS[plan];
 
  // Basic plan is free
  if (planInfo.amount === 0) {
    db.query("UPDATE subscriptions SET status='expired' WHERE user_id=?", [userId], () => {
      db.query(
        `INSERT INTO subscriptions(user_id,plan,status,starts_at,expires_at)
         VALUES(?,'basic','active',NOW(),DATE_ADD(NOW(),INTERVAL 36500 DAY))`,
        [userId],
        () => res.json({ success:true, free:true })
      );
    });
    return;
  }
 
  try {
    const order = await razorpay.orders.create({
      amount:   planInfo.amount,
      currency: 'INR',
      receipt:  `fitfuel_${userId}_${Date.now()}`,
      notes:    { userId: String(userId), plan }
    });
 
    db.query(
      `INSERT INTO subscriptions(user_id,plan,razorpay_order_id,status)
       VALUES(?,?,?,'pending')`,
      [userId, plan, order.id]
    );
 
    res.json({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      planName: planInfo.name,
      key_id:   razorpay.key_id
    });
  } catch(e) {
    console.error('Razorpay error:', e.message);
    res.json({ error:'Could not create order. Check Razorpay keys in server.js' });
  }
});
 
/* ── VERIFY PAYMENT & ACTIVATE ───────────────────────────────── */
app.post('/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, plan } = req.body;
 
  const expected = crypto
    .createHmac('sha256', razorpay.key_secret)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
 
  if (expected !== razorpay_signature)
    return res.json({ error:'Payment verification failed' });
 
  const planInfo = PLANS[plan];
 
  db.query("UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'", [userId], () => {
    db.query(
      `UPDATE subscriptions
       SET status='active', razorpay_payment_id=?,
           starts_at=NOW(), expires_at=DATE_ADD(NOW(), INTERVAL ? DAY)
       WHERE razorpay_order_id=?`,
      [razorpay_payment_id, planInfo.days, razorpay_order_id],
      err => {
        if (err) return res.json({ error:'DB update failed' });
        res.json({ success:true, plan, planName:planInfo.name });
      }
    );
  });
});
 
app.listen(3000, () => console.log('Server running on http://localhost:3000'));
 
