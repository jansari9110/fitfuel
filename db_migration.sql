-- Run this in your MySQL client after connecting to the `fitfuel` database
-- mysql -u root -p fitfuel < db_migration.sql

USE fitfuel;

-- Create subscriptions table (server.js also auto-creates this, but run manually to be safe)
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  user_id               INT NOT NULL,
  plan                  VARCHAR(20) NOT NULL DEFAULT 'basic',
  razorpay_order_id     VARCHAR(100),
  razorpay_payment_id   VARCHAR(100),
  status                ENUM('pending', 'active', 'expired') DEFAULT 'pending',
  starts_at             DATETIME,
  expires_at            DATETIME,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Optional: give all existing users a Basic plan if they don't have one
INSERT INTO subscriptions (user_id, plan, status, starts_at, expires_at)
SELECT id, 'basic', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 36500 DAY)
FROM users
WHERE id NOT IN (SELECT user_id FROM subscriptions WHERE status = 'active');
