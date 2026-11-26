-- C3: Database security.
-- This wrapper initializes both dedicated database accounts.
-- Required sqlcmd variables: ApiPass and SparkPass.
--
-- For independent initialization, use:
--   security_api.sql   with ApiPass
--   security_spark.sql with SparkPass
--
-- Run this wrapper from the database directory.

:ON ERROR EXIT

:r security_api.sql
:r security_spark.sql
