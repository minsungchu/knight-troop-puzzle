-- 타자 도장 — 진행 저장
--
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 실행하세요.
-- 이미 돌린 적이 있어도 다시 돌려도 됩니다.
--
-- 다른 표와 같은 방침입니다: RLS 를 켜되 정책은 읽기만 두고, 쓰기는 SECURITY DEFINER
-- 함수로만 합니다. 그래야 남의 진행을 고치거나 지울 길이 없습니다.
--
-- 항목(item) 하나가 화면 하나에 대응합니다.
--   stage:1 … stage:10  자리 익히기 단계 — 별 · 최고 타수 · 최고 정확도
--   words               낱말 연습     — 최고 타수 · 최고 정확도
--   castle              성 지키기     — 최고 점수
-- 한 표에 몰아 둔 것은 셋 다 '이 계정이 어디까지 했나' 하나로 쓰이기 때문입니다.

create table if not exists public.type_progress (
  user_id    uuid     not null references auth.users(id) on delete cascade,
  item       text     not null check (item ~ '^(stage:([1-9]|10)|words|castle)$'),
  stars      smallint not null default 0 check (stars between 0 and 3),
  best_cpm   int      not null default 0 check (best_cpm between 0 and 2000),
  best_acc   smallint not null default 0 check (best_acc between 0 and 100),
  best_score int      not null default 0 check (best_score between 0 and 100000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, item)
);

alter table public.type_progress enable row level security;

-- 읽기는 본인 것만. 남이 어디까지 했는지 들여다볼 이유가 없다.
drop policy if exists type_progress_read on public.type_progress;
create policy type_progress_read on public.type_progress
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
drop function if exists public.type_progress_get();
create or replace function public.type_progress_get()
returns table (item text, stars smallint, best_cpm int, best_acc smallint, best_score int)
language sql stable security definer set search_path = '' as $$
  select p.item, p.stars, p.best_cpm, p.best_acc, p.best_score
  from public.type_progress p
  where p.user_id = auth.uid()
  order by p.item
$$;

/* 한 항목의 기록을 남긴다.
   항상 '더 나은 쪽'만 남는다 — 같은 단계를 대충 다시 쳤다고 별이 깎이면 안 된다.
   기기를 옮겨 다녀도 합쳐지는 것은 이 규칙 하나 덕이다. */
drop function if exists public.type_progress_set(text, int, int, int, int);
create or replace function public.type_progress_set(
  p_item text, p_stars int, p_cpm int, p_acc int, p_score int)
returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  if p_item is null or p_item !~ '^(stage:([1-9]|10)|words|castle)$' then
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

grant execute on function public.type_progress_get() to authenticated;
grant execute on function public.type_progress_set(text, int, int, int, int) to authenticated;
