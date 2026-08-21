from serviceshared.commonsql import Q_IS_REGISTERED_BY_NORMALIZED_EMAIL

Q_EMAIL_INFO = f"""
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM person WHERE email = %(email)s)
        THEN 'registered'

        WHEN EXISTS (SELECT 1 FROM good_email_domain WHERE domain = %(domain)s)
        THEN 'unregistered-good'

        WHEN EXISTS (SELECT 1 FROM bad_email_domain  WHERE domain = %(domain)s)
        THEN 'unregistered-bad'

        ELSE 'unregistered-unknown'
    END AS domain_status,

    {Q_IS_REGISTERED_BY_NORMALIZED_EMAIL} AS registered
"""
