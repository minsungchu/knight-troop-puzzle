-- ═══════════════════════════════════════════════════════════════
--  패치 01 — session_token 을 밖에서 못 읽게 막는다
--
--  이미 schema.sql 을 적용한 프로젝트에만 실행하세요.
--  새로 만드는 프로젝트는 schema.sql 에 이미 반영되어 있습니다.
--
--  문제: profiles 의 SELECT 정책이 `using (true)` 라서 누구나 모든 열을 읽을 수
--        있었고, 거기에 session_token 이 섞여 있었다. 이 값만으로 로그인은 안
--        되지만 남에게 보일 이유가 없다.
--
--  해법: 테이블 단위 SELECT 를 거두고 공개해도 되는 열만 다시 열어 준다.
--        토큰의 기록과 대조는 SECURITY DEFINER 함수 안에서만 한다.
-- ═══════════════════════════════════════════════════════════════

-- 열 단위로 좁힌다.
-- (열 단위 REVOKE 는 테이블 단위 GRANT 가 살아 있으면 효과가 없으므로 먼저 거둔다)
revoke select on public.profiles from anon, authenticated;
grant  select (id, username, created_at) on public.profiles to anon, authenticated;

-- 이름을 바꿀 수 있으면 이미 올라간 랭킹 기록의 이름과 어긋난다.
-- session_token 갱신은 아래 claim_session() 이 대신하므로 이 정책은 필요 없다.
drop policy if exists profiles_update on public.profiles;

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

grant execute on function public.claim_session(uuid) to authenticated;
grant execute on function public.session_ok(uuid)    to authenticated;
