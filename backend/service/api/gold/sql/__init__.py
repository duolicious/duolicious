Q_SELECT_REVENUECAT_AUTHORIZED = """
SELECT
    1
FROM
    funding
WHERE
    token_hash_revenuecat = %(token_hash_revenuecat)s
"""

Q_LIVE_PAYPAL_SUBSCRIPTION_IDS = """
SELECT
    provider_subscription_id
FROM
    gold_subscription
WHERE
    person_id = ANY(%(person_ids)s)
AND
    provider = 'paypal'
AND
    expires_at = 'infinity'
"""
