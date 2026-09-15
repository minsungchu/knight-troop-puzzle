-- 칠교 마을 — 퀘스트별 최고 기록과 순위
--
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하세요. 여러 번 돌려도 됩니다.
--
-- 다른 표와 같은 방침입니다: RLS 를 켜되 정책은 읽기만 두고, 쓰기는 SECURITY DEFINER
-- 함수로만 합니다. 기록은 사람마다 퀘스트마다 한 줄이고, 나아질 때만 덮습니다.
--
-- 패치를 안 돌려도 게임은 그대로 됩니다. 기록이 이 브라우저에만 남고 순위표가 비어 있을 뿐입니다.

create table if not exists public.tangram_records (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  quest      int  not null check (quest between 1 and 50),
  best_ms    int  not null check (best_ms >= 3000),
  cleared_at timestamptz not null default now(),
  primary key (user_id, quest)
);

create index if not exists tangram_records_board_idx on public.tangram_records (quest, best_ms, cleared_at);

alter table public.tangram_records enable row level security;

-- 읽기는 본인 것만. 순위표는 아래 함수가 이름만 붙여 내보낸다.
drop policy if exists tangram_records_read on public.tangram_records;
create policy tangram_records_read on public.tangram_records
  for select using (auth.uid() = user_id);

/* ── 만들기 전에 지운다 ──
   create or replace 는 돌려주는 값의 모양이 달라지면 실패하고, 서버에는 예전 함수가
   그대로 남는다(patch-02 머리말 참고). 먼저 지우고 새로 만든다. 권한은 파일 끝에서 준다. */

/* 내 기록 전부 */
drop function if exists public.tangram_records_get();
create or replace function public.tangram_records_get()
returns table (quest int, best_ms int)
language sql stable security definer set search_path = '' as $$
  select r.quest, r.best_ms
  from public.tangram_records r
  where r.user_id = auth.uid()
  order by r.quest
$$;

/* 퀘스트 하나를 깼다. 3초보다 빠른 기록은 받지 않는다 — 조각을 줍고 나르기만 해도 그보다 걸린다. */
drop function if exists public.tangram_record_set(int, int);
create or replace function public.tangram_record_set(p_quest int, p_ms int)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  if p_quest is null or p_quest < 1 or p_quest > 50 then raise exception '퀘스트가 올바르지 않습니다'; end if;
  if p_ms is null or p_ms < 3000 or p_ms > 86400000 then raise exception '기록이 올바르지 않습니다'; end if;

  insert into public.tangram_records (user_id, quest, best_ms)
  values (me, p_quest, p_ms)
  on conflict (user_id, quest) do update
    set best_ms    = least(public.tangram_records.best_ms, excluded.best_ms),
        cleared_at = case when excluded.best_ms < public.tangram_records.best_ms
                          then now() else public.tangram_records.cleared_at end;
end $$;

/* 퀘스트별 순위 — 사람마다 최고 기록 한 줄 */
drop function if exists public.tangram_leaderboard(int, int);
create or replace function public.tangram_leaderboard(p_quest int, p_limit int default 100)
returns table (rank bigint, username text, ms int, cleared_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select row_number() over (order by r.best_ms, r.cleared_at), p.username, r.best_ms, r.cleared_at
  from public.tangram_records r
  join public.profiles p on p.id = r.user_id
  where r.quest = p_quest
  order by r.best_ms, r.cleared_at
  limit greatest(least(coalesce(p_limit, 100), 500), 1);
$$;

grant execute on function public.tangram_records_get()          to authenticated;
grant execute on function public.tangram_record_set(int, int)   to authenticated;
grant execute on function public.tangram_leaderboard(int, int)  to anon, authenticated;
