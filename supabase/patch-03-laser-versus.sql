-- 레이저 미로 — 대전방과 급수
--
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하세요. 여러 번 돌려도 됩니다.
--
-- 나이트 퍼즐의 rooms 를 같이 쓰지 않고 따로 둡니다. 그쪽 표는 size·level 이
-- not null 이고 판 하나만 담게 되어 있어서, 상/중/하 여러 판을 치르는 이 게임을
-- 억지로 얹으면 양쪽 다 헝클어집니다.
--
-- 방침은 같습니다: RLS 를 켜고 정책은 두지 않아 직접 접근을 막고,
-- 모든 읽기·쓰기를 SECURITY DEFINER 함수로만 합니다.
-- 비밀방 암호가 목록에 새 나가지 않게 하려는 것이 핵심입니다.

/* ══════════════ 급수 ══════════════ */

create table if not exists public.laser_ratings (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  rating     int  not null default 1000 check (rating >= 100),
  wins       int  not null default 0,
  losses     int  not null default 0,
  draws      int  not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.laser_ratings enable row level security;
-- 급수는 모두에게 보인다. 순위표를 만들어야 하니까.
drop policy if exists laser_ratings_read on public.laser_ratings;
create policy laser_ratings_read on public.laser_ratings for select using (true);
-- 쓰기 정책 없음 → 대전이 끝날 때 함수로만 바뀐다

/* ══════════════ 방 ══════════════ */

create table if not exists public.laser_rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text     not null unique,               -- 6자리 입장 코드
  host_id     uuid     not null references public.profiles(id) on delete cascade,
  title       text     not null default '',
  is_private  boolean  not null default false,
  join_code   text,                                   -- 비밀방 암호 (일회성 입장 암호)
  max_players smallint not null check (max_players between 2 and 4),
  n_low       smallint not null default 0 check (n_low  between 0 and 10),
  n_mid       smallint not null default 0 check (n_mid  between 0 and 10),
  n_high      smallint not null default 0 check (n_high between 0 and 10),
  status      text     not null default 'waiting' check (status in ('waiting','playing','finished')),
  boards      text,                                   -- 시작할 때 확정한 판 묶음(JSON)
  start_at    timestamptz,
  created_at  timestamptz not null default now(),
  constraint laser_rooms_total check (n_low + n_mid + n_high between 1 and 10)
);

create table if not exists public.laser_room_players (
  room_id     uuid     not null references public.laser_rooms(id) on delete cascade,
  user_id     uuid     not null references public.profiles(id) on delete cascade,
  username    text     not null,
  seat        smallint not null,
  solved      smallint not null default 0,            -- 몇 판을 깼는지
  finish_ms   integer,                                -- 전부 깬 사람만
  finished_at timestamptz,
  joined_at   timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists laser_rooms_open_idx on public.laser_rooms (status, created_at desc);

alter table public.laser_rooms        enable row level security;
alter table public.laser_room_players enable row level security;
-- 정책 없음 → 직접 접근 전면 차단. 아래 뷰와 함수로만.

/* 공개 목록. join_code 는 넣지 않는다 — 비밀방 암호가 새면 안 된다. */
create or replace view public.laser_open_rooms as
  select r.id, r.code, r.title, r.is_private, r.max_players,
         r.n_low, r.n_mid, r.n_high, r.status, r.created_at,
         (select count(*) from public.laser_room_players p where p.room_id = r.id) as players
  from public.laser_rooms r
  where r.status = 'waiting'
  order by r.created_at desc
  limit 50;

grant select on public.laser_open_rooms to anon, authenticated;

/* ══════════════ 함수 ══════════════ */

create or replace function public.laser_room_create(
  p_title text, p_private boolean, p_join_code text,
  p_max int, p_low int, p_mid int, p_high int
) returns table (id uuid, code text)
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; c text; r public.laser_rooms;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  select username into nm from public.profiles where id = me;
  if nm is null then raise exception '프로필을 찾을 수 없습니다'; end if;
  if coalesce(p_low,0) + coalesce(p_mid,0) + coalesce(p_high,0) not between 1 and 10 then
    raise exception '판 수는 모두 합쳐 1~10 이어야 합니다';
  end if;
  if p_private and coalesce(length(trim(p_join_code)), 0) < 4 then
    raise exception '비밀방 암호는 4자 이상이어야 합니다';
  end if;

  -- 한 사람이 기다리는 방을 여러 개 열어 두지 못하게 한다
  delete from public.laser_rooms where host_id = me and status = 'waiting';

  loop
    c := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.laser_rooms where code = c);
  end loop;

  insert into public.laser_rooms (code, host_id, title, is_private, join_code,
                                  max_players, n_low, n_mid, n_high)
  values (c, me, coalesce(nullif(trim(p_title), ''), nm || ' 의 방'),
          coalesce(p_private, false), case when p_private then trim(p_join_code) end,
          greatest(2, least(4, coalesce(p_max, 2))),
          coalesce(p_low,0), coalesce(p_mid,0), coalesce(p_high,0))
  returning * into r;

  insert into public.laser_room_players (room_id, user_id, username, seat)
  values (r.id, me, nm, 0);

  return query select r.id, r.code;
end $$;

create or replace function public.laser_room_join(p_code text, p_pass text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; r public.laser_rooms; n int;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  select username into nm from public.profiles where id = me;

  select * into r from public.laser_rooms where code = upper(trim(p_code));
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if r.status <> 'waiting' then raise exception '이미 시작한 방입니다'; end if;
  if r.is_private and coalesce(r.join_code, '') <> coalesce(trim(p_pass), '') then
    raise exception '암호가 맞지 않습니다';
  end if;

  if exists (select 1 from public.laser_room_players where room_id = r.id and user_id = me) then
    return r.id;                                   -- 이미 들어와 있으면 그대로
  end if;

  select count(*) into n from public.laser_room_players where room_id = r.id;
  if n >= r.max_players then raise exception '자리가 없습니다'; end if;

  insert into public.laser_room_players (room_id, user_id, username, seat)
  values (r.id, me, nm, n);
  return r.id;
end $$;

/* 방 상태. join_code 는 돌려주지 않는다. */
create or replace function public.laser_room_state(p_room uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.laser_rooms;
begin
  select * into r from public.laser_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if not exists (select 1 from public.laser_room_players where room_id = p_room and user_id = me) then
    raise exception '이 방의 참가자가 아닙니다';
  end if;

  return jsonb_build_object(
    'id', r.id, 'code', r.code, 'title', r.title, 'host', r.host_id,
    'is_private', r.is_private, 'max_players', r.max_players,
    'n_low', r.n_low, 'n_mid', r.n_mid, 'n_high', r.n_high,
    'status', r.status, 'boards', r.boards, 'start_at', r.start_at,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.user_id, 'name', p.username, 'seat', p.seat,
        'solved', p.solved, 'finish_ms', p.finish_ms,
        'rating', coalesce(g.rating, 1000)
      ) order by p.seat), '[]'::jsonb)
      from public.laser_room_players p
      left join public.laser_ratings g on g.user_id = p.user_id
      where p.room_id = r.id)
  );
end $$;

/* 방장이 시작한다. 판 묶음은 클라이언트가 뽑아 보내고 서버가 못박는다 —
   모두가 같은 판을 봐야 하므로, 한 번 정해지면 바꿀 수 없다. */
create or replace function public.laser_room_start(p_room uuid, p_boards text)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.laser_rooms;
begin
  select * into r from public.laser_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if r.host_id <> me then raise exception '방장만 시작할 수 있습니다'; end if;
  if r.status <> 'waiting' then raise exception '이미 시작했습니다'; end if;
  if (select count(*) from public.laser_room_players where room_id = p_room) < 2 then
    raise exception '두 명 이상이어야 시작할 수 있습니다';
  end if;

  update public.laser_rooms
     set status = 'playing', boards = p_boards, start_at = now()
   where id = p_room;
end $$;

/* 몇 판째 깼는지 알린다. 뒤로 가지는 않는다. */
create or replace function public.laser_room_progress(p_room uuid, p_solved int)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  update public.laser_room_players
     set solved = greatest(solved, coalesce(p_solved, 0))
   where room_id = p_room and user_id = me;
end $$;

/* 전부 깼다. 처음 다 깬 사람이 이긴다.
   점수 계산은 여기서 한다 — 클라이언트가 보내는 값을 믿을 수 없다. */
create or replace function public.laser_room_finish(p_room uuid, p_ms int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); r public.laser_rooms;
  total int; n int; rec record; k numeric; d numeric; ex numeric;
  result jsonb := '[]'::jsonb;
begin
  select * into r from public.laser_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if r.status <> 'playing' then raise exception '진행 중인 방이 아닙니다'; end if;
  total := r.n_low + r.n_mid + r.n_high;

  update public.laser_room_players
     set solved = total, finish_ms = coalesce(finish_ms, p_ms), finished_at = coalesce(finished_at, now())
   where room_id = p_room and user_id = me;

  -- 아직 아무도 없던 자리에 처음 들어온 사람이면 방을 끝낸다
  if not exists (select 1 from public.laser_room_players
                 where room_id = p_room and user_id <> me and finished_at is not null) then
    update public.laser_rooms set status = 'finished' where id = p_room and status = 'playing';

    /* 점수 다시 매기기 — Elo, K=20, 눈금 1000.
       같은 점수끼리는 ±10, 점수 차가 클수록 약자가 더 많이 오른다.
       셋 이상이면 짝마다 계산하고 K 를 (인원-1) 로 나눈다. */
    select count(*) into n from public.laser_room_players where room_id = p_room;
    if n >= 2 then
      k := 20.0 / (n - 1);

      -- 등수: 다 깬 사람은 걸린 시간 순, 못 깬 사람은 깬 판 수 역순
      for rec in
        with standing as (
          select p.user_id,
                 coalesce(g.rating, 1000) as rating,
                 rank() over (order by (p.finished_at is null), p.finish_ms nulls last, -p.solved) as pos
          from public.laser_room_players p
          left join public.laser_ratings g on g.user_id = p.user_id
          where p.room_id = p_room
        )
        select a.user_id, a.rating, a.pos,
               sum(k * ((case when a.pos < b.pos then 1 when a.pos > b.pos then 0 else 0.5 end)
                        - 1.0 / (1 + power(10, (b.rating - a.rating) / 1000.0)))) as delta
        from standing a join standing b on a.user_id <> b.user_id
        group by a.user_id, a.rating, a.pos
      loop
        d := round(rec.delta);
        insert into public.laser_ratings (user_id, rating, wins, losses, draws)
        values (rec.user_id, greatest(100, rec.rating + d),
                case when rec.pos = 1 then 1 else 0 end,
                case when rec.pos > 1 then 1 else 0 end, 0)
        on conflict (user_id) do update
          set rating = greatest(100, public.laser_ratings.rating + d),
              wins   = public.laser_ratings.wins   + case when rec.pos = 1 then 1 else 0 end,
              losses = public.laser_ratings.losses + case when rec.pos > 1 then 1 else 0 end,
              updated_at = now();

        result := result || jsonb_build_object(
          'id', rec.user_id, 'pos', rec.pos, 'before', rec.rating,
          'after', greatest(100, rec.rating + d), 'delta', d);
      end loop;
    end if;
  end if;

  return result;
end $$;

/* 나가기. 방장이 나가면 기다리던 방은 사라진다. */
create or replace function public.laser_room_leave(p_room uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.laser_rooms;
begin
  select * into r from public.laser_rooms where id = p_room;
  if r.id is null then return; end if;
  delete from public.laser_room_players where room_id = p_room and user_id = me;
  if r.host_id = me and r.status = 'waiting' then
    delete from public.laser_rooms where id = p_room;
  end if;
end $$;

/* 내 급수 */
create or replace function public.laser_my_rating()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rating', coalesce((select rating from public.laser_ratings where user_id = auth.uid()), 1000),
    'wins',   coalesce((select wins   from public.laser_ratings where user_id = auth.uid()), 0),
    'losses', coalesce((select losses from public.laser_ratings where user_id = auth.uid()), 0))
$$;

/* 급수 순위표 */
create or replace function public.laser_leaderboard(p_limit int default 100)
returns table (rank bigint, username text, rating int, wins int, losses int)
language sql stable security definer set search_path = '' as $$
  select row_number() over (order by g.rating desc, g.updated_at asc),
         p.username, g.rating, g.wins, g.losses
  from public.laser_ratings g
  join public.profiles p on p.id = g.user_id
  order by g.rating desc, g.updated_at asc
  limit greatest(1, least(200, coalesce(p_limit, 100)))
$$;

grant execute on function public.laser_room_create(text, boolean, text, int, int, int, int) to authenticated;
grant execute on function public.laser_room_join(text, text)   to authenticated;
grant execute on function public.laser_room_state(uuid)        to authenticated;
grant execute on function public.laser_room_start(uuid, text)  to authenticated;
grant execute on function public.laser_room_progress(uuid, int) to authenticated;
grant execute on function public.laser_room_finish(uuid, int)  to authenticated;
grant execute on function public.laser_room_leave(uuid)        to authenticated;
grant execute on function public.laser_my_rating()             to authenticated;
grant execute on function public.laser_leaderboard(int)        to anon, authenticated;
