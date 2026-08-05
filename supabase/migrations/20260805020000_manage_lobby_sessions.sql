-- Host lobby management and expanded avatar catalog.

alter table public.players
  drop constraint players_avatar_key_allowed;

alter table public.players
  add constraint players_avatar_key_allowed check (
    avatar_key in (
      'fox', 'panda', 'koala', 'lion', 'tiger', 'owl', 'frog', 'penguin',
      'octopus', 'unicorn', 'robot', 'astronaut', 'bear', 'cat', 'dog',
      'rabbit', 'mouse', 'hamster', 'wolf', 'monkey', 'chicken', 'duck',
      'eagle', 'butterfly', 'bee', 'ladybug', 'turtle', 'snake', 'lizard',
      'whale', 'dolphin', 'shark', 'crocodile', 'elephant', 'giraffe',
      'zebra', 'gorilla', 'sloth', 'otter', 'dragon'
    )
  );

alter table public.players
  add constraint players_session_avatar_key
  unique (game_session_id, avatar_key);

create or replace function public.join_game_session(
  p_code text,
  p_nickname text,
  p_avatar_key text
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
  is_new_player boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  normalized_code text;
  normalized_nickname text;
  normalized_avatar_key text;
  session_row public.game_sessions%rowtype;
  player_row public.players%rowtype;
  resulting_participant_count integer;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if (auth.jwt() ->> 'is_anonymous')::boolean is distinct from true then
    raise exception 'An anonymous authenticated user is required'
      using errcode = '42501';
  end if;

  normalized_code := pg_catalog.upper(pg_catalog.btrim(p_code));
  normalized_nickname := pg_catalog.btrim(
    pg_catalog.regexp_replace(
      p_nickname,
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
  normalized_avatar_key := pg_catalog.btrim(p_avatar_key);

  if normalized_code is null
    or normalized_code !~ '^[A-HJ-NP-Z2-9]{6}$'
  then
    raise exception 'Invalid game session code'
      using errcode = '22023';
  end if;

  if normalized_nickname is null
    or pg_catalog.char_length(normalized_nickname) not between 2 and 20
  then
    raise exception 'Nickname must contain between 2 and 20 characters'
      using errcode = '22023';
  end if;

  if normalized_avatar_key is null or normalized_avatar_key = '' then
    raise exception 'Avatar key is required'
      using errcode = '22023';
  end if;

  select gs.*
    into session_row
    from public.game_sessions as gs
   where gs.code = normalized_code
   for update;

  if not found then
    raise exception 'Game session not found'
      using errcode = 'P0002';
  end if;

  select p.*
    into player_row
    from public.players as p
   where p.game_session_id = session_row.id
     and p.auth_user_id = caller_id;

  if found then
    return query
    select
      player_row.id,
      player_row.game_session_id,
      session_row.code,
      player_row.nickname,
      player_row.avatar_key,
      player_row.total_score,
      player_row.joined_at,
      session_row.phase,
      session_row.current_game_question_id,
      session_row.quiz_title,
      session_row.max_players,
      session_row.participant_count,
      false;
    return;
  end if;

  if session_row.phase <> 'lobby' then
    raise exception 'New players can join only during the lobby phase'
      using errcode = 'P0001';
  end if;

  if session_row.participant_count >= session_row.max_players then
    raise exception 'Game session is full'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.players as p
     where p.game_session_id = session_row.id
       and p.nickname_normalized = pg_catalog.lower(normalized_nickname)
  ) then
    raise exception 'Nickname is already in use in this game session'
      using errcode = '23505';
  end if;

  if exists (
    select 1
      from public.players as p
     where p.game_session_id = session_row.id
       and p.avatar_key = normalized_avatar_key
  ) then
    raise exception 'Avatar is already in use in this game session'
      using errcode = 'P0001';
  end if;

  insert into public.players as inserted_player (
    game_session_id,
    auth_user_id,
    nickname,
    avatar_key
  )
  values (
    session_row.id,
    caller_id,
    normalized_nickname,
    normalized_avatar_key
  )
  returning inserted_player.* into player_row;

  update public.game_sessions as gs
     set participant_count = gs.participant_count + 1
   where gs.id = session_row.id
  returning gs.participant_count into resulting_participant_count;

  return query
  select
    player_row.id,
    player_row.game_session_id,
    session_row.code,
    player_row.nickname,
    player_row.avatar_key,
    player_row.total_score,
    player_row.joined_at,
    session_row.phase,
    session_row.current_game_question_id,
    session_row.quiz_title,
    session_row.max_players,
    resulting_participant_count,
    true;
end;
$$;

create function public.remove_lobby_player(
  p_game_session_id uuid,
  p_player_id uuid
)
returns table (
  removed_player_id uuid,
  participant_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.game_sessions%rowtype;
  deleted_player_id uuid;
  resulting_participant_count integer;
begin
  select gs.*
    into session_row
    from public.game_sessions as gs
   where gs.id = p_game_session_id
   for update;

  if not found then
    raise exception 'Game session not found'
      using errcode = 'P0002';
  end if;

  if session_row.phase <> 'lobby' then
    raise exception 'Players can be removed only during the lobby phase'
      using errcode = 'P0001';
  end if;

  delete from public.players as p
   where p.id = p_player_id
     and p.game_session_id = session_row.id
  returning p.id into deleted_player_id;

  if not found then
    raise exception 'Player not found in game session'
      using errcode = 'P0002';
  end if;

  if session_row.participant_count <= 0 then
    raise exception 'Participant count is inconsistent'
      using errcode = '23514';
  end if;

  update public.game_sessions as gs
     set participant_count = gs.participant_count - 1
   where gs.id = session_row.id
     and gs.participant_count > 0
  returning gs.participant_count into resulting_participant_count;

  if not found then
    raise exception 'Participant count cannot become negative'
      using errcode = '23514';
  end if;

  return query
  select deleted_player_id, resulting_participant_count;
end;
$$;

create function public.cancel_lobby_session(
  p_game_session_id uuid
)
returns table (
  cancelled_game_session_id uuid,
  session_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.game_sessions%rowtype;
begin
  select gs.*
    into session_row
    from public.game_sessions as gs
   where gs.id = p_game_session_id
   for update;

  if not found then
    raise exception 'Game session not found'
      using errcode = 'P0002';
  end if;

  if session_row.phase <> 'lobby' then
    raise exception 'Game sessions can be cancelled only during the lobby phase'
      using errcode = 'P0001';
  end if;

  delete from public.game_sessions as gs
   where gs.id = session_row.id;

  return query
  select session_row.id, session_row.code;
end;
$$;

revoke all privileges
  on function public.join_game_session(text, text, text)
  from public, anon, authenticated, service_role;

grant execute
  on function public.join_game_session(text, text, text)
  to authenticated;

revoke all privileges
  on function public.remove_lobby_player(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute
  on function public.remove_lobby_player(uuid, uuid)
  to service_role;

revoke all privileges
  on function public.cancel_lobby_session(uuid)
  from public, anon, authenticated, service_role;

grant execute
  on function public.cancel_lobby_session(uuid)
  to service_role;

revoke all privileges
  on table public.game_sessions, public.players
  from public, anon, authenticated;

grant select
  on table public.game_sessions, public.players
  to service_role;
