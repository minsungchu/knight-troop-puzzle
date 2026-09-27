-- 칠교 마을 — 도전(어드벤처) 스테이지 기록
--
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하세요. 여러 번 돌려도 됩니다.
-- patch-08 과 같은 방침입니다: RLS 를 켜되 정책은 읽기만 두고, 쓰기는 SECURITY DEFINER
-- 함수로만 합니다. 사람마다 스테이지마다 한 줄이고, 더 좋을 때만 덮습니다.
--
-- 패치를 안 돌려도 도전은 그대로 됩니다. 기록이 이 브라우저에만 남을 뿐입니다.

create table if not exists public.tangram_stage_records (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  stage      text not null check (stage ~ '^[a-z]{3,12}-([1-9]|10)$'),
  best_ms    int  not null check (best_ms >= 2000),
  stars      smallint not null check (stars between 1 and 3),
  cleared_at timestamptz not null default now(),
  primary key (user_id, stage)
);

alter table public.tangram_stage_records enable row level security;

drop policy if exists tangram_stage_read on public.tangram_stage_records;
create policy tangram_stage_read on public.tangram_stage_records
  for select using (auth.uid() = user_id);

/* ── 만들기 전에 지운다 (patch-02 머리말 참고) ── */

drop function if exists public.tangram_stage_get();
create or replace function public.tangram_stage_get()
returns table (stage text, best_ms int, stars smallint)
language sql stable security definer set search_path = '' as $$
  select r.stage, r.best_ms, r.stars
  from public.tangram_stage_records r
  where r.user_id = auth.uid()
  order by r.stage
$$;

/* 한 판 깼다. 별이 많은 쪽이 우선이고, 별이 같으면 빠른 쪽을 남긴다 —
   화면(js/tangram/stages.js)과 같은 규칙이라야 기기 둘을 오가도 기록이 흔들리지 않는다. */
drop function if exists public.tangram_stage_set(text, int, int);
create or replace function public.tangram_stage_set(p_stage text, p_ms int, p_stars int)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  if p_stage is null or p_stage !~ '^[a-z]{3,12}-([1-9]|10)$' then raise exception '스테이지가 올바르지 않습니다'; end if;
  if p_ms is null or p_ms < 2000 or p_ms > 86400000 then raise exception '기록이 올바르지 않습니다'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 3 then raise exception '별이 올바르지 않습니다'; end if;

  insert into public.tangram_stage_records (user_id, stage, best_ms, stars)
  values (me, p_stage, p_ms, p_stars::smallint)
  on conflict (user_id, stage) do update
    set best_ms = case
          when excluded.stars > public.tangram_stage_records.stars then excluded.best_ms
          when excluded.stars = public.tangram_stage_records.stars
            then least(public.tangram_stage_records.best_ms, excluded.best_ms)
          else public.tangram_stage_records.best_ms end,
        stars = greatest(public.tangram_stage_records.stars, excluded.stars),
        cleared_at = now();
end $$;

grant execute on function public.tangram_stage_get()                to authenticated;
grant execute on function public.tangram_stage_set(text, int, int)  to authenticated;
