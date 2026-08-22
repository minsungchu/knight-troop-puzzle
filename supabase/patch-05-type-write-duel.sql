-- 타자 도장 — 글쓰기 보관과 1:1 대결
--
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하세요. 여러 번 돌려도 됩니다.
-- patch-04-type.sql 을 먼저 실행해야 합니다.
--
-- 방침은 다른 표와 같습니다. RLS 를 켜고, 읽기는 본인 것만 열거나 아예 닫고,
-- 쓰기는 전부 SECURITY DEFINER 함수로만 합니다.
--
-- 급수(Elo)는 두지 않았습니다. 레이저 대전에는 있지만, 이 게임은 "정확도만 넘으면
-- 통과, 못한다고 겁주지 않는다"를 원칙으로 잡았습니다. 진 아이의 점수가 깎여 내려가는
-- 장치는 그 원칙과 정면으로 부딪힙니다. 대신 몇 번 이기고 졌는지만 남깁니다.

/* ══════════════ 베껴쓰기 기록 자리 만들기 ══════════════ */

-- patch-04 의 item 목록에 'copy'(베껴쓰기)를 더한다
alter table public.type_progress drop constraint if exists type_progress_item_check;
alter table public.type_progress add constraint type_progress_item_check
  check (item ~ '^(stage:([1-9]|10)|words|castle|copy)$');

/* ── 만들기 전에 지운다 ──
   create or replace 는 돌려주는 값의 모양이 달라지면 실패한다("cannot change return
   type of existing function"). 그러면 SQL Editor 는 거기서 멈추고, 서버에는 예전 함수가
   그대로 남는다. 실제로 그렇게 됐다 — 첫 배포판의 laser_room_create 는
   returns table (id uuid, code text) 였고, 그 id 라는 이름이 profiles.id 와 부딪쳐
   "column reference id is ambiguous" 로 죽었다. 고친 판을 올리려 해도 반환형이 달라
   갈아 끼울 수 없었으니, 고치는 패치를 아무리 실행해도 서버는 계속 옛것을 썼다.

   먼저 지우고 새로 만들면 그 벽이 없다. 권한은 파일 끝에서 다시 준다. */

drop function if exists public.type_progress_set(text, int, int, int, int);
create or replace function public.type_progress_set(
  p_item text, p_stars int, p_cpm int, p_acc int, p_score int)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  if p_item is null or p_item !~ '^(stage:([1-9]|10)|words|castle|copy)$' then
    raise exception '항목이 올바르지 않습니다';
  end if;

  insert into public.type_progress (user_id, item, stars, best_cpm, best_acc, best_score)
  values (me, p_item,
          least(3, greatest(0, coalesce(p_stars, 0))),
          least(2000, greatest(0, coalesce(p_cpm, 0))),
          least(100, greatest(0, coalesce(p_acc, 0))),
          least(100000000, greatest(0, coalesce(p_score, 0))))
  on conflict (user_id, item) do update
    set stars      = greatest(public.type_progress.stars,      excluded.stars),
        best_cpm   = greatest(public.type_progress.best_cpm,   excluded.best_cpm),
        best_acc   = greatest(public.type_progress.best_acc,   excluded.best_acc),
        best_score = greatest(public.type_progress.best_score, excluded.best_score),
        updated_at = now();
end $$;

/* ══════════════ 아이가 쓴 글 ══════════════ */
--
-- 본인만 읽습니다. 남에게 보여 주는 길은 만들지 않았습니다 — 초등학생이 쓴 글이
-- 모르는 사람에게 흘러가는 통로는 아예 열지 않는 편이 낫습니다.

create table if not exists public.type_writings (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null check (length(id) between 4 and 64),
  prompt     text not null default '' check (length(prompt) <= 120),
  body       text not null check (length(body) between 1 and 4000),
  chars      int  not null default 0 check (chars >= 0),
  written_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.type_writings enable row level security;

drop policy if exists type_writings_read on public.type_writings;
create policy type_writings_read on public.type_writings
  for select using (auth.uid() = user_id);
-- 쓰기 정책 없음 → 아래 함수로만

drop function if exists public.type_writing_list();
create or replace function public.type_writing_list()
returns table (id text, prompt text, body text, chars int, written_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select w.id, w.prompt, w.body, w.chars, w.written_at
  from public.type_writings w
  where w.user_id = auth.uid()
  order by w.written_at desc
  limit 200
$$;

/* 같은 id 면 덮어쓴다 — 이어 쓴 글이 두 벌이 되면 안 된다. */
drop function if exists public.type_writing_save(text, text, text, timestamptz);
create or replace function public.type_writing_save(
  p_id text, p_prompt text, p_body text, p_at timestamptz default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); body text; n int;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  if p_id is null or length(p_id) not between 4 and 64 then raise exception '글 번호가 올바르지 않습니다'; end if;
  body := left(coalesce(p_body, ''), 4000);
  if length(btrim(body)) = 0 then raise exception '빈 글은 저장할 수 없습니다'; end if;

  select count(*) into n from public.type_writings where user_id = me;
  if n >= 200 and not exists (select 1 from public.type_writings where user_id = me and id = p_id) then
    raise exception '글은 200편까지 보관합니다. 오래된 글을 지워 주세요';
  end if;

  insert into public.type_writings (user_id, id, prompt, body, chars, written_at)
  values (me, p_id, left(coalesce(p_prompt, ''), 120), body,
          length(regexp_replace(body, '\s', '', 'g')), coalesce(p_at, now()))
  on conflict (user_id, id) do update
    set prompt = excluded.prompt, body = excluded.body,
        chars = excluded.chars, written_at = excluded.written_at;
end $$;

drop function if exists public.type_writing_delete(text);
create or replace function public.type_writing_delete(p_id text)
returns void
language sql security definer set search_path = '' as $$
  delete from public.type_writings where user_id = auth.uid() and id = p_id
$$;

/* ══════════════ 1:1 대결 ══════════════ */

create table if not exists public.type_duel_records (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  wins       int not null default 0,
  losses     int not null default 0,
  draws      int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.type_duel_records enable row level security;
drop policy if exists type_duel_records_read on public.type_duel_records;
create policy type_duel_records_read on public.type_duel_records for select using (true);

create table if not exists public.type_rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                    -- 6자리 입장 코드
  host_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null default '',
  mode       text not null check (mode in ('write','castle')),
  status     text not null default 'waiting' check (status in ('waiting','playing','finished')),
  payload    text,                                    -- 시작할 때 못박은 판(JSON)
  total      int  not null default 0 check (total >= 0),
  start_at   timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.type_room_players (
  room_id     uuid not null references public.type_rooms(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  username    text not null,
  seat        smallint not null,
  progress    int not null default 0 check (progress >= 0),
  done_ms     integer,
  finished_at timestamptz,
  joined_at   timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists type_rooms_open_idx on public.type_rooms (status, created_at desc);

alter table public.type_rooms        enable row level security;
alter table public.type_room_players enable row level security;
-- 정책 없음 → 직접 접근 차단. 아래 뷰와 함수로만.

create or replace view public.type_open_rooms as
  select r.id, r.code, r.title, r.mode, r.status, r.created_at,
         (select count(*) from public.type_room_players p where p.room_id = r.id) as players
  from public.type_rooms r
  where r.status = 'waiting'
  order by r.created_at desc
  limit 50;

grant select on public.type_open_rooms to anon, authenticated;

/* 방 만들기. 대결은 1:1 뿐이라 정원을 받지 않는다. */
drop function if exists public.type_room_create(text, text);
create or replace function public.type_room_create(p_title text, p_mode text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; c text; r public.type_rooms;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  if p_mode not in ('write','castle') then raise exception '없는 종목입니다'; end if;
  select username into nm from public.profiles where id = me;
  if nm is null then raise exception '프로필을 찾을 수 없습니다'; end if;

  -- 한 사람이 기다리는 방을 여러 개 열어 두지 못하게 한다
  delete from public.type_rooms where host_id = me and status = 'waiting';

  loop
    c := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.type_rooms where code = c);
  end loop;

  insert into public.type_rooms (code, host_id, title, mode)
  values (c, me, coalesce(nullif(btrim(left(coalesce(p_title,''), 20)), ''), nm || ' 의 방'), p_mode)
  returning * into r;

  insert into public.type_room_players (room_id, user_id, username, seat)
  values (r.id, me, nm, 0);

  return jsonb_build_object('id', r.id, 'code', r.code);
end $$;

drop function if exists public.type_room_join(text);
create or replace function public.type_room_join(p_code text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; r public.type_rooms; n int;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  select username into nm from public.profiles where id = me;

  select * into r from public.type_rooms where code = upper(btrim(p_code));
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if exists (select 1 from public.type_room_players where room_id = r.id and user_id = me) then
    return r.id;
  end if;
  if r.status <> 'waiting' then raise exception '이미 시작한 방입니다'; end if;

  select count(*) into n from public.type_room_players where room_id = r.id;
  if n >= 2 then raise exception '자리가 없습니다'; end if;

  insert into public.type_room_players (room_id, user_id, username, seat)
  values (r.id, me, nm, n);
  return r.id;
end $$;

drop function if exists public.type_room_state(uuid);
create or replace function public.type_room_state(p_room uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.type_rooms;
begin
  select * into r from public.type_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if not exists (select 1 from public.type_room_players where room_id = p_room and user_id = me) then
    raise exception '이 방의 참가자가 아닙니다';
  end if;

  return jsonb_build_object(
    'id', r.id, 'code', r.code, 'title', r.title, 'host', r.host_id,
    'mode', r.mode, 'status', r.status, 'payload', r.payload,
    'total', r.total, 'start_at', r.start_at,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.user_id, 'name', p.username, 'seat', p.seat,
        'progress', p.progress, 'done_ms', p.done_ms,
        'wins', coalesce(d.wins, 0), 'losses', coalesce(d.losses, 0), 'draws', coalesce(d.draws, 0)
      ) order by p.seat), '[]'::jsonb)
      from public.type_room_players p
      left join public.type_duel_records d on d.user_id = p.user_id
      where p.room_id = r.id)
  );
end $$;

/* 방장이 시작한다. 판은 클라이언트가 뽑아 보내고 서버가 못박는다 —
   두 사람이 같은 글, 같은 적을 같은 순서로 받아야 겨루기가 성립한다. */
drop function if exists public.type_room_start(uuid, text, int);
create or replace function public.type_room_start(p_room uuid, p_payload text, p_total int)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.type_rooms;
begin
  select * into r from public.type_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if r.host_id <> me then raise exception '방장만 시작할 수 있습니다'; end if;
  if r.status = 'playing' then raise exception '이미 시작했습니다'; end if;
  if (select count(*) from public.type_room_players where room_id = p_room) < 2 then
    raise exception '두 사람이 모여야 시작할 수 있습니다';
  end if;
  if coalesce(p_total, 0) < 1 then raise exception '판이 비어 있습니다'; end if;

  update public.type_room_players
     set progress = 0, done_ms = null, finished_at = null
   where room_id = p_room;

  update public.type_rooms
     set status = 'playing', payload = p_payload, total = p_total, start_at = now()
   where id = p_room;
end $$;

/* 어디까지 갔는지 알린다. 뒤로 가지는 않는다. */
drop function if exists public.type_room_progress(uuid, int);
create or replace function public.type_room_progress(p_room uuid, p_progress int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.type_room_players
     set progress = greatest(progress, least(coalesce(p_progress, 0),
           coalesce((select total from public.type_rooms where id = p_room), 0)))
   where room_id = p_room and user_id = auth.uid();
end $$;

/* 끝났다고 알린다. 다 해낸 사람은 p_done 을 true 로 준다.
   성이 무너져 더 못 가는 경우도 여기로 오지만 done 은 false 다.
   두 사람이 다 끝나면 방이 닫히고 전적이 매겨진다. */
drop function if exists public.type_room_finish(uuid, int, boolean);
create or replace function public.type_room_finish(p_room uuid, p_ms int, p_done boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); r public.type_rooms; rec record;
  result jsonb := '[]'::jsonb; n_open int; n_first int;
begin
  select * into r from public.type_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if r.status <> 'playing' then return result; end if;

  update public.type_room_players
     set done_ms     = case when coalesce(p_done, false) then coalesce(done_ms, greatest(1, coalesce(p_ms, 1))) else done_ms end,
         progress    = case when coalesce(p_done, false) then r.total else progress end,
         finished_at = coalesce(finished_at, now())
   where room_id = p_room and user_id = me;

  -- 아직 안 끝낸 사람이 있으면 결과를 내지 않는다
  select count(*) into n_open from public.type_room_players
   where room_id = p_room and finished_at is null;
  if n_open > 0 then return result; end if;

  update public.type_rooms set status = 'finished' where id = p_room and status = 'playing';

  /* 등수 — 다 해낸 사람이 먼저, 그 안에서는 빠른 쪽. 못 해냈으면 많이 간 쪽.
     rank() 를 쓰므로 완전히 같으면 둘 다 1등이 되는데, 그건 이긴 것이 아니라
     비긴 것이다. 그 판을 '승'으로 세면 전적이 사실과 달라지므로 따로 센다. */
  create temporary table if not exists tmp_standing (user_id uuid, pos bigint) on commit drop;
  delete from tmp_standing;
  insert into tmp_standing
    select p.user_id,
           rank() over (order by (p.done_ms is null), p.done_ms nulls last, -p.progress)
    from public.type_room_players p
    where p.room_id = p_room;

  select count(*) into n_first from tmp_standing where pos = 1;

  for rec in select user_id, pos from tmp_standing loop
    insert into public.type_duel_records (user_id, wins, losses, draws)
    values (rec.user_id,
            case when n_first = 1 and rec.pos = 1 then 1 else 0 end,
            case when rec.pos > 1 then 1 else 0 end,
            case when n_first > 1 and rec.pos = 1 then 1 else 0 end)
    on conflict (user_id) do update
      set wins   = public.type_duel_records.wins   + case when n_first = 1 and rec.pos = 1 then 1 else 0 end,
          losses = public.type_duel_records.losses + case when rec.pos > 1 then 1 else 0 end,
          draws  = public.type_duel_records.draws  + case when n_first > 1 and rec.pos = 1 then 1 else 0 end,
          updated_at = now();

    result := result || jsonb_build_object(
      'id', rec.user_id, 'pos', rec.pos, 'draw', (n_first > 1 and rec.pos = 1));
  end loop;

  return result;
end $$;

/* 한 판 더. 끝난 방을 그대로 다시 쓴다 — 아이 둘이 계속 놀려면 방을 다시 만들게
   해서는 안 된다. 방장만 누를 수 있고, 판은 새로 뽑아 넘긴다. */
drop function if exists public.type_room_rematch(uuid);
create or replace function public.type_room_rematch(p_room uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.type_rooms;
begin
  select * into r from public.type_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if r.host_id <> me then raise exception '방장만 다시 시작할 수 있습니다'; end if;
  if r.status <> 'finished' then raise exception '아직 끝나지 않았습니다'; end if;

  update public.type_room_players
     set progress = 0, done_ms = null, finished_at = null
   where room_id = p_room;
  update public.type_rooms
     set status = 'waiting', payload = null, total = 0, start_at = null
   where id = p_room;
end $$;

drop function if exists public.type_room_leave(uuid);
create or replace function public.type_room_leave(p_room uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.type_rooms;
begin
  select * into r from public.type_rooms where id = p_room;
  if r.id is null then return; end if;
  delete from public.type_room_players where room_id = p_room and user_id = me;
  -- 방장이 나가거나 아무도 안 남으면 기다리던 방은 사라진다
  if (r.host_id = me and r.status <> 'playing')
     or not exists (select 1 from public.type_room_players where room_id = p_room) then
    delete from public.type_rooms where id = p_room;
  end if;
end $$;

drop function if exists public.type_my_duel_record();
create or replace function public.type_my_duel_record()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'wins',   coalesce((select wins   from public.type_duel_records where user_id = auth.uid()), 0),
    'losses', coalesce((select losses from public.type_duel_records where user_id = auth.uid()), 0),
    'draws',  coalesce((select draws  from public.type_duel_records where user_id = auth.uid()), 0))
$$;

grant execute on function public.type_writing_list()                    to authenticated;
grant execute on function public.type_writing_save(text, text, text, timestamptz) to authenticated;
grant execute on function public.type_writing_delete(text)              to authenticated;
grant execute on function public.type_room_create(text, text)           to authenticated;
grant execute on function public.type_room_join(text)                   to authenticated;
grant execute on function public.type_room_state(uuid)                  to authenticated;
grant execute on function public.type_room_start(uuid, text, int)       to authenticated;
grant execute on function public.type_room_progress(uuid, int)          to authenticated;
grant execute on function public.type_room_finish(uuid, int, boolean)   to authenticated;
grant execute on function public.type_room_rematch(uuid)                to authenticated;
grant execute on function public.type_room_leave(uuid)                  to authenticated;
grant execute on function public.type_my_duel_record()                  to authenticated;
