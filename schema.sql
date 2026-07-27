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
  calib                 REAL NOT NULL DEFAULT 1,   -- retired (ADR-0001), always 1
  strava_athlete_id     BIGINT,
  strava_access_token   TEXT,
  strava_refresh_token  TEXT,
  strava_expires_at     BIGINT,
  last_refined_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_riders_event ON riders(event_id);

-- Calibration is retired (ADR-0001): FTP alone drives the model. Nothing writes a
-- non-1 value any more, so this idempotently clears multipliers left by the old
-- time-based "Use time" refinement.
UPDATE riders SET calib = 1 WHERE calib <> 1;
