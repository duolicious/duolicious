-- Must run outside a transaction block, or in its own transaction: the new
-- value can't be used by later statements in the same transaction.
ALTER TYPE person_event ADD VALUE IF NOT EXISTS 'joined-club' AFTER 'joined';
