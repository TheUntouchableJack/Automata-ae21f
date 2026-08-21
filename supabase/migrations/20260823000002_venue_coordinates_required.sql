ALTER TABLE venues
  ADD CONSTRAINT venues_active_requires_coordinates
  CHECK (is_active = false OR (latitude IS NOT NULL AND longitude IS NOT NULL))
  NOT VALID;
