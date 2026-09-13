-- ═══════════════════════════════════════════════════════════════
--  나이트 부대 배치 — Supabase 스키마
--
--  적용: Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--  여러 번 실행해도 안전하도록 작성했다.
--
--  설계 원칙
--   · rooms / room_players 는 RLS 로 직접 접근을 완전히 막고
--     SECURITY DEFINER 함수로만 다룬다 (비밀방 암호가 새 나가지 않게).
--   · scores 는 읽기 공개, 쓰기는 submit_score() 로만 (이름 위조 방지).
--   · 실시간 진행률은 DB 를 거치지 않고 Realtime Broadcast 로만 흐른다.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────
--  프로필
-- ───────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique,
  session_token uuid,                                  -- 동시접속 1곳 제한
  created_at    timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,16}$')
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read on public.profiles for select using (true);
-- UPDATE 정책은 두지 않는다. 이름을 바꾸면 이미 올라간 랭킹 기록과 어긋나고,
-- session_token 갱신은 claim_session() 이 맡는다.

-- session_token 은 밖으로 나가면 안 되므로 읽을 수 있는 열을 좁힌다.
-- (열 단위 REVOKE 는 테이블 단위 GRANT 가 살아 있으면 효과가 없으므로 먼저 거둔다)
revoke select on public.profiles from anon, authenticated;
grant  select (id, username, created_at) on public.profiles to anon, authenticated;

/* ── 만들기 전에 지운다 ──
   create or replace 는 돌려주는 값의 모양이 달라지면 실패한다("cannot change return
   type of existing function"). 그러면 SQL Editor 는 거기서 멈추고, 서버에는 예전 함수가
   그대로 남는다. 실제로 그렇게 됐다 — 첫 배포판의 laser_room_create 는
   returns table (id uuid, code text) 였고, 그 id 라는 이름이 profiles.id 와 부딪쳐
   "column reference id is ambiguous" 로 죽었다. 고친 판을 올리려 해도 반환형이 달라
   갈아 끼울 수 없었으니, 고치는 패치를 아무리 실행해도 서버는 계속 옛것을 썼다.

   먼저 지우고 새로 만들면 그 벽이 없다. 권한은 파일 끝에서 다시 준다. */

-- 이 기기를 '현재 자리'로 등록한다
drop function if exists public.claim_session(uuid);
create or replace function public.claim_session(p_token uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  update public.profiles set session_token = p_token where id = auth.uid();
end $$;

-- 이 기기가 아직 유효한 자리인지 서버에서 대조한다 (토큰 값은 밖으로 나가지 않는다)
drop function if exists public.session_ok(uuid);
create or replace function public.session_ok(p_token uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.session_token is null or p.session_token = p_token
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

-- 가입하면 프로필을 자동으로 만든다
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  nm := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  insert into public.profiles (id, username) values (new.id, nm);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ───────────────────────────────────────────────
--  랭킹 기록
-- ───────────────────────────────────────────────
create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  user_id    uuid     not null references public.profiles(id) on delete cascade,
  username   text     not null,                        -- 비정규화: 조회 단순화
  size       smallint not null check (size between 5 and 12),
  level      smallint not null check (level between 1 and 3),
  ms         integer  not null check (ms > 0),
  hints_used smallint not null default 0,
  room_id    uuid,                                     -- 대전에서 나온 기록이면 방 id
  created_at timestamptz not null default now()
);

create index if not exists scores_board_idx on public.scores (size, level, ms) where hints_used = 0;
create index if not exists scores_mine_idx  on public.scores (user_id, created_at desc);

alter table public.scores enable row level security;

drop policy if exists scores_read on public.scores;
create policy scores_read on public.scores for select using (true);
-- insert / update / delete 정책 없음 → 등록은 submit_score() 로만, 수정·삭제는 아무도 못 한다

-- 기록 등록. 이름은 서버가 프로필에서 채운다.
drop function if exists public.submit_score(int, int, int, int, uuid);
create or replace function public.submit_score(
  p_size int, p_level int, p_ms int, p_hints int, p_room uuid default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; new_id bigint;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  select username into nm from public.profiles where id = me;
  if nm is null then raise exception '프로필을 찾을 수 없습니다'; end if;
  if p_ms is null or p_ms <= 0 then raise exception '기록이 올바르지 않습니다'; end if;

  insert into public.scores (user_id, username, size, level, ms, hints_used, room_id)
  values (me, nm, p_size, p_level, p_ms, greatest(coalesce(p_hints, 0), 0), p_room)
  returning id into new_id;
  return new_id;
end $$;

-- 보드별 랭킹 — 사용자마다 최고기록 1건씩만
drop function if exists public.leaderboard(int, int, int);
create or replace function public.leaderboard(p_size int, p_level int, p_limit int default 100)
returns table (rank bigint, username text, ms int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select row_number() over (order by t.ms, t.created_at), t.username, t.ms, t.created_at
  from (
    select distinct on (s.user_id) s.user_id, s.username, s.ms, s.created_at
    from public.scores s
    where s.size = p_size and s.level = p_level and s.hints_used = 0
    order by s.user_id, s.ms asc, s.created_at asc
  ) t
  order by t.ms, t.created_at
  limit greatest(least(coalesce(p_limit, 100), 500), 1);
$$;

-- 내 순위 (상위 목록 밖일 때 따로 붙여 보여 주기 위해)
drop function if exists public.my_rank(int, int);
create or replace function public.my_rank(p_size int, p_level int)
returns table (rank bigint, ms int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (s.user_id) s.user_id, s.ms, s.created_at
    from public.scores s
    where s.size = p_size and s.level = p_level and s.hints_used = 0
    order by s.user_id, s.ms asc, s.created_at asc
  )
  select (select count(*) + 1 from best x where x.ms < b.ms
          or (x.ms = b.ms and x.created_at < b.created_at)),
         b.ms, b.created_at
  from best b
  where b.user_id = auth.uid();
$$;

-- 내 전체 기록 (힌트 쓴 판 포함)
drop function if exists public.my_scores(int);
create or replace function public.my_scores(p_limit int default 50)
returns table (size int, level int, ms int, hints_used int, room_id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.size, s.level, s.ms, s.hints_used, s.room_id, s.created_at
  from public.scores s
  where s.user_id = auth.uid()
  order by s.created_at desc
  limit greatest(least(coalesce(p_limit, 50), 200), 1);
$$;


-- ───────────────────────────────────────────────
--  대전 방
-- ───────────────────────────────────────────────
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text     not null unique,                -- 6자리 입장 코드
  host_id     uuid     not null references public.profiles(id) on delete cascade,
  title       text     not null default '',
  is_private  boolean  not null default false,
  join_code   text,                                    -- 비밀방 암호 (평문 — 일회성 입장 암호)
  max_players smallint not null check (max_players between 1 and 4),
  size        smallint not null check (size between 5 and 12),
  level       smallint not null check (level between 1 and 3),
  status      text     not null default 'waiting' check (status in ('waiting','playing','finished')),
  puzzle      text,                                    -- 시작할 때 확정. 0~4 숫자 문자열
  solution    text,
  start_at    timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.room_players (
  room_id     uuid     not null references public.rooms(id) on delete cascade,
  user_id     uuid     not null references public.profiles(id) on delete cascade,
  username    text     not null,
  seat        smallint not null,
  filled      smallint not null default 0,
  hints_used  smallint not null default 0,
  finish_ms   integer,
  finished_at timestamptz,
  joined_at   timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists rooms_open_idx on public.rooms (status, created_at desc);

-- RLS 를 켜고 정책을 하나도 두지 않는다 → 직접 접근 전면 차단.
-- 모든 접근은 아래 SECURITY DEFINER 함수와 open_rooms 뷰를 통해서만 이뤄진다.
alter table public.rooms        enable row level security;
alter table public.room_players enable row level security;

-- 로비 목록 — join_code 는 빠져 있다
create or replace view public.open_rooms as
  select r.id, r.code, r.title, r.is_private, r.max_players,
         r.size, r.level, r.status, r.created_at,
         p.username as host,
         (select count(*) from public.room_players rp where rp.room_id = r.id) as players
  from public.rooms r
  join public.profiles p on p.id = r.host_id
  where r.status = 'waiting'
    and r.created_at > now() - interval '2 hours';       -- 유령 방은 목록에서 자동 소멸

grant select on public.open_rooms to anon, authenticated;


-- 방 만들기
drop function if exists public.create_room(text, boolean, text, int, int, int);
create or replace function public.create_room(
  p_title text, p_private boolean, p_pass text, p_max int, p_size int, p_level int
) returns json
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; c text; r public.rooms;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  select username into nm from public.profiles where id = me;
  if nm is null then raise exception '프로필을 찾을 수 없습니다'; end if;
  if p_max < 1 or p_max > 4 then raise exception '인원은 1~4명입니다'; end if;
  if p_private and coalesce(trim(p_pass), '') = '' then raise exception '비밀방은 입장 암호가 필요합니다'; end if;

  -- 내가 만들어 둔 대기 중인 방은 정리한다 (한 사람이 방을 여러 개 띄우지 않도록)
  delete from public.rooms where host_id = me and status = 'waiting';

  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.rooms where code = c);
  end loop;

  insert into public.rooms (code, host_id, title, is_private, join_code, max_players, size, level)
  values (c, me,
          coalesce(nullif(trim(p_title), ''), nm || '의 전장'),
          coalesce(p_private, false),
          case when p_private then trim(p_pass) end,
          p_max, p_size, p_level)
  returning * into r;

  insert into public.room_players (room_id, user_id, username, seat)
  values (r.id, me, nm, 0);

  return json_build_object('id', r.id, 'code', r.code);
end $$;


-- 입장 — 정원·암호·상태를 서버가 확인한다
drop function if exists public.join_room(text, text);
create or replace function public.join_room(p_code text, p_pass text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; r public.rooms; n int;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  select username into nm from public.profiles where id = me;

  select * into r from public.rooms where code = upper(trim(p_code));
  if not found then raise exception '방을 찾을 수 없습니다'; end if;

  -- 이미 들어와 있으면 그대로 통과 (새로고침 복귀)
  if exists (select 1 from public.room_players where room_id = r.id and user_id = me) then
    return r.id;
  end if;

  if r.status <> 'waiting' then raise exception '이미 시작된 방입니다'; end if;
  if r.is_private and coalesce(r.join_code, '') <> coalesce(trim(p_pass), '') then
    raise exception '입장 암호가 틀렸습니다';
  end if;

  select count(*) into n from public.room_players where room_id = r.id;
  if n >= r.max_players then raise exception '정원이 찼습니다'; end if;

  insert into public.room_players (room_id, user_id, username, seat)
  values (r.id, me, nm, n);
  return r.id;
end $$;


-- 방 상태 — 참가자만 볼 수 있고, join_code 는 절대 나가지 않는다
drop function if exists public.room_state(uuid);
create or replace function public.room_state(p_room uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found then return null; end if;
  if not exists (select 1 from public.room_players where room_id = p_room and user_id = me) then
    raise exception '이 방의 참가자가 아닙니다';
  end if;

  return json_build_object(
    'id', r.id, 'code', r.code, 'title', r.title,
    'is_private', r.is_private, 'max_players', r.max_players,
    'size', r.size, 'level', r.level, 'status', r.status,
    'host_id', r.host_id, 'puzzle', r.puzzle, 'solution', r.solution,
    'start_at', r.start_at,
    'players', coalesce((
      select json_agg(json_build_object(
               'user_id', rp.user_id, 'username', rp.username, 'seat', rp.seat,
               'filled', rp.filled, 'hints_used', rp.hints_used,
               'finish_ms', rp.finish_ms, 'finished_at', rp.finished_at
             ) order by rp.seat)
      from public.room_players rp where rp.room_id = p_room), '[]'::json)
  );
end $$;


-- 시작 — 방장이 직접 만든 퍼즐을 배포한다.
-- 시드만 공유하면 안 된다: 퍼즐 생성이 Date.now() 로 탐색을 끊기 때문에
-- 같은 시드라도 기기 속도에 따라 다른 퍼즐이 나온다.
drop function if exists public.start_room(uuid, text, text);
create or replace function public.start_room(p_room uuid, p_puzzle text, p_solution text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.rooms; n int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception '방을 찾을 수 없습니다'; end if;
  if r.host_id <> me then raise exception '방장만 시작할 수 있습니다'; end if;
  if r.status <> 'waiting' then raise exception '이미 시작된 방입니다'; end if;

  n := r.size * r.size;
  if length(p_puzzle) <> n or length(p_solution) <> n then
    raise exception '판 크기가 맞지 않습니다';
  end if;

  update public.rooms
     set status = 'playing', puzzle = p_puzzle, solution = p_solution, start_at = now()
   where id = p_room
   returning start_at into r.start_at;

  return r.start_at;
end $$;


-- 완주 — 등수를 돌려준다
drop function if exists public.finish_room(uuid, int, int);
create or replace function public.finish_room(p_room uuid, p_ms int, p_hints int)
returns int
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); sz int; rk int;
begin
  select size into sz from public.rooms where id = p_room;
  if sz is null then raise exception '방을 찾을 수 없습니다'; end if;

  update public.room_players
     set finish_ms = p_ms, hints_used = coalesce(p_hints, 0),
         finished_at = now(), filled = sz * sz
   where room_id = p_room and user_id = me and finished_at is null;

  select count(*) into rk from public.room_players
   where room_id = p_room and finished_at is not null;

  -- 전원 완주하면 방을 닫는다
  if not exists (select 1 from public.room_players
                 where room_id = p_room and finished_at is null) then
    update public.rooms set status = 'finished' where id = p_room;
  end if;

  return rk;
end $$;


-- 나가기
drop function if exists public.leave_room(uuid);
create or replace function public.leave_room(p_room uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found then return; end if;

  delete from public.room_players where room_id = p_room and user_id = me;

  if r.host_id = me and r.status = 'waiting' then
    delete from public.rooms where id = p_room;                       -- 대기 중 방장 이탈 → 폐쇄
  elsif not exists (select 1 from public.room_players where room_id = p_room) then
    delete from public.rooms where id = p_room;                       -- 아무도 없으면 폐쇄
  end if;
end $$;


-- 내가 지금 들어가 있는 방 (새로고침 복귀용)
drop function if exists public.my_room();
create or replace function public.my_room()
returns uuid
language sql stable security definer set search_path = '' as $$
  select rp.room_id
  from public.room_players rp
  join public.rooms r on r.id = rp.room_id
  where rp.user_id = auth.uid()
    and r.status in ('waiting', 'playing')
    and r.created_at > now() - interval '6 hours'
  order by rp.joined_at desc
  limit 1;
$$;


-- ───────────────────────────────────────────────
--  실행 권한
-- ───────────────────────────────────────────────
grant execute on function public.leaderboard(int, int, int) to anon, authenticated;
grant execute on function public.my_rank(int, int)          to authenticated;
grant execute on function public.my_scores(int)             to authenticated;
grant execute on function public.submit_score(int, int, int, int, uuid) to authenticated;
grant execute on function public.create_room(text, boolean, text, int, int, int) to authenticated;
grant execute on function public.join_room(text, text)      to authenticated;
grant execute on function public.room_state(uuid)           to authenticated;
grant execute on function public.start_room(uuid, text, text) to authenticated;
grant execute on function public.finish_room(uuid, int, int) to authenticated;
grant execute on function public.leave_room(uuid)           to authenticated;
grant execute on function public.my_room()                  to authenticated;
grant execute on function public.claim_session(uuid)        to authenticated;
grant execute on function public.session_ok(uuid)           to authenticated;

revoke execute on function public.handle_new_user() from public;
