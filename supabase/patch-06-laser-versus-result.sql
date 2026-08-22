-- 레이저 대전 — 결과를 방에 남기고, 한 판 더 할 수 있게 한다
--
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하세요. 여러 번 돌려도 됩니다.
-- patch-03-laser-versus.sql 이 먼저 적용돼 있어야 합니다.
--
-- 고치는 것은 둘입니다.
--
--  1. 진 사람이 자기 급수가 어떻게 바뀌었는지 알 길이 없었습니다.
--     점수는 처음 다 깬 사람이 laser_room_finish 를 부를 때 한 번에 매겨지고,
--     그 결과는 부른 사람에게만 돌아갔습니다. 나머지는 방이 닫힌 뒤라
--     같은 함수를 부르면 '진행 중인 방이 아닙니다'로 튕겼습니다.
--     → 결과를 방에 적어 두고, 방 상태에 함께 실어 보냅니다.
--
--  2. 한 판 더 할 수 없었습니다. 끝난 방은 버리고 다시 만들어야 했는데,
--     둘이 계속 붙으려면 그때마다 코드를 새로 주고받아야 합니다.
--     → 방장이 끝난 방을 그대로 되돌립니다.

/* ══════════════ 결과 자리 ══════════════ */

alter table public.laser_rooms add column if not exists result jsonb;

/* ══════════════ 완주 ══════════════ */

/* 전부 깼다. 처음 다 깬 사람이 이긴다.
   점수 계산은 여기서 한다 — 클라이언트가 보내는 값을 믿을 수 없다.

/* ── 만들기 전에 지운다 ──
   create or replace 는 돌려주는 값의 모양이 달라지면 실패한다("cannot change return
   type of existing function"). 그러면 SQL Editor 는 거기서 멈추고, 서버에는 예전 함수가
   그대로 남는다. 실제로 그렇게 됐다 — 첫 배포판의 laser_room_create 는
   returns table (id uuid, code text) 였고, 그 id 라는 이름이 profiles.id 와 부딪쳐
   "column reference id is ambiguous" 로 죽었다. 고친 판을 올리려 해도 반환형이 달라
   갈아 끼울 수 없었으니, 고치는 패치를 아무리 실행해도 서버는 계속 옛것을 썼다.

   먼저 지우고 새로 만들면 그 벽이 없다. 권한은 파일 끝에서 다시 준다. */

   patch-03 과 달라진 곳:
     · 이미 닫힌 방이면 튕기지 않고 적어 둔 결과를 그대로 돌려준다.
       늦게 끝낸 사람도 자기 등수와 점수 변화를 볼 수 있어야 한다.
     · 매긴 결과를 laser_rooms.result 에 적는다. */
drop function if exists public.laser_room_finish(uuid, int);
create or replace function public.laser_room_finish(p_room uuid, p_ms int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); r public.laser_rooms;
  total int; n int; rec record; k numeric; d numeric;
  res jsonb := '[]'::jsonb;    -- 이름을 result 로 두면 아래 set result = result 가
                               -- 열인지 변수인지 갈리지 않아 죽는다
begin
  select * into r from public.laser_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if not exists (select 1 from public.laser_room_players where room_id = p_room and user_id = me) then
    raise exception '이 방의 참가자가 아닙니다';
  end if;
  if r.status = 'waiting' then raise exception '아직 시작하지 않았습니다'; end if;

  total := r.n_low + r.n_mid + r.n_high;

  -- 늦게 끝냈어도 기록은 남긴다. 이미 적힌 시간은 덮지 않는다.
  update public.laser_room_players
     set solved = total, finish_ms = coalesce(finish_ms, p_ms), finished_at = coalesce(finished_at, now())
   where room_id = p_room and user_id = me;

  /* 방을 닫는 자리를 먼저 잡는다. 잡은 사람이 점수를 매긴다 —
     둘이 거의 동시에 끝내도 점수가 두 번 매겨지지 않는다. */
  update public.laser_rooms set status = 'finished'
   where id = p_room and status = 'playing';

  if not found then
    -- 남이 이미 닫았다. 그때 매긴 결과를 그대로 돌려준다.
    select rr.result into res from public.laser_rooms rr where rr.id = p_room;
    return coalesce(res, '[]'::jsonb);
  end if;

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
      order by a.pos            -- 등수대로 담는다. 순서를 안 정하면 화면마다 줄이 뒤바뀐다.
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

      res := res || jsonb_build_object(
        'id', rec.user_id, 'pos', rec.pos, 'before', rec.rating,
        'after', greatest(100, rec.rating + d), 'delta', d);
    end loop;
  end if;

  update public.laser_rooms set result = res where id = p_room;
  return res;
end $$;

/* ══════════════ 방 상태 ══════════════ */

/* 결과를 함께 싣는다 — 진 사람도 자기 등수와 점수 변화를 봐야 한다.
   join_code 는 여전히 돌려주지 않는다. */
drop function if exists public.laser_room_state(uuid);
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
    'result', r.result,
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

/* ══════════════ 한 판 더 ══════════════ */

/* 끝난 방을 그대로 되돌린다. 판 묶음은 비운다 — 다시 시작할 때 새로 뽑아야
   같은 방에서 두 번 놀아도 같은 판이 나오지 않는다. */
drop function if exists public.laser_room_rematch(uuid);
create or replace function public.laser_room_rematch(p_room uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); r public.laser_rooms;
begin
  select * into r from public.laser_rooms where id = p_room;
  if r.id is null then raise exception '그런 방이 없습니다'; end if;
  if r.host_id <> me then raise exception '방장만 다시 시작할 수 있습니다'; end if;
  if r.status <> 'finished' then raise exception '끝난 방이 아닙니다'; end if;

  update public.laser_room_players
     set solved = 0, finish_ms = null, finished_at = null
   where room_id = p_room;

  update public.laser_rooms
     set status = 'waiting', boards = null, start_at = null, result = null
   where id = p_room;
end $$;

grant execute on function public.laser_room_rematch(uuid) to authenticated;

/* ══════════════ 방 이름 ══════════════ */

/* 이름을 안 적으면 '하늘 의 방' 처럼 조사 앞이 띄어져 있었다. 붙여 쓴다.
   나머지는 patch-03 과 같다. */
drop function if exists public.laser_room_create(text, boolean, text, int, int, int, int);
create or replace function public.laser_room_create(
  p_title text, p_private boolean, p_join_code text,
  p_max int, p_low int, p_mid int, p_high int
) returns jsonb
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
  values (c, me, coalesce(nullif(trim(p_title), ''), nm || '의 방'),
          coalesce(p_private, false), case when p_private then trim(p_join_code) end,
          greatest(2, least(4, coalesce(p_max, 2))),
          coalesce(p_low,0), coalesce(p_mid,0), coalesce(p_high,0))
  returning * into r;

  insert into public.laser_room_players (room_id, user_id, username, seat)
  values (r.id, me, nm, 0);

  return jsonb_build_object('id', r.id, 'code', r.code);
end $$;
