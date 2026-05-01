CREATE TABLE IF NOT EXISTS loyalty_rewards (
    id SERIAL PRIMARY KEY,
    reward_code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    points_cost INT NOT NULL,
    benefit_type VARCHAR(64) NOT NULL,
    benefit_value VARCHAR(255),
    tier_required VARCHAR(32) NOT NULL DEFAULT 'bronze',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
    id SERIAL PRIMARY KEY,
    loyalty_account_id INT NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
    reward_id INT NOT NULL REFERENCES loyalty_rewards(id),
    points_spent INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    redemption_code VARCHAR(64) NOT NULL UNIQUE,
    benefit_details TEXT,
    redeemed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP
);

ALTER TABLE loyalty_accounts
ALTER COLUMN tier SET DEFAULT 'bronze';

UPDATE loyalty_accounts
SET tier = 'bronze'
WHERE COALESCE(NULLIF(TRIM(tier), ''), 'bronze') NOT IN ('bronze', 'silver', 'gold');

INSERT INTO loyalty_rewards (reward_code, name, description, points_cost, benefit_type, benefit_value, tier_required)
VALUES
    ('voucher_10', 'GBP10 Discount Voucher', 'Take GBP10 off a future booking.', 500, 'voucher', '10', 'bronze'),
    ('extra_bag', 'Free Extra Luggage', 'Add one complimentary checked bag to a future trip.', 800, 'baggage', '1 extra bag', 'bronze'),
    ('voucher_25', 'GBP25 Discount Voucher', 'Take GBP25 off a future booking.', 1200, 'voucher', '25', 'silver'),
    ('seat_upgrade', 'Cabin Upgrade', 'Upgrade one future segment to the next cabin where available.', 1500, 'upgrade', 'single segment', 'silver'),
    ('lounge_pass', 'Airport Lounge Pass', 'Enjoy one airport lounge visit before departure.', 2000, 'lounge', 'single use', 'gold')
ON CONFLICT (reward_code) DO NOTHING;
