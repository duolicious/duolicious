WITH counted AS (
    SELECT
        web_visitor_variant.experiment_name,
        web_visitor_variant.variant,
        count(*) AS visitors,
        count(DISTINCT (web_visitor.network, web_visitor_variant.assigned_at::date))
            AS distinct_networks_per_day,
        count(web_visitor_sign_up.web_visitor_id) AS sign_ups
    FROM
        web_visitor_variant
    JOIN
        web_visitor
    ON
        web_visitor.id = web_visitor_variant.web_visitor_id
    LEFT JOIN
        web_visitor_sign_up
    ON
        web_visitor_sign_up.web_visitor_id = web_visitor_variant.web_visitor_id
    AND
        web_visitor_sign_up.signed_up_at >= web_visitor_variant.assigned_at
    AND
        web_visitor_sign_up.signed_up_at < web_visitor_variant.assigned_at + INTERVAL '7 days'
    WHERE
        web_visitor_variant.assigned_at < NOW() - INTERVAL '7 days'
    GROUP BY
        web_visitor_variant.experiment_name,
        web_visitor_variant.variant
), rated AS (
    SELECT
        *,
        sign_ups::float8 / visitors AS rate
    FROM
        counted
), compared AS (
    SELECT
        experiment.started_at,
        array_position(experiment.variants, rated.variant) AS variant_position,
        rated.*,
        rated.rate - control.rate AS difference,
        1.96 * sqrt(
            rated.rate * (1 - rated.rate) / rated.visitors +
            control.rate * (1 - control.rate) / control.visitors
        ) AS margin
    FROM
        rated
    JOIN
        experiment
    ON
        experiment.name = rated.experiment_name
    LEFT JOIN
        rated AS control
    ON
        control.experiment_name = rated.experiment_name
    AND
        control.variant = experiment.variants[1]
)
SELECT
    experiment_name AS experiment,
    variant,
    visitors,
    distinct_networks_per_day,
    sign_ups,
    round((100 * rate)::numeric, 2) AS sign_up_percent,
    round((100 * difference)::numeric, 2) AS points_above_control,
    round((100 * (difference - margin))::numeric, 2) AS points_above_control_low,
    round((100 * (difference + margin))::numeric, 2) AS points_above_control_high
FROM
    compared
ORDER BY
    started_at DESC,
    experiment_name,
    variant_position
