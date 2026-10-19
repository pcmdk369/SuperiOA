create table if not exists public.agent_execution_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    engine_id text not null check (engine_id ~ '^engine-[1-5]$'),
    attempt smallint not null check (attempt between 0 and 3),
    succeeded boolean not null,
    failure_class text check (failure_class is null or length(failure_class) <= 80),
    latency_ms integer not null check (latency_ms >= 0),
    prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
    completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
    created_at timestamptz not null default now()
);

alter table public.agent_execution_logs enable row level security;

revoke all on public.agent_execution_logs from anon, authenticated, public;
grant select on public.agent_execution_logs to authenticated;
grant insert on public.agent_execution_logs to service_role;

create policy "Users can read their own engine logs"
    on public.agent_execution_logs
    for select
    to authenticated
    using (auth.uid() = user_id);

create index if not exists agent_execution_logs_user_created_idx
    on public.agent_execution_logs (user_id, created_at desc);
