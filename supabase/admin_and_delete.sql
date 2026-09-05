-- Admin roster + bet delete. Applied on House Fund; also mirrored in schema.sql.

create table if not exists public.ss_pending_members (
  email text primary key,
  display_name text not null
    check (char_length(trim(display_name)) between 1 and 32),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.ss_pending_members enable row level security;
revoke all on public.ss_pending_members from public, anon, authenticated;

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
grant execute on function public.ss_add_member(text, text) to authenticated;
grant execute on function public.ss_remove_member(uuid) to authenticated;
grant execute on function public.ss_remove_pending(text) to authenticated;
grant execute on function public.ss_list_pending() to authenticated;
grant execute on function public.ss_claim_pending() to authenticated;
grant execute on function public.ss_delete_bet(uuid) to authenticated;

notify pgrst, 'reload schema';
