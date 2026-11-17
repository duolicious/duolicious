from serviceshared.database import api_tx
import service.api.duotypes as t

Q_UPSERT_WEB_VISITOR = """
WITH existing AS (
    SELECT id FROM web_visitor WHERE id = %(web_visitor_id)s
), created AS (
    INSERT INTO web_visitor (ref, network)
    SELECT
        %(ref)s,
        network(set_masklen(
            %(ip_address)s::inet,
            CASE family(%(ip_address)s::inet) WHEN 4 THEN 24 ELSE 48 END
        ))
    WHERE NOT EXISTS (SELECT 1 FROM existing)
    RETURNING id
), visitor AS (
    SELECT id FROM existing
    UNION ALL
    SELECT id FROM created
), assigned AS (
    INSERT INTO web_visitor_variant (web_visitor_id, experiment_name, variant)
    SELECT
        visitor.id,
        experiment.name,
        experiment.variants[1 + floor(random() * cardinality(experiment.variants))::int]
    FROM visitor, experiment
    WHERE experiment.ended_at IS NULL
    ON CONFLICT DO NOTHING
    RETURNING experiment_name, variant
), variant AS (
    SELECT experiment_name, variant FROM assigned
    UNION ALL
    SELECT web_visitor_variant.experiment_name, web_visitor_variant.variant
    FROM existing
    JOIN web_visitor_variant ON web_visitor_variant.web_visitor_id = existing.id
    JOIN experiment ON experiment.name = web_visitor_variant.experiment_name
    WHERE experiment.ended_at IS NULL
)
SELECT
    (SELECT id::text FROM visitor) AS web_visitor_id,
    COALESCE(
        (SELECT jsonb_object_agg(experiment_name, variant) FROM variant),
        '{}'
    ) AS variants
"""


async def post_web_visitor(
    req: t.PostWebVisitor,
    remote_addr: str | None,
) -> object:
    async with api_tx('READ COMMITTED') as tx:
        return await tx.require_one(Q_UPSERT_WEB_VISITOR, dict(
            web_visitor_id=req.web_visitor_id,
            ref=req.ref,
            ip_address=remote_addr,
        ))
