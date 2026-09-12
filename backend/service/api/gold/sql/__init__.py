Q_SELECT_REVENUECAT_AUTHORIZED = """
SELECT
    1
FROM
    funding
WHERE
    token_hash_revenuecat = %(token_hash_revenuecat)s
"""
