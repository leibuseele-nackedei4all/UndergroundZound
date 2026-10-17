-- Leib & Seele Community schema (Supabase / PostgreSQL)
-- Run once in Supabase SQL Editor as the project owner. All member data is
-- protected by RLS. The browser client must use only the public key.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  bio text not null default '' check (char_length(bio) <= 600),
  city text not null default '' check (char_length(city) <= 80),
  pronouns text not null default '' check (char_length(pronouns) <= 40),
  birth_date date,
  favorite_genres text not null default '' check (char_length(favorite_genres) <= 120),
  website text not null default '' check (char_length(website) <= 300),
  soundcloud_url text not null default '' check (char_length(soundcloud_url) <= 300),
  profile_visibility text not null default 'members' check (profile_visibility in ('members', 'friends')),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_avatar_path_owner check (avatar_path is null or avatar_path like id::text || '/%')
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  user_low uuid generated always as (least(requester_id, addressee_id)) stored,
  user_high uuid generated always as (greatest(requester_id, addressee_id)) stored,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'removed')),
  created_at timestamptz not null default now(),
  constraint friend_requests_not_self check (requester_id <> addressee_id),
  constraint friend_requests_pair_unique unique (user_low, user_high)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 3000),
  kind text not null default 'text' check (kind in ('text', 'image', 'video', 'voice')),
  media_path text,
  media_mime text,
  visibility text not null default 'members' check (visibility in ('members', 'friends')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_content_present check (char_length(btrim(body)) > 0 or media_path is not null),
  constraint posts_media_matches_kind check (
    (kind = 'text' and media_path is null and media_mime is null) or
    (kind in ('image', 'video', 'voice') and media_path is not null and media_mime is not null)
  ),
  constraint posts_media_path_owner check (media_path is null or media_path like author_id::text || '/' || id::text || '/%')
);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_shares (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_one uuid not null references public.profiles(id) on delete cascade,
  user_two uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_two_distinct_members check (user_one < user_two),
  constraint conversations_pair_unique unique (user_one, user_two)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_post_id uuid references public.posts(id) on delete cascade,
  target_profile_id uuid references public.profiles(id) on delete cascade,
  category text not null default 'other' check (category in ('spam', 'harassment', 'illegal', 'copyright', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  constraint reports_one_target check ((target_post_id is not null) <> (target_profile_id is not null))
);

create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested', 'processing', 'completed'))
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_created_at_idx on public.posts (author_id, created_at desc);
create index if not exists post_comments_post_created_at_idx on public.post_comments (post_id, created_at);
create index if not exists post_shares_user_created_at_idx on public.post_shares (user_id, created_at desc);
create index if not exists friend_requests_addressee_status_idx on public.friend_requests (addressee_id, status, created_at desc);
create index if not exists friend_requests_requester_status_idx on public.friend_requests (requester_id, status, created_at desc);
create index if not exists conversations_user_one_updated_idx on public.conversations (user_one, updated_at desc);
create index if not exists conversations_user_two_updated_idx on public.conversations (user_two, updated_at desc);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index if not exists reports_status_created_idx on public.reports (status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
for each row execute function public.set_updated_at();

create or replace function public.is_active_member(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1 from public.profiles p where p.id = p_user_id
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;

create or replace function public.are_friends(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_left is not null and p_right is not null and exists (
    select 1 from public.friend_requests f
    where f.status = 'accepted'
      and ((f.requester_id = p_left and f.addressee_id = p_right)
        or (f.requester_id = p_right and f.addressee_id = p_left))
  );
$$;

create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and (
        p.id = auth.uid()
        or public.is_admin()
        or (public.is_active_member(auth.uid()) and
            (p.profile_visibility = 'members' or public.are_friends(auth.uid(), p.id)))
      )
  );
$$;

create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.posts p
    join public.profiles author on author.id = p.author_id
    where p.id = p_post_id
      and (
        p.author_id = auth.uid()
        or public.is_admin()
        or (
          public.is_active_member(auth.uid())
          and public.can_view_profile(author.id)
          and (p.visibility = 'members' or public.are_friends(auth.uid(), author.id))
        )
      )
  );
$$;

create or replace function public.can_read_member_media(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.posts p
    where p.author_id::text = split_part(p_object_name, '/', 1)
      and p.id::text = split_part(p_object_name, '/', 2)
      and p.media_path = p_object_name
      and public.can_view_post(p.id)
  );
$$;

create or replace function public.can_read_avatar(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id::text = split_part(p_object_name, '/', 1)
      and p.avatar_path = p_object_name
      and public.can_view_profile(p.id)
  );
$$;

create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and p_user_id in (c.user_one, c.user_two)
  );
$$;

create or replace function public.can_send_message(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (
        (c.user_one = p_user_id and public.are_friends(c.user_one, c.user_two))
        or (c.user_two = p_user_id and public.are_friends(c.user_one, c.user_two))
      )
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
  v_fallback text;
  v_display_name text;
begin
  v_username := left(lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^a-zA-Z0-9_]', '', 'g')), 24);
  if char_length(v_username) < 3 then
    v_username := 'member_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  if exists (select 1 from public.profiles p where p.username = v_username and p.id <> new.id) then
    v_fallback := 'member_' || left(replace(new.id::text, '-', ''), 8);
    v_username := v_fallback;
  end if;
  v_display_name := nullif(btrim(coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(coalesce(new.email, ''), '@', 1)
  )), '');
  if v_display_name is null then v_display_name := 'Neues Mitglied'; end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, left(v_display_name, 60))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_community on auth.users;
create trigger on_auth_user_created_community after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.request_friend(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.friend_requests%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_target_id is null or p_target_id = v_user_id then raise exception 'Cannot request yourself'; end if;
  if not public.is_active_member(v_user_id) or not public.is_active_member(p_target_id) then raise exception 'Member not found'; end if;

  select * into v_request
  from public.friend_requests
  where user_low = least(v_user_id, p_target_id) and user_high = greatest(v_user_id, p_target_id)
  for update;

  if found then
    if v_request.status = 'accepted' then return v_request.id; end if;
    if v_request.status = 'pending' then
      if v_request.requester_id = p_target_id and v_request.addressee_id = v_user_id then
        update public.friend_requests set status = 'accepted', created_at = now() where id = v_request.id;
      end if;
      return v_request.id;
    end if;
    update public.friend_requests
      set requester_id = v_user_id, addressee_id = p_target_id, status = 'pending', created_at = now()
      where id = v_request.id;
    return v_request.id;
  end if;

  insert into public.friend_requests (requester_id, addressee_id, status)
  values (v_user_id, p_target_id, 'pending')
  returning id into v_request.id;
  return v_request.id;
end;
$$;

create or replace function public.respond_friend_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.friend_requests
     set status = case when p_accept then 'accepted' else 'declined' end
   where id = p_request_id and addressee_id = v_user_id and status = 'pending';
  if not found then raise exception 'Friend request is no longer available'; end if;
end;
$$;

create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_friend_id is null or p_friend_id = v_user_id then raise exception 'Invalid friend'; end if;
  update public.friend_requests
     set status = 'removed', created_at = now()
   where user_low = least(v_user_id, p_friend_id)
     and user_high = greatest(v_user_id, p_friend_id)
     and status = 'accepted';
  if not found then raise exception 'Friend relationship not found'; end if;
end;
$$;

create or replace function public.get_or_create_conversation(p_friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_one uuid;
  v_two uuid;
  v_conversation_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_friend_id is null or p_friend_id = v_user_id then raise exception 'Invalid friend'; end if;
  if not public.are_friends(v_user_id, p_friend_id) then raise exception 'You can only message a friend'; end if;
  v_one := least(v_user_id, p_friend_id);
  v_two := greatest(v_user_id, p_friend_id);
  insert into public.conversations (user_one, user_two)
  values (v_one, v_two)
  on conflict (user_one, user_two) do nothing
  returning id into v_conversation_id;
  if v_conversation_id is null then
    select c.id into v_conversation_id from public.conversations c where c.user_one = v_one and c.user_two = v_two;
  end if;
  return v_conversation_id;
end;
$$;

create or replace function public.touch_conversation_after_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations set updated_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages
for each row execute function public.touch_conversation_after_message();

-- Only authenticated members can reach community tables. There is no anon access.
alter table public.profiles enable row level security;
alter table public.app_admins enable row level security;
alter table public.friend_requests enable row level security;
alter table public.posts enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_shares enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.account_deletion_requests enable row level security;

revoke all on public.profiles, public.app_admins, public.friend_requests, public.posts,
  public.post_comments, public.post_likes, public.post_shares, public.conversations,
  public.messages, public.reports, public.account_deletion_requests from anon, authenticated;
grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant update (username, display_name, bio, city, pronouns, birth_date, favorite_genres,
  website, soundcloud_url, profile_visibility, avatar_path) on public.profiles to authenticated;
grant select on public.friend_requests to authenticated;
grant delete on public.friend_requests to authenticated;
grant select, delete on public.posts to authenticated;
grant insert (id, author_id, body, kind, media_path, media_mime, visibility) on public.posts to authenticated;
grant update (body, visibility) on public.posts to authenticated;
grant select, delete on public.post_comments to authenticated;
grant insert (post_id, author_id, body) on public.post_comments to authenticated;
grant select, delete on public.post_likes to authenticated;
grant insert (post_id, user_id) on public.post_likes to authenticated;
grant select, delete on public.post_shares to authenticated;
grant insert (post_id, user_id, caption) on public.post_shares to authenticated;
grant select on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;
grant select on public.reports to authenticated;
grant insert (reporter_id, target_post_id, target_profile_id, category, details) on public.reports to authenticated;
grant select on public.account_deletion_requests to authenticated;
grant insert (user_id) on public.account_deletion_requests to authenticated;

-- RLS policies (drop/recreate makes the policy portion safe to re-run).
drop policy if exists profiles_read_visible on public.profiles;
create policy profiles_read_visible on public.profiles for select to authenticated
using (public.can_view_profile(id));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists posts_read_visible on public.posts;
create policy posts_read_visible on public.posts for select to authenticated
using (public.can_view_post(id) or public.is_admin());
drop policy if exists posts_insert_self on public.posts;
create policy posts_insert_self on public.posts for insert to authenticated
with check (
  author_id = auth.uid()
  and public.is_active_member(auth.uid())
  and (media_path is null or media_path like auth.uid()::text || '/' || id::text || '/%')
);
drop policy if exists posts_update_self on public.posts;
create policy posts_update_self on public.posts for update to authenticated
using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists posts_delete_self on public.posts;
create policy posts_delete_self on public.posts for delete to authenticated
using (author_id = auth.uid());

drop policy if exists comments_read_visible on public.post_comments;
create policy comments_read_visible on public.post_comments for select to authenticated
using (public.can_view_post(post_id));
drop policy if exists comments_insert_self on public.post_comments;
create policy comments_insert_self on public.post_comments for insert to authenticated
with check (author_id = auth.uid() and public.is_active_member(auth.uid()) and public.can_view_post(post_id));
drop policy if exists comments_delete_self on public.post_comments;
create policy comments_delete_self on public.post_comments for delete to authenticated
using (author_id = auth.uid());

drop policy if exists likes_read_visible on public.post_likes;
create policy likes_read_visible on public.post_likes for select to authenticated
using (public.can_view_post(post_id));
drop policy if exists likes_insert_self on public.post_likes;
create policy likes_insert_self on public.post_likes for insert to authenticated
with check (user_id = auth.uid() and public.is_active_member(auth.uid()) and public.can_view_post(post_id));
drop policy if exists likes_delete_self on public.post_likes;
create policy likes_delete_self on public.post_likes for delete to authenticated
using (user_id = auth.uid());

drop policy if exists shares_read_visible on public.post_shares;
create policy shares_read_visible on public.post_shares for select to authenticated
using (public.can_view_post(post_id));
drop policy if exists shares_insert_self on public.post_shares;
create policy shares_insert_self on public.post_shares for insert to authenticated
with check (user_id = auth.uid() and public.is_active_member(auth.uid()) and public.can_view_post(post_id));
drop policy if exists shares_delete_self on public.post_shares;
create policy shares_delete_self on public.post_shares for delete to authenticated
using (user_id = auth.uid());

drop policy if exists friend_requests_read_participants on public.friend_requests;
create policy friend_requests_read_participants on public.friend_requests for select to authenticated
using (public.is_active_member(auth.uid()) and auth.uid() in (requester_id, addressee_id));
drop policy if exists friend_requests_cancel_own on public.friend_requests;
create policy friend_requests_cancel_own on public.friend_requests for delete to authenticated
using (requester_id = auth.uid() and status = 'pending');

drop policy if exists conversations_read_members on public.conversations;
create policy conversations_read_members on public.conversations for select to authenticated
using (public.is_active_member(auth.uid()) and auth.uid() in (user_one, user_two));
drop policy if exists messages_read_members on public.messages;
create policy messages_read_members on public.messages for select to authenticated
using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists messages_insert_friends on public.messages;
create policy messages_insert_friends on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_active_member(auth.uid())
  and public.can_send_message(conversation_id, auth.uid())
);

-- Reports can only be created for visible content; only an app admin can read the queue.
drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports for insert to authenticated
with check (
  reporter_id = auth.uid()
  and public.is_active_member(auth.uid())
  and (
    (target_post_id is not null and public.can_view_post(target_post_id))
    or (target_profile_id is not null and target_profile_id <> auth.uid() and public.can_view_profile(target_profile_id))
  )
);
drop policy if exists reports_read_admin on public.reports;
create policy reports_read_admin on public.reports for select to authenticated
using (public.is_admin());
drop policy if exists reports_update_admin on public.reports;
create policy reports_update_admin on public.reports for update to authenticated
using (public.is_admin()) with check (public.is_admin());
grant update (status) on public.reports to authenticated;

drop policy if exists deletion_request_read_self_or_admin on public.account_deletion_requests;
create policy deletion_request_read_self_or_admin on public.account_deletion_requests for select to authenticated
using (user_id = auth.uid() or public.is_admin());
drop policy if exists deletion_request_insert_self on public.account_deletion_requests;
create policy deletion_request_insert_self on public.account_deletion_requests for insert to authenticated
with check (user_id = auth.uid());

-- Helper/RPC permissions. All security-definer functions pin their search_path.
revoke all on function public.is_active_member(uuid) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.are_friends(uuid, uuid) from public, anon;
revoke all on function public.can_view_profile(uuid) from public, anon;
revoke all on function public.can_view_post(uuid) from public, anon;
revoke all on function public.can_read_member_media(text) from public, anon;
revoke all on function public.can_read_avatar(text) from public, anon;
revoke all on function public.is_conversation_member(uuid, uuid) from public, anon;
revoke all on function public.can_send_message(uuid, uuid) from public, anon;
revoke all on function public.request_friend(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.get_or_create_conversation(uuid) from public, anon;
grant execute on function public.is_active_member(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.can_view_post(uuid) to authenticated;
grant execute on function public.can_read_member_media(text) to authenticated;
grant execute on function public.can_read_avatar(text) to authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.can_send_message(uuid, uuid) to authenticated;
grant execute on function public.request_friend(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- Private buckets: signed URLs are minted only after the RLS read policies pass.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-media', 'member-media', false, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm',
        'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/x-wav',
        'audio/aac','audio/flac','audio/opus']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS: a member can upload/delete only in their own folder. Reads are
-- limited to objects referenced by a visible post or profile.
drop policy if exists member_media_read_visible on storage.objects;
create policy member_media_read_visible on storage.objects for select to authenticated
using (bucket_id = 'member-media' and public.can_read_member_media(name));
drop policy if exists member_media_insert_own on storage.objects;
create policy member_media_insert_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'member-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and array_length(storage.foldername(name), 1) = 2
  and public.is_active_member(auth.uid())
);
drop policy if exists member_media_delete_own on storage.objects;
create policy member_media_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'member-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_read_visible on storage.objects;
create policy avatars_read_visible on storage.objects for select to authenticated
using (bucket_id = 'avatars' and public.can_read_avatar(name));
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and array_length(storage.foldername(name), 1) = 1
  and public.is_active_member(auth.uid())
);
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Enable message Postgres Changes for the 1:1 chat when the standard Supabase
-- Realtime publication exists. Table RLS still applies to every subscriber.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

commit;

-- After signing up, promote the site owner to moderator/admin in SQL Editor:
-- insert into public.app_admins (user_id) values ('YOUR_AUTH_USER_UUID');
-- Reports and account deletion requests can then be reviewed in Supabase.
