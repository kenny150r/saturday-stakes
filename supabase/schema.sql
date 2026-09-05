-- Saturday Stakes + family-app allowlist for House Fund Tracker
-- (gcqjjpbshoogojsozflp). Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS.

-- ---------------------------------------------------------------------------
-- Family allowlist (betting friends must not read/write family-tree data)
-- ---------------------------------------------------------------------------

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create table if not exists public.family_app_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.family_app_allowlist enable row level security;
revoke all on table public.family_app_allowlist from public, anon, authenticated;

insert into public.family_app_allowlist (email)
select lower(email)
from auth.users
where email is not null
on conflict (email) do nothing;

create or replace function app_private.is_family_app_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.family_app_allowlist a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function app_private.is_family_app_user() from public, anon;
grant execute on function app_private.is_family_app_user() to authenticated, service_role;

drop policy if exists fam_sel on public.family_members;
drop policy if exists fam_ins on public.family_members;
drop policy if exists fam_upd on public.family_members;
drop policy if exists fam_del on public.family_members;
create policy fam_sel on public.family_members
  for select to authenticated using (app_private.is_family_app_user());
create policy fam_ins on public.family_members
  for insert to authenticated with check (app_private.is_family_app_user());
create policy fam_upd on public.family_members
  for update to authenticated
  using (app_private.is_family_app_user())
  with check (app_private.is_family_app_user());
create policy fam_del on public.family_members
  for delete to authenticated using (app_private.is_family_app_user());

drop policy if exists rel_sel on public.family_relationships;
drop policy if exists rel_ins on public.family_relationships;
drop policy if exists rel_upd on public.family_relationships;
drop policy if exists rel_del on public.family_relationships;
create policy rel_sel on public.family_relationships
  for select to authenticated using (app_private.is_family_app_user());
create policy rel_ins on public.family_relationships
  for insert to authenticated with check (app_private.is_family_app_user());
create policy rel_del on public.family_relationships
  for delete to authenticated using (app_private.is_family_app_user());

drop policy if exists recipes_select_authenticated on public.recipes;
drop policy if exists recipes_insert_own on public.recipes;
drop policy if exists recipes_update_own on public.recipes;
drop policy if exists recipes_delete_own on public.recipes;
create policy recipes_select_authenticated on public.recipes
  for select to authenticated using (app_private.is_family_app_user());
create policy recipes_insert_own on public.recipes
  for insert to authenticated
  with check (app_private.is_family_app_user() and auth.uid() = author_id);
create policy recipes_update_own on public.recipes
  for update to authenticated
  using (app_private.is_family_app_user() and auth.uid() = author_id)
  with check (app_private.is_family_app_user() and auth.uid() = author_id);
create policy recipes_delete_own on public.recipes
  for delete to authenticated
  using (app_private.is_family_app_user() and auth.uid() = author_id);

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (app_private.is_family_app_user());
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (app_private.is_family_app_user() and auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id and app_private.is_family_app_user())
  with check (auth.uid() = id and app_private.is_family_app_user());

drop policy if exists households_insert on public.households;
create policy households_insert on public.households
  for insert to public
  with check (app_private.is_family_app_user());

drop policy if exists members_insert on public.household_members;
create policy members_insert on public.household_members
  for insert to public
  with check (
    app_private.is_family_app_user()
    and ((user_id = auth.uid()) or is_household_member(household_id))
  );

-- ---------------------------------------------------------------------------
-- Saturday Stakes
-- ---------------------------------------------------------------------------

create schema if not exists ss_private;
revoke all on schema ss_private from public, anon;
grant usage on schema ss_private to authenticated, service_role;

create table if not exists public.ss_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(trim(display_name)) between 1 and 32),
  color text not null default '#E4B84A',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.ss_invite_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses int not null default 50 check (max_uses > 0),
  use_count int not null default 0 check (use_count >= 0)
);

create table if not exists public.ss_pending_members (
  email text primary key,
  display_name text not null
    check (char_length(trim(display_name)) between 1 and 32),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.ss_weeks (
  id uuid primary key default gen_random_uuid(),
  saturday_date date not null unique,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'locked')),
  winner_user_ids uuid[] not null default '{}',
  locked_at timestamptz
);

create table if not exists public.ss_week_entries (
  week_id uuid not null references public.ss_weeks (id) on delete cascade,
  user_id uuid not null references public.ss_members (user_id) on delete cascade,
  starting_bankroll numeric(12, 2) not null default 50,
  buyin numeric(12, 2) not null default 10,
  created_at timestamptz not null default now(),
  primary key (week_id, user_id)
);

create table if not exists public.ss_bets (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.ss_weeks (id) on delete cascade,
  user_id uuid not null references public.ss_members (user_id) on delete cascade,
  kind text not null check (kind in ('straight', 'parlay')),
  stake numeric(12, 2) not null check (stake > 0),
  combined_american numeric not null,
  status text not null default 'open'
    check (status in ('open', 'won', 'lost', 'push', 'void')),
  placed_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists public.ss_bet_legs (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references public.ss_bets (id) on delete cascade,
  position int not null default 0,
  description text not null check (char_length(trim(description)) between 1 and 200),
  american_odds numeric not null,
  kalshi_ticker text,
  kalshi_side text check (kalshi_side is null or kalshi_side in ('yes', 'no')),
  entry_yes_cents numeric
);

create table if not exists public.ss_market_quotes (
  ticker text primary key,
  yes_cents numeric not null,
  as_of timestamptz not null default now(),
  title text
);

create table if not exists public.ss_bankroll_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.ss_weeks (id) on delete cascade,
  user_id uuid not null references public.ss_members (user_id) on delete cascade,
  captured_at timestamptz not null default now(),
  bankroll numeric(12, 2) not null
);

create index if not exists ss_bets_week_user_idx on public.ss_bets (week_id, user_id);
create index if not exists ss_bet_legs_bet_idx on public.ss_bet_legs (bet_id);
create index if not exists ss_snapshots_week_time_idx
  on public.ss_bankroll_snapshots (week_id, captured_at);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create or replace function ss_private.is_ss_member(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.ss_members m where m.user_id = p_uid
  );
$$;

create or replace function ss_private.is_ss_admin(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.ss_members m
    where m.user_id = p_uid and m.is_admin
  );
$$;

create or replace function ss_private.next_member_color()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_color text;
  colors text[] := array[
    '#E4B84A','#3D8B5F','#F97316','#60A5FA','#C084FC',
    '#F472B6','#22D3EE','#A3E635','#FB7185','#FBBF24'
  ];
begin
  select x.c into v_color
  from unnest(colors) with ordinality as x(c, n)
  order by (select count(*) from public.ss_members m where m.color = x.c), n
  limit 1;
  return coalesce(v_color, '#E4B84A');
end;
$$;

create or replace function ss_private.american_to_decimal(american numeric)
returns numeric
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when american > 0 then american / 100.0 + 1
    when american < 0 then 100.0 / abs(american) + 1
    else null
  end;
$$;

create or replace function ss_private.decimal_to_american(p_dec numeric)
returns numeric
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_dec is null or p_dec <= 1 then null
    when p_dec >= 2 then round((p_dec - 1) * 100)
    else round(-100.0 / (p_dec - 1))
  end;
$$;

create or replace function ss_private.contest_saturday(p_at timestamptz default now())
returns date
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  pt timestamp;
  d date;
  dow int;
begin
  pt := timezone('America/Los_Angeles', p_at);
  d := pt::date;
  dow := extract(dow from pt)::int;
  if dow = 0 then
    if pt::time < time '02:00' then
      return d - 1;
    else
      return d + 6;
    end if;
  elsif dow = 6 then
    return d;
  else
    return d + (6 - dow);
  end if;
end;
$$;

create or replace function ss_private.ensure_week(p_saturday date default null)
returns public.ss_weeks
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_sat date;
  v_week public.ss_weeks;
  v_opens timestamptz;
  v_closes timestamptz;
begin
  v_sat := coalesce(p_saturday, ss_private.contest_saturday());
  v_opens := (v_sat::timestamp) at time zone 'America/Los_Angeles';
  v_closes := ((v_sat + 1)::date::timestamp + time '02:00') at time zone 'America/Los_Angeles';

  insert into public.ss_weeks (saturday_date, opens_at, closes_at, status)
  values (v_sat, v_opens, v_closes, 'open')
  on conflict (saturday_date) do update
    set saturday_date = excluded.saturday_date
  returning * into v_week;

  return v_week;
end;
$$;

create or replace function ss_private.join_week(p_week_id uuid)
returns public.ss_week_entries
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_week public.ss_weeks;
  v_entry public.ss_week_entries;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not ss_private.is_ss_member(v_uid) then
    raise exception 'Not a Saturday Stakes member' using errcode = '42501';
  end if;

  if p_week_id is null then
    v_week := ss_private.ensure_week(null);
  else
    select * into v_week from public.ss_weeks where id = p_week_id;
    if not found then
      raise exception 'Week not found';
    end if;
  end if;

  if v_week.status <> 'open' then
    select * into v_entry
    from public.ss_week_entries
    where week_id = v_week.id and user_id = v_uid;
    if not found then
      raise exception 'This week is locked';
    end if;
    return v_entry;
  end if;

  insert into public.ss_week_entries (week_id, user_id)
  values (v_week.id, v_uid)
  on conflict (week_id, user_id) do update
    set user_id = excluded.user_id
  returning * into v_entry;

  return v_entry;
end;
$$;

create or replace function ss_private.redeem_invite(p_code text, p_display_name text)
returns public.ss_members
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_member public.ss_members;
  v_inv public.ss_invite_codes;
  v_count int;
  v_color text;
  v_name text;
  colors text[] := array[
    '#E4B84A','#3D8B5F','#F97316','#60A5FA','#C084FC',
    '#F472B6','#22D3EE','#A3E635','#FB7185','#FBBF24'
  ];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_name := trim(p_display_name);
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 32 then
    raise exception 'Display name must be 1–32 characters';
  end if;

  if exists (select 1 from public.ss_members m where m.user_id = auth.uid()) then
    select * into v_member from public.ss_members where user_id = auth.uid();
    return v_member;
  end if;

  select * into v_inv
  from public.ss_invite_codes c
  where (c.expires_at is null or c.expires_at > now())
    and c.use_count < c.max_uses
    and c.code_hash = extensions.crypt(trim(p_code), c.code_hash)
  order by c.created_at
  limit 1
  for update;

  if not found then
    raise exception 'Invalid or expired invite code';
  end if;

  update public.ss_invite_codes
  set use_count = use_count + 1
  where id = v_inv.id;

  select count(*) into v_count from public.ss_members;

  select x.c into v_color
  from unnest(colors) with ordinality as x(c, n)
  order by (select count(*) from public.ss_members m where m.color = x.c), n
  limit 1;

  insert into public.ss_members (user_id, display_name, color, is_admin)
  values (auth.uid(), v_name, coalesce(v_color, '#E4B84A'), v_count = 0)
  returning * into v_member;

  perform ss_private.join_week(null);
  return v_member;
end;
$$;

create or replace function ss_private.leg_entry_cents(leg public.ss_bet_legs)
returns numeric
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when leg.kalshi_side = 'yes' then leg.entry_yes_cents
    when leg.kalshi_side = 'no' then 100 - leg.entry_yes_cents
    else null
  end;
$$;

create or replace function ss_private.leg_current_cents(leg public.ss_bet_legs)
returns numeric
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when leg.kalshi_ticker is null then null
    when leg.kalshi_side = 'yes' then q.yes_cents
    when leg.kalshi_side = 'no' then 100 - q.yes_cents
    else null
  end
  from public.ss_market_quotes q
  where q.ticker = leg.kalshi_ticker;
$$;

create or replace function ss_private.bet_mark(p_bet public.ss_bets)
returns numeric
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_leg public.ss_bet_legs;
  v_entry numeric;
  v_cur numeric;
  v_entry_prob numeric := 1;
  v_cur_prob numeric := 1;
  v_n int := 0;
  v_linked boolean := true;
begin
  if p_bet.status = 'void' or p_bet.status = 'push' then
    return p_bet.stake;
  elsif p_bet.status = 'lost' then
    return 0;
  elsif p_bet.status = 'won' then
    return p_bet.stake * ss_private.american_to_decimal(p_bet.combined_american);
  end if;

  for v_leg in
    select * from public.ss_bet_legs l where l.bet_id = p_bet.id order by l.position
  loop
    v_n := v_n + 1;
    if v_leg.kalshi_ticker is null or v_leg.kalshi_side is null or v_leg.entry_yes_cents is null then
      v_linked := false;
      exit;
    end if;
    v_entry := ss_private.leg_entry_cents(v_leg);
    v_cur := ss_private.leg_current_cents(v_leg);
    if v_entry is null or v_cur is null or v_entry <= 0 then
      v_linked := false;
      exit;
    end if;
    v_entry_prob := v_entry_prob * (v_entry / 100.0);
    v_cur_prob := v_cur_prob * (v_cur / 100.0);
  end loop;

  if not v_linked or v_n = 0 then
    return p_bet.stake;
  end if;

  if p_bet.kind = 'straight' then
    return (p_bet.stake / (v_entry / 100.0)) * (v_cur / 100.0);
  end if;

  if v_entry_prob <= 0 then
    return p_bet.stake;
  end if;
  return p_bet.stake * (v_cur_prob / v_entry_prob);
end;
$$;

create or replace function ss_private.bankroll(p_week_id uuid, p_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_start numeric;
  v_bet public.ss_bets;
  v_value numeric;
begin
  select e.starting_bankroll into v_start
  from public.ss_week_entries e
  where e.week_id = p_week_id and e.user_id = p_user_id;
  if v_start is null then
    return 0;
  end if;
  v_value := v_start;
  for v_bet in
    select * from public.ss_bets b
    where b.week_id = p_week_id and b.user_id = p_user_id
  loop
    if v_bet.status = 'void' then
      continue;
    end if;
    v_value := v_value - v_bet.stake + ss_private.bet_mark(v_bet);
  end loop;
  return round(v_value, 2);
end;
$$;

create or replace function ss_private.cash_on_hand(p_week_id uuid, p_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_start numeric;
  v_bet public.ss_bets;
  v_cash numeric;
begin
  select e.starting_bankroll into v_start
  from public.ss_week_entries e
  where e.week_id = p_week_id and e.user_id = p_user_id;
  if v_start is null then
    return 0;
  end if;
  v_cash := v_start;
  for v_bet in
    select * from public.ss_bets b
    where b.week_id = p_week_id and b.user_id = p_user_id
  loop
    if v_bet.status = 'void' then
      continue;
    end if;
    v_cash := v_cash - v_bet.stake;
    if v_bet.status = 'won' then
      v_cash := v_cash + v_bet.stake * ss_private.american_to_decimal(v_bet.combined_american);
    elsif v_bet.status = 'push' then
      v_cash := v_cash + v_bet.stake;
    end if;
  end loop;
  return round(v_cash, 2);
end;
$$;

create or replace function ss_private.qualifying_count(p_week_id uuid, p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select count(*)::int
  from public.ss_bets b
  where b.week_id = p_week_id
    and b.user_id = p_user_id
    and b.status <> 'void'
    and ss_private.american_to_decimal(b.combined_american) >= 1.25;
$$;

create or replace function ss_private.place_bet(
  p_week_id uuid,
  p_kind text,
  p_stake numeric,
  p_legs jsonb
)
returns public.ss_bets
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_week public.ss_weeks;
  v_entry public.ss_week_entries;
  v_cash numeric;
  v_leg jsonb;
  v_odds numeric[];
  v_combined numeric;
  v_bet public.ss_bets;
  v_i int := 0;
  v_desc text;
  v_am numeric;
  v_ticker text;
  v_side text;
  v_cents numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not ss_private.is_ss_member(v_uid) then
    raise exception 'Not a Saturday Stakes member' using errcode = '42501';
  end if;
  if p_kind not in ('straight', 'parlay') then
    raise exception 'Kind must be straight or parlay';
  end if;
  if p_stake is null or p_stake <= 0 then
    raise exception 'Stake must be positive';
  end if;
  if jsonb_typeof(p_legs) <> 'array' then
    raise exception 'Legs required';
  end if;
  if p_kind = 'straight' and jsonb_array_length(p_legs) <> 1 then
    raise exception 'A straight needs exactly one pick';
  end if;
  if p_kind = 'parlay' and jsonb_array_length(p_legs) < 2 then
    raise exception 'A parlay needs at least two legs';
  end if;

  select * into v_week from public.ss_weeks where id = p_week_id;
  if not found then
    raise exception 'Week not found';
  end if;
  if v_week.status <> 'open' then
    raise exception 'This week is locked';
  end if;

  v_entry := ss_private.join_week(p_week_id);

  select * into v_entry
  from public.ss_week_entries
  where week_id = p_week_id and user_id = v_uid
  for update;

  v_cash := ss_private.cash_on_hand(p_week_id, v_uid);
  if p_stake > v_cash + 0.001 then
    raise exception 'Stake exceeds cash on hand ($%)', v_cash;
  end if;

  v_odds := array[]::numeric[];
  for v_leg in select * from jsonb_array_elements(p_legs)
  loop
    v_desc := trim(v_leg->>'description');
    v_am := (v_leg->>'american_odds')::numeric;
    if v_desc is null or char_length(v_desc) < 1 then
      raise exception 'Each pick needs a description';
    end if;
    if v_am is null or v_am = 0 or abs(v_am) < 100 then
      raise exception 'American odds must be ±100 or longer';
    end if;
    v_odds := array_append(v_odds, v_am);
  end loop;

  v_combined := ss_private.decimal_to_american(
    (select round(exp(sum(ln(ss_private.american_to_decimal(o)))), 8) from unnest(v_odds) o)
  );

  insert into public.ss_bets (week_id, user_id, kind, stake, combined_american, status)
  values (p_week_id, v_uid, p_kind, round(p_stake, 2), v_combined, 'open')
  returning * into v_bet;

  for v_leg in select * from jsonb_array_elements(p_legs)
  loop
    v_desc := trim(v_leg->>'description');
    v_am := (v_leg->>'american_odds')::numeric;
    v_ticker := nullif(trim(v_leg->>'kalshi_ticker'), '');
    v_side := nullif(trim(v_leg->>'kalshi_side'), '');
    v_cents := nullif(v_leg->>'entry_yes_cents', '')::numeric;
    insert into public.ss_bet_legs (
      bet_id, position, description, american_odds, kalshi_ticker, kalshi_side, entry_yes_cents
    ) values (
      v_bet.id, v_i, v_desc, v_am, v_ticker, v_side, v_cents
    );
    v_i := v_i + 1;
  end loop;

  return v_bet;
end;
$$;

create or replace function ss_private.settle_bet(p_bet_id uuid, p_status text)
returns public.ss_bets
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_bet public.ss_bets;
  v_week public.ss_weeks;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_status not in ('won', 'lost', 'push', 'void') then
    raise exception 'Invalid result';
  end if;

  select * into v_bet from public.ss_bets where id = p_bet_id for update;
  if not found then
    raise exception 'Bet not found';
  end if;
  if v_bet.user_id <> v_uid and not ss_private.is_ss_admin(v_uid) then
    raise exception 'You can only settle your own bets' using errcode = '42501';
  end if;
  if v_bet.status <> 'open' then
    raise exception 'Bet is already settled';
  end if;

  select * into v_week from public.ss_weeks where id = v_bet.week_id;
  if v_week.status <> 'open' then
    raise exception 'This week is locked';
  end if;

  update public.ss_bets
  set status = p_status, settled_at = now()
  where id = p_bet_id
  returning * into v_bet;

  return v_bet;
end;
$$;

create or replace function ss_private.lock_week(p_week_id uuid)
returns public.ss_weeks
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_week public.ss_weeks;
  v_winners uuid[] := '{}';
  v_max numeric;
  r record;
begin
  if auth.uid() is not null and not ss_private.is_ss_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  select * into v_week from public.ss_weeks where id = p_week_id for update;
  if not found then
    raise exception 'Week not found';
  end if;
  if v_week.status = 'locked' then
    return v_week;
  end if;

  for r in
    select e.user_id, ss_private.bankroll(e.week_id, e.user_id) as br,
           ss_private.qualifying_count(e.week_id, e.user_id) as q
    from public.ss_week_entries e
    where e.week_id = p_week_id
  loop
    if r.q >= 3 then
      if v_max is null or r.br > v_max then
        v_max := r.br;
        v_winners := array[r.user_id];
      elsif r.br = v_max then
        v_winners := v_winners || r.user_id;
      end if;
    end if;
  end loop;

  update public.ss_weeks
  set status = 'locked',
      locked_at = now(),
      winner_user_ids = v_winners
  where id = p_week_id
  returning * into v_week;

  return v_week;
end;
$$;

create or replace function ss_private.record_snapshots(p_week_id uuid)
returns int
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  n int := 0;
  r record;
  v_at timestamptz := now();
begin
  insert into public.ss_bankroll_snapshots (week_id, user_id, captured_at, bankroll)
  select e.week_id, e.user_id, v_at, ss_private.bankroll(e.week_id, e.user_id)
  from public.ss_week_entries e
  where e.week_id = p_week_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function ss_private.create_invite(p_max_uses int, p_expires_at timestamptz)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_code text;
begin
  if not ss_private.is_ss_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  v_code := 'SAT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.ss_invite_codes (code_hash, created_by, expires_at, max_uses)
  values (
    extensions.crypt(v_code, extensions.gen_salt('bf')),
    auth.uid(),
    p_expires_at,
    greatest(coalesce(p_max_uses, 20), 1)
  );
  return v_code;
end;
$$;

create or replace function ss_private.add_member(p_email text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email text;
  v_name text;
  v_uid uuid;
  v_member public.ss_members;
  v_week public.ss_weeks;
begin
  if not ss_private.is_ss_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  v_email := lower(trim(p_email));
  v_name := trim(p_display_name);
  if v_email is null or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'Enter a valid email';
  end if;
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 32 then
    raise exception 'Display name must be 1–32 characters';
  end if;

  select u.id into v_uid
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_uid is not null then
    if exists (select 1 from public.ss_members m where m.user_id = v_uid) then
      raise exception 'That person is already in the club';
    end if;

    insert into public.ss_members (user_id, display_name, color, is_admin)
    values (v_uid, v_name, ss_private.next_member_color(), false)
    returning * into v_member;

    delete from public.ss_pending_members where email = v_email;

    v_week := ss_private.ensure_week(null);
    if v_week.status = 'open' then
      insert into public.ss_week_entries (week_id, user_id)
      values (v_week.id, v_uid)
      on conflict (week_id, user_id) do nothing;
    end if;

    return jsonb_build_object('status', 'joined', 'display_name', v_member.display_name);
  end if;

  insert into public.ss_pending_members (email, display_name, created_by)
  values (v_email, v_name, auth.uid())
  on conflict (email) do update
    set display_name = excluded.display_name,
        created_by = excluded.created_by;

  return jsonb_build_object('status', 'pending', 'email', v_email, 'display_name', v_name);
end;
$$;

create or replace function ss_private.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_admin boolean;
  v_admin_count int;
begin
  if not ss_private.is_ss_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'Missing member';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot remove yourself';
  end if;
  if not exists (select 1 from public.ss_members m where m.user_id = p_user_id) then
    raise exception 'Member not found';
  end if;

  select m.is_admin into v_admin from public.ss_members m where m.user_id = p_user_id;
  select count(*) into v_admin_count from public.ss_members m where m.is_admin;
  if v_admin and v_admin_count <= 1 then
    raise exception 'Cannot remove the last admin';
  end if;

  delete from public.ss_members where user_id = p_user_id;
end;
$$;

create or replace function ss_private.remove_pending(p_email text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not ss_private.is_ss_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  delete from public.ss_pending_members where email = lower(trim(p_email));
end;
$$;

create or replace function ss_private.list_pending()
returns table (email text, display_name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not ss_private.is_ss_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  return query
    select p.email, p.display_name, p.created_at
    from public.ss_pending_members p
    order by p.created_at;
end;
$$;

create or replace function ss_private.list_roster()
returns table (
  user_id uuid,
  display_name text,
  email text,
  is_admin boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not ss_private.is_ss_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.display_name, lower(u.email), m.is_admin, m.created_at
    from public.ss_members m
    join auth.users u on u.id = m.user_id
    order by m.created_at;
end;
$$;

create or replace function ss_private.claim_pending()
returns setof public.ss_members
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email text;
  v_name text;
  v_member public.ss_members;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if exists (select 1 from public.ss_members m where m.user_id = auth.uid()) then
    return query select * from public.ss_members where user_id = auth.uid();
    return;
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    return;
  end if;

  select p.display_name into v_name
  from public.ss_pending_members p
  where p.email = v_email;

  if v_name is null then
    return;
  end if;

  insert into public.ss_members (user_id, display_name, color, is_admin)
  values (auth.uid(), v_name, ss_private.next_member_color(), false)
  returning * into v_member;

  delete from public.ss_pending_members where email = v_email;
  perform ss_private.join_week(null);
  return next v_member;
end;
$$;

create or replace function ss_private.delete_bet(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_bet public.ss_bets;
  v_week public.ss_weeks;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_bet from public.ss_bets b where b.id = p_bet_id for update;
  if not found then
    raise exception 'Bet not found';
  end if;

  select * into v_week from public.ss_weeks w where w.id = v_bet.week_id;
  if v_week.status <> 'open' then
    raise exception 'This week is locked';
  end if;

  if v_bet.user_id <> v_uid and not ss_private.is_ss_admin(v_uid) then
    raise exception 'You can only delete your own bets' using errcode = '42501';
  end if;

  delete from public.ss_bets where id = p_bet_id;
end;
$$;

create or replace function ss_private.upsert_quote(p_ticker text, p_yes_cents numeric, p_title text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.ss_market_quotes (ticker, yes_cents, as_of, title)
  values (p_ticker, p_yes_cents, now(), p_title)
  on conflict (ticker) do update
    set yes_cents = excluded.yes_cents,
        as_of = now(),
        title = coalesce(excluded.title, public.ss_market_quotes.title);
end;
$$;

create or replace function ss_private.current_week_row()
returns public.ss_weeks
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not ss_private.is_ss_member() then
    raise exception 'Not a Saturday Stakes member' using errcode = '42501';
  end if;
  return ss_private.ensure_week(null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers (invoker) so PostgREST can call them without exposing ss_private
-- ---------------------------------------------------------------------------

create or replace function public.ss_redeem_invite(p_code text, p_display_name text)
returns public.ss_members
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.redeem_invite(p_code, p_display_name);
$$;

create or replace function public.ss_join_week(p_week_id uuid default null)
returns public.ss_week_entries
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.join_week(p_week_id);
$$;

create or replace function public.ss_current_week()
returns public.ss_weeks
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.current_week_row();
$$;

create or replace function public.ss_place_bet(
  p_week_id uuid,
  p_kind text,
  p_stake numeric,
  p_legs jsonb
)
returns public.ss_bets
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.place_bet(p_week_id, p_kind, p_stake, p_legs);
$$;

create or replace function public.ss_settle_bet(p_bet_id uuid, p_status text)
returns public.ss_bets
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.settle_bet(p_bet_id, p_status);
$$;

create or replace function public.ss_lock_week(p_week_id uuid)
returns public.ss_weeks
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.lock_week(p_week_id);
$$;

create or replace function public.ss_create_invite(p_max_uses int default 20, p_expires_at timestamptz default null)
returns text
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select ss_private.create_invite(p_max_uses, p_expires_at);
$$;

create or replace function public.ss_record_snapshots(p_week_id uuid)
returns int
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select ss_private.record_snapshots(p_week_id);
$$;

create or replace function public.ss_upsert_quote(p_ticker text, p_yes_cents numeric, p_title text default null)
returns void
language plpgsql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
begin
  perform ss_private.upsert_quote(p_ticker, p_yes_cents, p_title);
end;
$$;

create or replace function public.ss_my_member()
returns public.ss_members
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select * from public.ss_members where user_id = auth.uid();
$$;

create or replace function public.ss_add_member(p_email text, p_display_name text)
returns jsonb
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select ss_private.add_member(p_email, p_display_name);
$$;

create or replace function public.ss_remove_member(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select ss_private.remove_member(p_user_id);
$$;

create or replace function public.ss_remove_pending(p_email text)
returns void
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select ss_private.remove_pending(p_email);
$$;

create or replace function public.ss_list_pending()
returns table (email text, display_name text, created_at timestamptz)
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.list_pending();
$$;

create or replace function public.ss_list_roster()
returns table (
  user_id uuid,
  display_name text,
  email text,
  is_admin boolean,
  created_at timestamptz
)
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.list_roster();
$$;

create or replace function public.ss_claim_pending()
returns setof public.ss_members
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select * from ss_private.claim_pending();
$$;

create or replace function public.ss_delete_bet(p_bet_id uuid)
returns void
language sql
security invoker
set search_path = ss_private, public, pg_catalog
as $$
  select ss_private.delete_bet(p_bet_id);
$$;

grant execute on all functions in schema ss_private to authenticated, service_role;
grant execute on function public.ss_redeem_invite(text, text) to authenticated;
grant execute on function public.ss_join_week(uuid) to authenticated;
grant execute on function public.ss_current_week() to authenticated;
grant execute on function public.ss_place_bet(uuid, text, numeric, jsonb) to authenticated;
grant execute on function public.ss_settle_bet(uuid, text) to authenticated;
grant execute on function public.ss_lock_week(uuid) to authenticated, service_role;
grant execute on function public.ss_create_invite(int, timestamptz) to authenticated;
grant execute on function public.ss_record_snapshots(uuid) to service_role;
grant execute on function public.ss_upsert_quote(text, numeric, text) to service_role;
grant execute on function public.ss_my_member() to authenticated;
grant execute on function public.ss_add_member(text, text) to authenticated;
grant execute on function public.ss_remove_member(uuid) to authenticated;
grant execute on function public.ss_remove_pending(text) to authenticated;
grant execute on function public.ss_list_pending() to authenticated;
grant execute on function public.ss_list_roster() to authenticated;
grant execute on function public.ss_claim_pending() to authenticated;
grant execute on function public.ss_delete_bet(uuid) to authenticated;

revoke execute on function public.ss_upsert_quote(text, numeric, text) from public, anon, authenticated;
revoke execute on function public.ss_record_snapshots(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ss_members enable row level security;
alter table public.ss_invite_codes enable row level security;
alter table public.ss_pending_members enable row level security;
alter table public.ss_weeks enable row level security;
alter table public.ss_week_entries enable row level security;
alter table public.ss_bets enable row level security;
alter table public.ss_bet_legs enable row level security;
alter table public.ss_market_quotes enable row level security;
alter table public.ss_bankroll_snapshots enable row level security;

revoke all on public.ss_members from public, anon;
revoke all on public.ss_invite_codes from public, anon, authenticated;
revoke all on public.ss_pending_members from public, anon, authenticated;
revoke all on public.ss_weeks from public, anon;
revoke all on public.ss_week_entries from public, anon;
revoke all on public.ss_bets from public, anon;
revoke all on public.ss_bet_legs from public, anon;
revoke all on public.ss_market_quotes from public, anon;
revoke all on public.ss_bankroll_snapshots from public, anon;

grant select, update (display_name, color) on public.ss_members to authenticated;
grant select on public.ss_weeks to authenticated;
grant select on public.ss_week_entries to authenticated;
grant select on public.ss_bets to authenticated;
grant select on public.ss_bet_legs to authenticated;
grant select on public.ss_market_quotes to authenticated;
grant select on public.ss_bankroll_snapshots to authenticated;

drop policy if exists ss_members_select on public.ss_members;
drop policy if exists ss_members_update on public.ss_members;
create policy ss_members_select on public.ss_members
  for select to authenticated using (ss_private.is_ss_member());
create policy ss_members_update on public.ss_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists ss_weeks_select on public.ss_weeks;
create policy ss_weeks_select on public.ss_weeks
  for select to authenticated using (ss_private.is_ss_member());

drop policy if exists ss_week_entries_select on public.ss_week_entries;
create policy ss_week_entries_select on public.ss_week_entries
  for select to authenticated using (ss_private.is_ss_member());

drop policy if exists ss_bets_select on public.ss_bets;
create policy ss_bets_select on public.ss_bets
  for select to authenticated using (ss_private.is_ss_member());

drop policy if exists ss_bet_legs_select on public.ss_bet_legs;
create policy ss_bet_legs_select on public.ss_bet_legs
  for select to authenticated using (ss_private.is_ss_member());

drop policy if exists ss_quotes_select on public.ss_market_quotes;
create policy ss_quotes_select on public.ss_market_quotes
  for select to authenticated using (ss_private.is_ss_member());

drop policy if exists ss_snapshots_select on public.ss_bankroll_snapshots;
create policy ss_snapshots_select on public.ss_bankroll_snapshots
  for select to authenticated using (ss_private.is_ss_member());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ss_bets'
  ) then
    execute 'alter publication supabase_realtime add table public.ss_bets';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ss_bankroll_snapshots'
  ) then
    execute 'alter publication supabase_realtime add table public.ss_bankroll_snapshots';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ss_market_quotes'
  ) then
    execute 'alter publication supabase_realtime add table public.ss_market_quotes';
  end if;
end $$;

insert into public.ss_invite_codes (code_hash, created_by, max_uses)
select extensions.crypt('GODE-VILS', extensions.gen_salt('bf')), null, 50
where not exists (select 1 from public.ss_invite_codes);



