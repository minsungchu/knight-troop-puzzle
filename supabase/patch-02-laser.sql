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

/* ── 만들기 전에 지운다 ──
   create or replace 는 돌려주는 값의 모양이 달라지면 실패한다("cannot change return
   type of existing function"). 그러면 SQL Editor 는 거기서 멈추고, 서버에는 예전 함수가
   그대로 남는다. 실제로 그렇게 됐다 — 첫 배포판의 laser_room_create 는
   returns table (id uuid, code text) 였고, 그 id 라는 이름이 profiles.id 와 부딪쳐
   "column reference id is ambiguous" 로 죽었다. 고친 판을 올리려 해도 반환형이 달라
   갈아 끼울 수 없었으니, 고치는 패치를 아무리 실행해도 서버는 계속 옛것을 썼다.

   먼저 지우고 새로 만들면 그 벽이 없다. 권한은 파일 끝에서 다시 준다. */

/* 내 진행 전부 */
drop function if exists public.laser_progress_get();
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
drop function if exists public.laser_progress_set(int, int);
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
