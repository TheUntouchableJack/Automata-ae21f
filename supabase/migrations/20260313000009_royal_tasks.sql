-- Royal Tasks: Royal's active work queue, blockers, and completed tasks
-- Used by the CEO dashboard Tasks panel and the royal-ai-prompt edge function (log_task / request_help tools)

create table if not exists royal_tasks (
    id               uuid primary key default gen_random_uuid(),
    title            text not null,
    description      text,
    status           text not null default 'active'
                         check (status in ('active', 'blocked', 'complete', 'cancelled')),
    blocker_type     text check (blocker_type in ('api_key', 'approval', 'decision', 'data', 'other')),
    blocker_description text,   -- what Royal needs from Jay to unblock
    resolution       text,      -- Jay's response / what resolved the blocker
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    resolved_at      timestamptz
);

-- RLS: admin-only (jay@24hour.design has is_admin = true)
alter table royal_tasks enable row level security;

create policy "Admin read royal_tasks" on royal_tasks
    for select using (
        exists (select 1 from profiles where id = auth.uid() and is_admin = true)
    );

create policy "Admin write royal_tasks" on royal_tasks
    for all using (
        exists (select 1 from profiles where id = auth.uid() and is_admin = true)
    );

-- Index for the most common query (status filter, recency sort)
create index idx_royal_tasks_status_created on royal_tasks (status, created_at desc);

-- updated_at trigger
create or replace function update_royal_tasks_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger royal_tasks_updated_at
    before update on royal_tasks
    for each row execute function update_royal_tasks_updated_at();
