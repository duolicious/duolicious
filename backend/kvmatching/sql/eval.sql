SELECT
    p.id,
    p.activated,
    p.shadow_banned_at IS NOT NULL AS shadow_banned,
    'bot' = ANY(p.roles) AS is_bot,
    p.last_online_time,
    p.personality::REAL[] AS personality
FROM person p
ORDER BY p.id
