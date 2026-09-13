-- 타자 도장 — 영타 진도를 담을 자리
--
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하세요. 여러 번 돌려도 됩니다.
-- patch-04, patch-05 가 먼저 적용돼 있어야 합니다.
--
-- 영타는 한글과 같은 뼈대(열 단계 + 낱말)를 쓰되 기록은 따로 남깁니다.
-- 'stage:3' 과 'en:stage:3' 은 다른 기록입니다 — 한글 3단계를 뗀 것이 영문 3단계를
-- 뗀 것으로 둔갑하면 지도가 거짓말을 하게 됩니다.
--
-- 패치를 안 돌려도 영타는 그대로 됩니다. 기록이 이 브라우저에만 남을 뿐입니다.

alter table public.type_progress drop constraint if exists type_progress_item_check;
alter table public.type_progress add constraint type_progress_item_check
  check (item ~ '^(en:)?(stage:([1-9]|10)|words|castle|copy)$');

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
  if p_item is null or p_item !~ '^(en:)?(stage:([1-9]|10)|words|castle|copy)$' then
    raise exception '항목이 올바르지 않습니다';
  end if;

  -- 값 범위는 patch-05 와 같다. 바뀐 것은 항목 이름 규칙뿐이다.
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

grant execute on function public.type_progress_set(text, int, int, int, int) to authenticated;
