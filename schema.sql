-- Pursuit backend schema (Postgres)
CREATE TABLE IF NOT EXISTS events (
  id               SERIAL PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL DEFAULT 'Pursuit',
  organiser_token  TEXT NOT NULL,
  course_json      JSONB,                 -- { segments, distanceM, ascentM, name }
  params_json      JSONB,                 -- model assumptions (falls back to defaults)
  group_size       INT  NOT NULL DEFAULT 2,
  first_start      TEXT NOT NULL DEFAULT '09:30',
  groups_json      JSONB NOT NULL DEFAULT '[]',  -- [{ id, members:[riderId], locked }]
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS riders (
  id                    SERIAL PRIMARY KEY,
  event_id              INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  weight                REAL NOT NULL DEFAULT 75,
  ftp                   REAL NOT NULL DEFAULT 240,
  pos                   TEXT NOT NULL DEFAULT 'road_drops',
  build                 TEXT NOT NULL DEFAULT 'medium',
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Rider key: lets a rider edit their own row without the organiser (ADR-0003).
-- Null for rows created before that shipped.
ALTER TABLE riders ADD COLUMN IF NOT EXISTS rider_token TEXT;

CREATE INDEX IF NOT EXISTS idx_riders_event ON riders(event_id);

-- Removed integration (ADR-0004): drop the columns it needed. CREATE TABLE
-- IF NOT EXISTS above won't touch an already-existing table, so an existing
-- deployment only loses these via the ALTERs below — intentional, see the ADR.
ALTER TABLE riders DROP COLUMN IF EXISTS strava_athlete_id;
ALTER TABLE riders DROP COLUMN IF EXISTS strava_access_token;
ALTER TABLE riders DROP COLUMN IF EXISTS strava_refresh_token;
ALTER TABLE riders DROP COLUMN IF EXISTS strava_expires_at;
ALTER TABLE riders DROP COLUMN IF EXISTS last_refined_at;
ALTER TABLE riders DROP COLUMN IF EXISTS calib;
