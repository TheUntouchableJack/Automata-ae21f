-- content_queue: Royal's proposed content actions (blog posts, X posts, etc.)
-- pending Jay's approval before generation/execution begins.
-- Pattern mirrors outreach_queue: draft → approved/rejected.

create table content_queue (
    id          uuid primary key default gen_random_uuid(),
    action_type text not null check (action_type in ('blog_post', 'x_post', 'linkedin_post')),
    title       text not null,
    topic       text,
    outline     text,
    rationale   text not null,
    status      text not null default 'draft'
                  check (status in ('draft', 'approved', 'rejected', 'generated')),
    veto_window_ends timestamptz default (now() + interval '4 hours'),
    created_at  timestamptz default now()
);

-- Admin-only: Jay approves/rejects Royal's content proposals
alter table content_queue enable row level security;
create policy "Admin only" on content_queue for all using (
    exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Service role (edge functions) can write proposals
create index idx_content_queue_status on content_queue(status, created_at);
