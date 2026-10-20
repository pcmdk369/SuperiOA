create table if not exists public.agent_plan_rate_limits (
    user_id uuid primary key references auth.users (id) on delete cascade,
    window_started_at timestamptz not null,
    request_count smallint not null check (request_count between 1 and 5)
);

alter table public.agent_plan_rate_limits enable row level security;

revoke all on public.agent_plan_rate_limits from anon, authenticated, public;

create or replace function public.consume_agent_plan_rate_limit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_now timestamptz := clock_timestamp();
    allowed boolean;
begin
    insert into public.agent_plan_rate_limits (user_id, window_started_at, request_count)
    values (p_user_id, v_now, 1)
    on conflict (user_id) do update
    set
        window_started_at = case
            when public.agent_plan_rate_limits.window_started_at <= v_now - interval '1 minute'
                then v_now
            else public.agent_plan_rate_limits.window_started_at
        end,
        request_count = case
            when public.agent_plan_rate_limits.window_started_at <= v_now - interval '1 minute'
                then 1
            else public.agent_plan_rate_limits.request_count + 1
        end
    where
        public.agent_plan_rate_limits.window_started_at <= v_now - interval '1 minute'
        or public.agent_plan_rate_limits.request_count < 5
    returning request_count <= 5 into allowed;

    return coalesce(allowed, false);
end;
$function$;

revoke all on function public.consume_agent_plan_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.consume_agent_plan_rate_limit(uuid) to service_role;
