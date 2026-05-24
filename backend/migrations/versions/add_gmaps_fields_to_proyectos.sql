-- Migration: add gmaps_url and gmaps_coordinates to proyectos table
-- Run once against the existing database:
--   docker exec -i proptech_db psql -U proptech -d proptech_db < migrations/versions/add_gmaps_fields_to_proyectos.sql

ALTER TABLE proyectos
    ADD COLUMN IF NOT EXISTS gmaps_url         TEXT,
    ADD COLUMN IF NOT EXISTS gmaps_coordinates TEXT;
