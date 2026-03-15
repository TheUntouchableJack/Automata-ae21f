-- Add target_phone to outreach_queue for SMS outreach
alter table outreach_queue add column if not exists target_phone text;
