-- Shim mínimo de Supabase para probar la RLS en un Postgres vanilla (solo tests).
-- Reproduce los roles, auth.uid()/auth.role() leídos de request.jwt.claims,
-- el esquema storage y los privilegios por defecto que Supabase da en public.
-- Las extensiones que solo existen en Supabase (pg_net, pg_cron, supabase_vault,
-- pgmq) las neutraliza harness.ts al aplicar las migraciones.
-- Los roles son del clúster, no de la base: en un Postgres recién creado varios
-- archivos de test los crean a la vez, y el que llega segundo recibe
-- unique_violation (o duplicate_object). Se ignora: el rol ya existe.
DO $$
DECLARE
  _rol record;
BEGIN
  FOR _rol IN SELECT * FROM (VALUES
    ('anon', 'NOLOGIN NOINHERIT'),
    ('authenticated', 'NOLOGIN NOINHERIT'),
    ('service_role', 'NOLOGIN NOINHERIT BYPASSRLS')
  ) AS r(nombre, opciones) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = _rol.nombre) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I %s', _rol.nombre, _rol.opciones);
      EXCEPTION WHEN unique_violation OR duplicate_object THEN
        NULL;
      END;
    END IF;
  END LOOP;
END $$;
GRANT anon, authenticated, service_role TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = public, extensions', current_database());
END $$;
SET search_path = public, extensions;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_type text NOT NULL DEFAULT 'totp',
  status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.role', true),
         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid, created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;

-- Privilegios por defecto de Supabase en public
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
