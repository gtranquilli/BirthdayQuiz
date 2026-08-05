-- Personal, rotating rejoin tokens for participant Auth recovery.

alter table public.players
  add column rejoin_token_hash text,
  add column rejoin_token_created_at timestamptz;

alter table public.players
  add constraint players_rejoin_token_hash_format check (
    rejoin_token_hash is null
    or rejoin_token_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint players_rejoin_token_fields_consistent check (
    (rejoin_token_hash is null and rejoin_token_created_at is null)
    or (rejoin_token_hash is not null and rejoin_token_created_at is not null)
  );

create unique index players_rejoin_token_hash_key
  on public.players (rejoin_token_hash)
  where rejoin_token_hash is not null;

create function public.join_game_session_with_rejoin_token(
  p_code text,
  p_nickname text,
  p_avatar_key text,
  p_auth_user_id uuid,
  p_rejoin_token_hash text,
  p_rotate_rejoin_token boolean
)
returns table (
  player_id uuid,
  game_session_id uuid,
  session_code text,
  player_nickname text,
  player_avatar_key text,
  total_score integer,
  joined_at timestamptz,
  session_phase public.game_phase,
  current_game_question_id uuid,
  quiz_title text,
  max_players integer,
  participant_count integer,
  is_new_player boolean,
  rejoin_token_changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized_code text;
  v_normalized_nickname text;
  v_normalized_avatar_key text;
  v_session_row public.game_sessions%rowtype;
  v_player_row public.players%rowtype;
  v_participant_count integer;
  v_rejoin_token_changed boolean;
begin
  v_normalized_code := pg_catalog.upper(pg_catalog.btrim(p_code));
  v_normalized_nickname := pg_catalog.btrim(
    pg_catalog.regexp_replace(p_nickname, '[[:space:]]+', ' ', 'g')
  );
  v_normalized_avatar_key := pg_catalog.btrim(p_avatar_key);

  if p_auth_user_id is null then
    raise exception 'Anonymous Auth user id is required'
      using errcode = '42501';
  end if;

  if p_rejoin_token_hash is null
    or p_rejoin_token_hash !~ '^[0-9a-f]{64}$'
    or p_rotate_rejoin_token is null
  then
    raise exception 'A valid rejoin token hash is required'
      using errcode = '22023';
  end if;

  if v_normalized_code is null
    or v_normalized_code !~ '^[A-HJ-NP-Z2-9]{6}$'
  then
    raise exception 'Invalid game session code'
      using errcode = '22023';
  end if;

  if v_normalized_nickname is null
    or pg_catalog.char_length(v_normalized_nickname) not between 2 and 20
  then
    raise exception 'Nickname must contain between 2 and 20 characters'
      using errcode = '22023';
  end if;

  if v_normalized_avatar_key is null or v_normalized_avatar_key = '' then
    raise exception 'Avatar key is required'
      using errcode = '22023';
  end if;

  select session_source.*
    into v_session_row
    from public.game_sessions as session_source
   where session_source.code = v_normalized_code
   for update;

  if not found then
    raise exception 'Game session not found'
      using errcode = 'P0002';
  end if;

  select player_source.*
    into v_player_row
    from public.players as player_source
   where player_source.game_session_id = v_session_row.id
     and player_source.auth_user_id = p_auth_user_id
   for update;

  if found then
    v_rejoin_token_changed :=
      p_rotate_rejoin_token or v_player_row.rejoin_token_hash is null;

    if v_rejoin_token_changed then
      update public.players as existing_player
         set rejoin_token_hash = p_rejoin_token_hash,
             rejoin_token_created_at = pg_catalog.now()
       where existing_player.id = v_player_row.id
      returning existing_player.* into v_player_row;
    end if;

    return query
    select
      v_player_row.id,
      v_player_row.game_session_id,
      v_session_row.code,
      v_player_row.nickname,
      v_player_row.avatar_key,
      v_player_row.total_score,
      v_player_row.joined_at,
      v_session_row.phase,
      v_session_row.current_game_question_id,
      v_session_row.quiz_title,
      v_session_row.max_players,
      v_session_row.participant_count,
      false,
      v_rejoin_token_changed;
    return;
  end if;

  if v_session_row.phase <> 'lobby' then
    raise exception 'New players can join only during the lobby phase'
      using errcode = 'P0001';
  end if;

  if v_session_row.participant_count >= v_session_row.max_players then
    raise exception 'Game session is full'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.players as nickname_owner
     where nickname_owner.game_session_id = v_session_row.id
       and nickname_owner.nickname_normalized =
         pg_catalog.lower(v_normalized_nickname)
  ) then
    raise exception 'Nickname is already in use in this game session'
      using errcode = '23505';
  end if;

  if exists (
    select 1
      from public.players as avatar_owner
     where avatar_owner.game_session_id = v_session_row.id
       and avatar_owner.avatar_key = v_normalized_avatar_key
  ) then
    raise exception 'Avatar is already in use in this game session'
      using errcode = 'P0001';
  end if;

  insert into public.players as inserted_player (
    game_session_id,
    auth_user_id,
    nickname,
    avatar_key,
    rejoin_token_hash,
    rejoin_token_created_at
  )
  values (
    v_session_row.id,
    p_auth_user_id,
    v_normalized_nickname,
    v_normalized_avatar_key,
    p_rejoin_token_hash,
    pg_catalog.now()
  )
  returning inserted_player.* into v_player_row;

  update public.game_sessions as joined_session
     set participant_count = joined_session.participant_count + 1
   where joined_session.id = v_session_row.id
  returning joined_session.participant_count into v_participant_count;

  return query
  select
    v_player_row.id,
    v_player_row.game_session_id,
    v_session_row.code,
    v_player_row.nickname,
    v_player_row.avatar_key,
    v_player_row.total_score,
    v_player_row.joined_at,
    v_session_row.phase,
    v_session_row.current_game_question_id,
    v_session_row.quiz_title,
    v_session_row.max_players,
    v_participant_count,
    true,
    true;
end;
$$;

create function public.rejoin_game_session(
  p_code text,
  p_rejoin_token_hash text,
  p_new_auth_user_id uuid,
  p_new_rejoin_token_hash text
)
returns table (
  session_code text,
  player_nickname text,
  player_avatar_key text,
  total_score integer,
  session_phase public.game_phase,
  participant_count integer,
  max_players integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized_code text;
  v_session_row public.game_sessions%rowtype;
  v_player_row public.players%rowtype;
begin
  v_normalized_code := pg_catalog.upper(pg_catalog.btrim(p_code));

  if v_normalized_code is null
    or v_normalized_code !~ '^[A-HJ-NP-Z2-9]{6}$'
    or p_new_auth_user_id is null
    or p_rejoin_token_hash is null
    or p_rejoin_token_hash !~ '^[0-9a-f]{64}$'
    or p_new_rejoin_token_hash is null
    or p_new_rejoin_token_hash !~ '^[0-9a-f]{64}$'
    or p_new_rejoin_token_hash = p_rejoin_token_hash
  then
    raise exception 'Valid game, Auth and rejoin token data are required'
      using errcode = '22023';
  end if;

  select session_source.*
    into v_session_row
    from public.game_sessions as session_source
   where session_source.code = v_normalized_code
   for update;

  if not found then
    raise exception 'Game session not found'
      using errcode = 'P0002';
  end if;

  select token_player.*
    into v_player_row
    from public.players as token_player
   where token_player.game_session_id = v_session_row.id
     and token_player.rejoin_token_hash = p_rejoin_token_hash
   for update;

  if not found then
    raise exception 'Rejoin token is invalid or has already been used'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.players as identity_player
     where identity_player.game_session_id = v_session_row.id
       and identity_player.auth_user_id = p_new_auth_user_id
       and identity_player.id <> v_player_row.id
  ) then
    raise exception 'Current Auth identity already belongs to another player'
      using errcode = 'P0001';
  end if;

  update public.players as recovered_player
     set auth_user_id = p_new_auth_user_id,
         rejoin_token_hash = p_new_rejoin_token_hash,
         rejoin_token_created_at = pg_catalog.now()
   where recovered_player.id = v_player_row.id
  returning recovered_player.* into v_player_row;

  return query
  select
    v_session_row.code,
    v_player_row.nickname,
    v_player_row.avatar_key,
    v_player_row.total_score,
    v_session_row.phase,
    v_session_row.participant_count,
    v_session_row.max_players;
end;
$$;

revoke all privileges
  on function public.join_game_session(text, text, text)
  from public, anon, authenticated, service_role;

revoke all privileges
  on function public.join_game_session_with_rejoin_token(
    text, text, text, uuid, text, boolean
  )
  from public, anon, authenticated, service_role;
grant execute
  on function public.join_game_session_with_rejoin_token(
    text, text, text, uuid, text, boolean
  )
  to service_role;

revoke all privileges
  on function public.rejoin_game_session(text, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute
  on function public.rejoin_game_session(text, text, uuid, text)
  to service_role;

revoke all privileges
  on table public.players
  from public, anon, authenticated;
