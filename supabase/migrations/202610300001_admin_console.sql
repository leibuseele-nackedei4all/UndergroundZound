-- Leib & Seele – admin console backend (Supabase / PostgreSQL)
--
-- Run this file ONCE in the Supabase SQL Editor as the project owner, after
-- 202610150001_community.sql. It adds:
--   * member_bans          – temporary or permanent member bans
--   * site_settings        – switchable site options (maintenance, sign-ups, …)
--   * admin_audit_log      – every admin action is recorded
--   * admin_* functions    – the complete moderator console API
--   * get_public_settings()– the few switches the public site may read
--
-- Security model: the browser client still uses only the publishable/anon key.
-- Every admin_* function is SECURITY DEFINER, starts with public.admin_assert()
-- and is executable only by authenticated users, so RLS stays the boundary and
-- a non-admin simply gets an exception. Never move these checks into the client.

begin;

-- ---------------------------------------------------------------- new tables

create table if not exists public.member_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 500),
  banned_until timestamptz,               -- null = unbefristet
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  value jsonb not null default 'null'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id bigserial primary key,
  admin_id uuid references auth.users(id) on delete set null,
  admin_email text not null default '',
  action text not null check (char_length(action) between 2 and 80),
  target text not null default '' check (char_length(target) <= 200),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists member_bans_until_idx on public.member_bans (banned_until);

-- Optional extra moderation columns on the existing queues.
alter table public.reports add column if not exists admin_note text not null default '';
alter table public.reports add column if not exists resolved_at timestamptz;
alter table public.reports add column if not exists resolved_by uuid references auth.users(id) on delete set null;
alter table public.account_deletion_requests add column if not exists processed_at timestamptz;
alter table public.account_deletion_requests add column if not exists note text not null default '';

alter table public.member_bans enable row level security;
alter table public.site_settings enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.member_bans, public.site_settings, public.admin_audit_log from anon, authenticated;

-- ------------------------------------------------------------- helpers

create or replace function public.admin_assert()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Anmeldung erforderlich.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_admins a where a.user_id = auth.uid()) then
    raise exception 'Kein Administratorzugriff.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_log(p_action text, p_target text default '', p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.admin_audit_log (admin_id, admin_email, action, target, details)
  values (
    auth.uid(),
    coalesce((select u.email from auth.users u where u.id = auth.uid()), ''),
    left(p_action, 80),
    left(coalesce(p_target, ''), 200),
    coalesce(p_details, '{}'::jsonb)
  );
$$;

create or replace function public.is_member_banned(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1 from public.member_bans b
    where b.user_id = p_user_id
      and (b.banned_until is null or b.banned_until > now())
  );
$$;

-- Banned members keep their account but lose every write path that uses
-- is_active_member() in RLS (posts, comments, likes, shares, messages, uploads).
create or replace function public.is_active_member(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and exists (select 1 from public.profiles p where p.id = p_user_id)
    and not public.is_member_banned(p_user_id);
$$;

-- ------------------------------------------------------------ default settings

insert into public.site_settings (key, value) values
  ('registration_enabled', 'true'::jsonb),
  ('member_area_open', 'true'::jsonb),
  ('chat_enabled', 'true'::jsonb),
  ('friends_enabled', 'true'::jsonb),
  ('uploads_enabled', 'true'::jsonb),
  ('max_upload_mb', '50'::jsonb),
  ('announcement_active', 'false'::jsonb),
  ('announcement_title', '""'::jsonb),
  ('announcement_text', '""'::jsonb),
  ('announcement_kind', '"info"'::jsonb),
  ('maintenance_mode', 'false'::jsonb),
  ('maintenance_message', '""'::jsonb),
  ('support_email', '"leibuseele@gmail.com"'::jsonb),
  ('community_rules_url', '"#club-rules"'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------- public settings

create or replace function public.get_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
  from public.site_settings s
  where s.key in (
    'registration_enabled', 'member_area_open', 'chat_enabled', 'friends_enabled',
    'uploads_enabled', 'max_upload_mb', 'announcement_active', 'announcement_title',
    'announcement_text', 'announcement_kind', 'maintenance_mode',
    'maintenance_message', 'support_email', 'community_rules_url'
  );
$$;

-- ------------------------------------------------------------------ dashboard

create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.admin_assert();

  select jsonb_build_object(
    'members', (select count(*) from public.profiles),
    'admins', (select count(*) from public.app_admins),
    'banned', (select count(*) from public.member_bans b where b.banned_until is null or b.banned_until > now()),
    'posts', (select count(*) from public.posts),
    'comments', (select count(*) from public.post_comments),
    'likes', (select count(*) from public.post_likes),
    'shares', (select count(*) from public.post_shares),
    'messages', (select count(*) from public.messages),
    'conversations', (select count(*) from public.conversations),
    'friends_accepted', (select count(*) from public.friend_requests where status = 'accepted'),
    'friends_pending', (select count(*) from public.friend_requests where status = 'pending'),
    'reports_total', (select count(*) from public.reports),
    'reports_new', (select count(*) from public.reports where status = 'new'),
    'reports_open', (select count(*) from public.reports where status in ('new', 'reviewing')),
    'deletions_total', (select count(*) from public.account_deletion_requests),
    'deletions_open', (select count(*) from public.account_deletion_requests where status <> 'completed'),
    'media_objects', (select count(*) from storage.objects where bucket_id in ('member-media', 'avatars')),
    'media_bytes', coalesce((
      select sum(case when (o.metadata->>'size') ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end)
      from storage.objects o where o.bucket_id in ('member-media', 'avatars')
    ), 0),
    'signups_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'signups_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'posts_7d', (select count(*) from public.posts where created_at > now() - interval '7 days'),
    'messages_7d', (select count(*) from public.messages where created_at > now() - interval '7 days'),
    'comments_7d', (select count(*) from public.post_comments where created_at > now() - interval '7 days'),
    'latest_members', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at desc, m.id)
      from (
        select p.id, p.username, p.display_name, p.avatar_path, p.created_at,
               coalesce(u.email, '') as email
        from public.profiles p
        left join auth.users u on u.id = p.id
        order by p.created_at desc
        limit 6
      ) m
    ), '[]'::jsonb),
    'latest_posts', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id)
      from (
        select po.id, po.body, po.kind, po.visibility, po.created_at,
               pr.username as author_username, pr.display_name as author_name
        from public.posts po
        join public.profiles pr on pr.id = po.author_id
        order by po.created_at desc
        limit 6
      ) p
    ), '[]'::jsonb),
    'latest_reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from (
        select re.id, re.category, re.status, re.created_at, re.details,
               pr.username as reporter_username
        from public.reports re
        left join public.profiles pr on pr.id = re.reporter_id
        order by re.created_at desc
        limit 6
      ) r
    ), '[]'::jsonb),
    'latest_audit', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id)
      from (
        select al.id, al.action, al.target, al.admin_email, al.created_at
        from public.admin_audit_log al
        order by al.created_at desc
        limit 6
      ) a
    ), '[]'::jsonb),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

-- -------------------------------------------------------------------- members

create or replace function public.admin_list_members(
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_sort text default 'newest'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort text := coalesce(nullif(p_sort, ''), 'newest');
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();

  select count(*) into v_total
  from public.profiles p
  left join auth.users u on u.id = p.id
  where v_search is null
     or p.username ilike '%' || v_search || '%'
     or p.display_name ilike '%' || v_search || '%'
     or coalesce(u.email, '') ilike '%' || v_search || '%'
     or p.city ilike '%' || v_search || '%';

  with base as (
    select p.id, p.username, p.display_name, p.bio, p.city, p.pronouns, p.birth_date,
           p.favorite_genres, p.website, p.soundcloud_url, p.profile_visibility,
           p.avatar_path, p.created_at, p.updated_at,
           coalesce(u.email, '') as email,
           u.last_sign_in_at, u.email_confirmed_at, u.created_at as auth_created_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    where v_search is null
       or p.username ilike '%' || v_search || '%'
       or p.display_name ilike '%' || v_search || '%'
       or coalesce(u.email, '') ilike '%' || v_search || '%'
       or p.city ilike '%' || v_search || '%'
  ), page as (
    select b.*
    from base b
    order by
      case when v_sort = 'oldest' then b.created_at end asc nulls last,
      case when v_sort = 'name' then lower(b.display_name) end asc nulls last,
      case when v_sort = 'activity' then b.last_sign_in_at end desc nulls last,
      case when v_sort not in ('oldest', 'name', 'activity') then b.created_at end desc nulls last
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id), '[]'::jsonb) into v_rows
  from (
    select b.id, b.username, b.display_name, b.bio, b.city, b.pronouns, b.birth_date,
           b.favorite_genres, b.website, b.soundcloud_url, b.profile_visibility,
           b.avatar_path, b.created_at, b.updated_at, b.email,
           b.last_sign_in_at, b.email_confirmed_at, b.auth_created_at,
           exists (select 1 from public.app_admins a where a.user_id = b.id) as is_admin,
           public.is_member_banned(b.id) as is_banned,
           (select mb.reason from public.member_bans mb where mb.user_id = b.id) as ban_reason,
           (select mb.banned_until from public.member_bans mb where mb.user_id = b.id) as ban_until,
           (select count(*) from public.posts po where po.author_id = b.id) as post_count,
           (select count(*) from public.post_comments c where c.author_id = b.id) as comment_count,
           (select count(*) from public.messages m where m.sender_id = b.id) as message_count,
           (select count(*) from public.friend_requests f
             where f.status = 'accepted' and b.id in (f.requester_id, f.addressee_id)) as friend_count,
           (select count(*) from public.reports re where re.target_profile_id = b.id) as reports_against
    from page b
  ) t;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$$;

create or replace function public.admin_get_member(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_member jsonb;
  v_posts jsonb;
begin
  perform public.admin_assert();
  if p_user_id is null then raise exception 'Kein Mitglied angegeben.'; end if;

  select row_to_json(t)::jsonb into v_member
  from (
    select p.id, p.username, p.display_name, p.bio, p.city, p.pronouns, p.birth_date,
           p.favorite_genres, p.website, p.soundcloud_url, p.profile_visibility,
           p.avatar_path, p.created_at, p.updated_at,
           coalesce(u.email, '') as email,
           u.last_sign_in_at, u.email_confirmed_at, u.created_at as auth_created_at,
           u.banned_until as auth_banned_until,
           exists (select 1 from public.app_admins a where a.user_id = p.id) as is_admin,
           public.is_member_banned(p.id) as is_banned,
           (select b.reason from public.member_bans b where b.user_id = p.id) as ban_reason,
           (select b.banned_until from public.member_bans b where b.user_id = p.id) as ban_until,
           (select b.created_at from public.member_bans b where b.user_id = p.id) as ban_created_at,
           (select count(*) from public.posts po where po.author_id = p.id) as post_count,
           (select count(*) from public.post_comments c where c.author_id = p.id) as comment_count,
           (select count(*) from public.post_likes l where l.user_id = p.id) as like_count,
           (select count(*) from public.messages m where m.sender_id = p.id) as message_count,
           (select count(*) from public.friend_requests f
             where f.status = 'accepted' and p.id in (f.requester_id, f.addressee_id)) as friend_count,
           (select count(*) from public.reports re where re.target_profile_id = p.id) as reports_against,
           (select count(*) from storage.objects o
             where o.bucket_id in ('member-media', 'avatars')
               and (storage.foldername(o.name))[1] = p.id::text) as media_count
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.id = p_user_id
  ) t;

  if v_member is null then raise exception 'Mitglied nicht gefunden.'; end if;

  select coalesce(jsonb_agg(row_to_json(po)::jsonb), '[]'::jsonb) into v_posts
  from (
    select p2.id, p2.body, p2.kind, p2.visibility, p2.media_path, p2.created_at
    from public.posts p2
    where p2.author_id = p_user_id
    order by p2.created_at desc
    limit 20
  ) po;

  return v_member || jsonb_build_object('recent_posts', v_posts);
end;
$$;

create or replace function public.admin_update_member(
  p_user_id uuid,
  p_display_name text default null,
  p_username text default null,
  p_bio text default null,
  p_city text default null,
  p_pronouns text default null,
  p_visibility text default null,
  p_birth_date date default null,
  p_favorite_genres text default null,
  p_website text default null,
  p_soundcloud_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.profiles%rowtype;
  v_username text;
begin
  perform public.admin_assert();

  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Mitglied nicht gefunden.'; end if;

  v_username := lower(btrim(coalesce(nullif(p_username, ''), v_old.username)));
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Benutzername: 3–24 Zeichen, nur a–z, 0–9 und Unterstrich.';
  end if;
  if exists (select 1 from public.profiles p where p.username = v_username and p.id <> p_user_id) then
    raise exception 'Dieser Benutzername ist bereits vergeben.';
  end if;

  if p_visibility is not null and p_visibility not in ('members', 'friends') then
    raise exception 'Ungültige Profil-Sichtbarkeit.';
  end if;

  update public.profiles set
    display_name = left(btrim(coalesce(nullif(p_display_name, ''), v_old.display_name)), 60),
    username = v_username,
    bio = left(coalesce(p_bio, v_old.bio), 600),
    city = left(coalesce(p_city, v_old.city), 80),
    pronouns = left(coalesce(p_pronouns, v_old.pronouns), 40),
    favorite_genres = left(coalesce(p_favorite_genres, v_old.favorite_genres), 120),
    website = left(coalesce(p_website, v_old.website), 300),
    soundcloud_url = left(coalesce(p_soundcloud_url, v_old.soundcloud_url), 300),
    profile_visibility = coalesce(p_visibility, v_old.profile_visibility),
    birth_date = coalesce(p_birth_date, v_old.birth_date),
    updated_at = now()
  where id = p_user_id;

  perform public.admin_log('member.update', p_user_id::text, jsonb_build_object('username', v_username));
  return public.admin_get_member(p_user_id);
end;
$$;

create or replace function public.admin_set_admin(p_user_id uuid, p_is_admin boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform public.admin_assert();
  if p_user_id is null then raise exception 'Kein Mitglied angegeben.'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'Mitglied nicht gefunden.';
  end if;

  if coalesce(p_is_admin, false) then
    insert into public.app_admins (user_id) values (p_user_id) on conflict (user_id) do nothing;
  else
    if p_user_id = auth.uid() then
      raise exception 'Du kannst dir nicht selbst den Administratorzugriff entziehen.';
    end if;
    select count(*) into v_count from public.app_admins;
    if v_count <= 1 then
      raise exception 'Der letzte Administrator kann nicht entfernt werden.';
    end if;
    delete from public.app_admins where user_id = p_user_id;
  end if;

  perform public.admin_log(
    case when coalesce(p_is_admin, false) then 'admin.grant' else 'admin.revoke' end,
    p_user_id::text
  );
  return jsonb_build_object('ok', true, 'is_admin', coalesce(p_is_admin, false));
end;
$$;

create or replace function public.admin_set_ban(
  p_user_id uuid,
  p_banned boolean,
  p_reason text default '',
  p_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  if p_user_id is null then raise exception 'Kein Mitglied angegeben.'; end if;
  if p_user_id = auth.uid() then raise exception 'Du kannst dich nicht selbst sperren.'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'Mitglied nicht gefunden.';
  end if;

  if coalesce(p_banned, false) then
    insert into public.member_bans (user_id, reason, banned_until, created_by, updated_at)
    values (p_user_id, left(coalesce(p_reason, ''), 500), p_until, auth.uid(), now())
    on conflict (user_id) do update
      set reason = excluded.reason,
          banned_until = excluded.banned_until,
          updated_at = now();
    perform public.admin_log('member.ban', p_user_id::text,
      jsonb_build_object('reason', coalesce(p_reason, ''), 'until', p_until));
  else
    delete from public.member_bans where user_id = p_user_id;
    perform public.admin_log('member.unban', p_user_id::text);
  end if;

  return jsonb_build_object('ok', true, 'banned', coalesce(p_banned, false));
end;
$$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  perform public.admin_assert();
  if p_user_id is null then raise exception 'Kein Mitglied angegeben.'; end if;
  if p_user_id = auth.uid() then raise exception 'Du kannst dein eigenes Konto nicht hier löschen.'; end if;

  select coalesce(u.email, '') into v_email from auth.users u where u.id = p_user_id;
  if v_email = '' and not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'Mitglied nicht gefunden.';
  end if;

  perform public.admin_log('member.delete', p_user_id::text, jsonb_build_object('email', v_email));

  -- auth.users cascades into profiles, posts, media rows, friends, messages,
  -- reports and deletion requests (all FKs are ON DELETE CASCADE).
  delete from public.member_bans where user_id = p_user_id;
  delete from public.account_deletion_requests where user_id = p_user_id;
  delete from auth.users where id = p_user_id;

  return jsonb_build_object('ok', true, 'deleted', p_user_id);
end;
$$;

-- ---------------------------------------------------------------------- posts

create or replace function public.admin_list_posts(
  p_search text default null,
  p_kind text default null,
  p_visibility text default null,
  p_author uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_visibility text := nullif(btrim(coalesce(p_visibility, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();

  select count(*) into v_total
  from public.posts po
  join public.profiles pr on pr.id = po.author_id
  where (v_search is null or po.body ilike '%' || v_search || '%'
         or pr.username ilike '%' || v_search || '%'
         or pr.display_name ilike '%' || v_search || '%')
    and (v_kind is null or po.kind = v_kind)
    and (v_visibility is null or po.visibility = v_visibility)
    and (p_author is null or po.author_id = p_author);

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_rows
  from (
    select po.id, po.author_id, po.body, po.kind, po.visibility, po.media_path,
           po.media_mime, po.created_at, pr.username as author_username,
           pr.display_name as author_name, pr.avatar_path as author_avatar,
           (select count(*) from public.post_likes l where l.post_id = po.id) as like_count,
           (select count(*) from public.post_comments c where c.post_id = po.id) as comment_count,
           (select count(*) from public.post_shares s where s.post_id = po.id) as share_count,
           (select count(*) from public.reports re where re.target_post_id = po.id) as report_count
    from public.posts po
    join public.profiles pr on pr.id = po.author_id
    where (v_search is null or po.body ilike '%' || v_search || '%'
           or pr.username ilike '%' || v_search || '%'
           or pr.display_name ilike '%' || v_search || '%')
      and (v_kind is null or po.kind = v_kind)
      and (v_visibility is null or po.visibility = v_visibility)
      and (p_author is null or po.author_id = p_author)
    order by po.created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$$;

create or replace function public.admin_delete_post(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_media_path text;
  v_media_mime text;
  v_author uuid;
begin
  perform public.admin_assert();

  select media_path, media_mime, author_id into v_media_path, v_media_mime, v_author
  from public.posts where id = p_post_id;
  if not found then raise exception 'Beitrag nicht gefunden.'; end if;

  delete from public.posts where id = p_post_id;
  perform public.admin_log('post.delete', p_post_id::text,
    jsonb_build_object('author_id', v_author, 'media_path', v_media_path, 'media_mime', v_media_mime));

  return jsonb_build_object('ok', true, 'media_path', v_media_path, 'bucket', 'member-media');
end;
$$;

-- ------------------------------------------------------------------ comments

create or replace function public.admin_list_comments(
  p_search text default null,
  p_post_id uuid default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();

  select count(*) into v_total
  from public.post_comments c
  join public.profiles pr on pr.id = c.author_id
  where (v_search is null or c.body ilike '%' || v_search || '%'
         or pr.username ilike '%' || v_search || '%'
         or pr.display_name ilike '%' || v_search || '%')
    and (p_post_id is null or c.post_id = p_post_id);

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_rows
  from (
    select c.id, c.post_id, c.author_id, c.body, c.created_at,
           pr.username as author_username, pr.display_name as author_name,
           left(po.body, 160) as post_excerpt
    from public.post_comments c
    join public.profiles pr on pr.id = c.author_id
    left join public.posts po on po.id = c.post_id
    where (v_search is null or c.body ilike '%' || v_search || '%'
           or pr.username ilike '%' || v_search || '%'
           or pr.display_name ilike '%' || v_search || '%')
      and (p_post_id is null or c.post_id = p_post_id)
    order by c.created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$$;

create or replace function public.admin_delete_comment(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  delete from public.post_comments where id = p_comment_id;
  if not found then raise exception 'Kommentar nicht gefunden.'; end if;
  perform public.admin_log('comment.delete', p_comment_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------------- reports

create or replace function public.admin_list_reports(
  p_status text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();

  select count(*) into v_total
  from public.reports re
  where v_status is null or re.status = v_status;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_rows
  from (
    select re.id, re.category, re.details, re.status, re.created_at, re.admin_note,
           re.resolved_at, re.target_post_id, re.target_profile_id,
           rep.username as reporter_username, rep.display_name as reporter_name,
           tp.username as target_username, tp.display_name as target_name,
           left(po.body, 220) as post_excerpt, po.media_path as post_media_path,
           po.created_at as post_created_at
    from public.reports re
    left join public.profiles rep on rep.id = re.reporter_id
    left join public.profiles tp on tp.id = re.target_profile_id
    left join public.posts po on po.id = re.target_post_id
    where v_status is null or re.status = v_status
    order by
      case when re.status = 'new' then 0 when re.status = 'reviewing' then 1 else 2 end,
      re.created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$$;

create or replace function public.admin_update_report(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  if p_status not in ('new', 'reviewing', 'resolved', 'dismissed') then
    raise exception 'Ungültiger Status.';
  end if;

  update public.reports set
    status = p_status,
    admin_note = left(coalesce(p_note, admin_note), 1000),
    resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end,
    resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() else null end
  where id = p_report_id;

  if not found then raise exception 'Meldung nicht gefunden.'; end if;
  perform public.admin_log('report.update', p_report_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.admin_delete_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  delete from public.reports where id = p_report_id;
  if not found then raise exception 'Meldung nicht gefunden.'; end if;
  perform public.admin_log('report.delete', p_report_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- -------------------------------------------------------- account deletions

create or replace function public.admin_list_deletion_requests(
  p_status text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();

  select count(*) into v_total
  from public.account_deletion_requests d
  where v_status is null or d.status = v_status;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_rows
  from (
    select d.user_id, d.status, d.created_at, d.processed_at, d.note,
           pr.username, pr.display_name, pr.avatar_path,
           coalesce(u.email, '') as email,
           (select count(*) from public.posts po where po.author_id = d.user_id) as post_count
    from public.account_deletion_requests d
    left join public.profiles pr on pr.id = d.user_id
    left join auth.users u on u.id = d.user_id
    where v_status is null or d.status = v_status
    order by d.created_at asc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$$;

create or replace function public.admin_update_deletion_request(
  p_user_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  if p_status not in ('requested', 'processing', 'completed') then
    raise exception 'Ungültiger Status.';
  end if;

  update public.account_deletion_requests set
    status = p_status,
    note = left(coalesce(p_note, note), 1000),
    processed_at = case when p_status = 'completed' then now() else processed_at end
  where user_id = p_user_id;

  if not found then raise exception 'Löschantrag nicht gefunden.'; end if;
  perform public.admin_log('deletion.update', p_user_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- --------------------------------------------------------------- friendships

create or replace function public.admin_list_friendships(
  p_status text default null,
  p_search text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();

  select count(*) into v_total
  from public.friend_requests f
  join public.profiles rq on rq.id = f.requester_id
  join public.profiles ad on ad.id = f.addressee_id
  where (v_status is null or f.status = v_status)
    and (v_search is null or rq.username ilike '%' || v_search || '%'
         or ad.username ilike '%' || v_search || '%'
         or rq.display_name ilike '%' || v_search || '%'
         or ad.display_name ilike '%' || v_search || '%');

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_rows
  from (
    select f.id, f.status, f.created_at, f.requester_id, f.addressee_id,
           rq.username as requester_username, rq.display_name as requester_name,
           ad.username as addressee_username, ad.display_name as addressee_name
    from public.friend_requests f
    join public.profiles rq on rq.id = f.requester_id
    join public.profiles ad on ad.id = f.addressee_id
    where (v_status is null or f.status = v_status)
      and (v_search is null or rq.username ilike '%' || v_search || '%'
           or ad.username ilike '%' || v_search || '%'
           or rq.display_name ilike '%' || v_search || '%'
           or ad.display_name ilike '%' || v_search || '%')
    order by f.created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$$;

create or replace function public.admin_delete_friendship(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  delete from public.friend_requests where id = p_request_id;
  if not found then raise exception 'Freundschaft nicht gefunden.'; end if;
  perform public.admin_log('friendship.delete', p_request_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------------ messages

create or replace function public.admin_list_conversations(
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();

  select count(*) into v_total
  from public.conversations c
  join public.profiles one on one.id = c.user_one
  join public.profiles two on two.id = c.user_two
  where v_search is null
     or one.username ilike '%' || v_search || '%'
     or two.username ilike '%' || v_search || '%'
     or one.display_name ilike '%' || v_search || '%'
     or two.display_name ilike '%' || v_search || '%';

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_rows
  from (
    select c.id, c.created_at, c.updated_at, c.user_one, c.user_two,
           one.username as one_username, one.display_name as one_name,
           two.username as two_username, two.display_name as two_name,
           (select count(*) from public.messages m where m.conversation_id = c.id) as message_count,
           (select left(m.body, 120) from public.messages m
             where m.conversation_id = c.id order by m.created_at desc limit 1) as last_body,
           (select max(m.created_at) from public.messages m where m.conversation_id = c.id) as last_at
    from public.conversations c
    join public.profiles one on one.id = c.user_one
    join public.profiles two on two.id = c.user_two
    where v_search is null
       or one.username ilike '%' || v_search || '%'
       or two.username ilike '%' || v_search || '%'
       or one.display_name ilike '%' || v_search || '%'
       or two.display_name ilike '%' || v_search || '%'
    order by c.updated_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$$;

create or replace function public.admin_read_conversation(
  p_conversation_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 300);
  v_rows jsonb;
begin
  perform public.admin_assert();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb) into v_rows
  from (
    select m.id, m.sender_id, m.body, m.created_at,
           pr.username as sender_username, pr.display_name as sender_name
    from public.messages m
    left join public.profiles pr on pr.id = m.sender_id
    where m.conversation_id = p_conversation_id
    order by m.created_at desc
    limit v_limit
  ) t;

  perform public.admin_log('conversation.read', p_conversation_id::text);
  return jsonb_build_object('rows', v_rows);
end;
$$;

create or replace function public.admin_delete_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  delete from public.messages where id = p_message_id;
  if not found then raise exception 'Nachricht nicht gefunden.'; end if;
  perform public.admin_log('message.delete', p_message_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_delete_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  delete from public.conversations where id = p_conversation_id;
  if not found then raise exception 'Unterhaltung nicht gefunden.'; end if;
  perform public.admin_log('conversation.delete', p_conversation_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- --------------------------------------------------------------------- media

create or replace function public.admin_list_media(
  p_bucket text default 'member-media',
  p_search text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket text := coalesce(nullif(btrim(coalesce(p_bucket, '')), ''), 'member-media');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();
  if v_bucket not in ('member-media', 'avatars') then
    raise exception 'Unbekannter Speicherbereich.';
  end if;

  select count(*) into v_total
  from storage.objects o
  where o.bucket_id = v_bucket
    and (v_search is null or o.name ilike '%' || v_search || '%');

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_rows
  from (
    select o.name, o.bucket_id,
           case when (o.metadata->>'size') ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end as size_bytes,
           o.metadata->>'mimetype' as mime, o.created_at, o.updated_at,
           case when split_part(o.name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then split_part(o.name, '/', 1)::uuid end as owner_id,
           pr.username as owner_username, pr.display_name as owner_name
    from storage.objects o
    left join public.profiles pr on pr.id::text = split_part(o.name, '/', 1)
    where o.bucket_id = v_bucket
      and (v_search is null or o.name ilike '%' || v_search || '%')
    order by o.created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows, 'bucket', v_bucket);
end;
$$;

-- ---------------------------------------------------------------- admins/log

create or replace function public.admin_list_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  perform public.admin_assert();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at asc), '[]'::jsonb) into v_rows
  from (
    select a.user_id, a.created_at,
           coalesce(u.email, '') as email,
           coalesce(pr.username, '') as username,
           coalesce(pr.display_name, '') as display_name
    from public.app_admins a
    left join auth.users u on u.id = a.user_id
    left join public.profiles pr on pr.id = a.user_id
    order by a.created_at asc
  ) t;
  return jsonb_build_object('rows', v_rows);
end;
$$;

create or replace function public.admin_list_audit(p_limit integer default 60, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 300);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_assert();
  select count(*) into v_total from public.admin_audit_log;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc), '[]'::jsonb) into v_rows
  from (
    select id, admin_id, admin_email, action, target, details, created_at
    from public.admin_audit_log
    order by created_at desc
    limit v_limit offset v_offset
  ) t;
  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
end;
$$;

create or replace function public.admin_log_action(p_action text, p_target text default '', p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert();
  perform public.admin_log(left(p_action, 80), p_target, p_details);
  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------------ settings

create or replace function public.admin_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  perform public.admin_assert();
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) into v_rows
  from public.site_settings s;
  return jsonb_build_object('values', v_rows);
end;
$$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed text[] := array[
    'registration_enabled', 'member_area_open', 'chat_enabled', 'friends_enabled',
    'uploads_enabled', 'max_upload_mb', 'announcement_active', 'announcement_title',
    'announcement_text', 'announcement_kind', 'maintenance_mode',
    'maintenance_message', 'support_email', 'community_rules_url'
  ];
begin
  perform public.admin_assert();
  if p_key is null or not (p_key = any (v_allowed)) then
    raise exception 'Unbekannte Einstellung: %', coalesce(p_key, '(leer)');
  end if;

  insert into public.site_settings (key, value, updated_by, updated_at)
  values (p_key, coalesce(p_value, 'null'::jsonb), auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value, updated_by = auth.uid(), updated_at = now();

  perform public.admin_log('setting.update', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('ok', true, 'key', p_key, 'value', p_value);
end;
$$;

-- --------------------------------------------------------------- permissions

revoke all on function public.admin_assert() from public, anon, authenticated;
revoke all on function public.admin_log(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_public_settings() from public, anon;
grant execute on function public.get_public_settings() to anon, authenticated;

revoke all on function public.is_member_banned(uuid) from public, anon;
grant execute on function public.is_member_banned(uuid) to authenticated;

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'admin_dashboard()',
    'admin_list_members(text, integer, integer, text)',
    'admin_get_member(uuid)',
    'admin_update_member(uuid, text, text, text, text, text, text, date, text, text, text)',
    'admin_set_admin(uuid, boolean)',
    'admin_set_ban(uuid, boolean, text, timestamptz)',
    'admin_delete_user(uuid)',
    'admin_list_posts(text, text, text, uuid, integer, integer)',
    'admin_delete_post(uuid)',
    'admin_list_comments(text, uuid, integer, integer)',
    'admin_delete_comment(uuid)',
    'admin_list_reports(text, integer, integer)',
    'admin_update_report(uuid, text, text)',
    'admin_delete_report(uuid)',
    'admin_list_deletion_requests(text, integer, integer)',
    'admin_update_deletion_request(uuid, text, text)',
    'admin_list_friendships(text, text, integer, integer)',
    'admin_delete_friendship(uuid)',
    'admin_list_conversations(text, integer, integer)',
    'admin_read_conversation(uuid, integer)',
    'admin_delete_message(uuid)',
    'admin_delete_conversation(uuid)',
    'admin_list_media(text, text, integer, integer)',
    'admin_list_admins()',
    'admin_list_audit(integer, integer)',
    'admin_log_action(text, text, jsonb)',
    'admin_get_settings()',
    'admin_set_setting(text, jsonb)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', v_sig);
    execute format('grant execute on function public.%s to authenticated', v_sig);
  end loop;
end;
$$;

-- Admins may read and delete every member object through the Storage API so
-- the console can preview and remove files (and really free the space).
drop policy if exists admin_objects_read on storage.objects;
create policy admin_objects_read on storage.objects for select to authenticated
using (bucket_id in ('member-media', 'avatars') and public.is_admin());

drop policy if exists admin_objects_delete on storage.objects;
create policy admin_objects_delete on storage.objects for delete to authenticated
using (bucket_id in ('member-media', 'avatars') and public.is_admin());

-- ---------------------------------------------------------------- first admin
-- Promote the site owner if that account already exists. Create the auth user
-- first (Supabase -> Authentication -> Users -> Add user), then run this file:
insert into public.app_admins (user_id)
select u.id from auth.users u
where lower(u.email) = lower('leibuseele@gmail.com')
on conflict (user_id) do nothing;

commit;

-- Notes
-- -----
-- 1. Every admin_* function checks app_admins membership on the server. The
--    console is only a UI; nothing in it can bypass these checks.
-- 2. Bans block all member write paths (posts, comments, likes, shares,
--    messages, uploads) through is_active_member().
-- 3. Members may still read the site while banned. Add a UI notice in
--    community.js later if you want to show the ban reason.
-- 4. Never run admin_* functions from a public page with a service_role key.
