SELECT s AS subject_person_id, r AS object_person_id,
       count(*) AS n,
       count(*) FILTER (WHERE ts < %(split)s) AS n_before
FROM scratch_kv.msg
GROUP BY s, r
