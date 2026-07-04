CREATE OR REPLACE FUNCTION uuid_or_null(str text)
  RETURNS uuid
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
    SELECT CASE
        WHEN str ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN str::uuid
    END
$$;
