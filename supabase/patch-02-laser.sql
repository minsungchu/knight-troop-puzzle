-- 레이저 미로 — 솔로 진행 저장
--
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하세요.
-- 이미 돌린 적이 있어도 다시 돌려도 됩니다.
--
-- 다른 표와 같은 방침입니다: RLS 를 켜되 정책은 읽기만 두고, 쓰기는 SECURITY DEFINER
-- 함수로만 합니다. 그래야 남의 진행을 고치거나 지울 길이 없습니다.

create table if not exists public.laser_progress (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  stage      int     not null check (stage between 1 and 100),
  best_ms    int     not null check (best_ms > 0),
  cleared_at timestamptz not null default now(),
  primary key (user_id, stage)
);

alter table public.laser_progress enable row level security;

-- 읽기는 본인 것만. 남의 진행을 들여다볼 이유가 없다.
drop policy if exists laser_progress_read on public.laser_progress;
create policy laser_progress_read on public.laser_progress
  for select using (auth.uid() = user_id);

-- insert / update / delete 정책 없음 → 쓰기는 아래 함수로만

/* 내 진행 전부 */
create or replace function public.laser_progress_get()
returns table (stage int, best_ms int)
language sql stable security definer set search_path = '' as $$
  select p.stage, p.best_ms
  from public.laser_progress p
  where p.user_id = auth.uid()
  order by p.stage
$$;

/* 단계 하나를 깼다고 알린다.
   기록은 나아질 때만 덮는다 — 같은 단계를 느리게 다시 풀었다고 최고 기록이
   나빠지면 안 된다. */
create or replace function public.laser_progress_set(p_stage int, p_ms int)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  if p_stage is null or p_stage < 1 or p_stage > 100 then raise exception '단계가 올바르지 않습니다'; end if;
  if p_ms is null or p_ms <= 0 then raise exception '기록이 올바르지 않습니다'; end if;

  insert into public.laser_progress (user_id, stage, best_ms)
  values (me, p_stage, p_ms)
  on conflict (user_id, stage) do update
    set best_ms = least(public.laser_progress.best_ms, excluded.best_ms),
        cleared_at = case when excluded.best_ms < public.laser_progress.best_ms
                          then now() else public.laser_progress.cleared_at end;
end $$;

grant execute on function public.laser_progress_get() to authenticated;
grant execute on function public.laser_progress_set(int, int) to authenticated;
