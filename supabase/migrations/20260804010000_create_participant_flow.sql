-- Quiz Engine MVP: authenticated participant join and vote flow.

create function public.join_game_session(
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

create function public.submit_vote(
  p_game_session_id uuid,
  p_game_question_id uuid,
  p_game_answer_option_id uuid
)
returns table (
  vote_id uuid,
  game_session_id uuid,
  game_question_id uuid,
  player_id uuid,
  game_answer_option_id uuid,
  submitted_at timestamptz,
  voted_count integer,
  is_new_vote boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  session_row public.game_sessions%rowtype;
  player_row public.players%rowtype;
  vote_row public.votes%rowtype;
  resulting_voted_count integer;
  created_vote boolean;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_game_session_id is null
    or p_game_question_id is null
    or p_game_answer_option_id is null
  then
    raise exception 'Session, question and answer option are required'
      using errcode = '22023';
  end if;

  select gs.*
    into session_row
    from public.game_sessions as gs
   where gs.id = p_game_session_id
   for update;

  if not found then
    raise exception 'Game session not found'
      using errcode = 'P0002';
  end if;

  if session_row.phase <> 'voting_open' then
    raise exception 'Voting is not open'
      using errcode = 'P0001';
  end if;

  if session_row.current_game_question_id is distinct from p_game_question_id then
    raise exception 'Votes are accepted only for the current question'
      using errcode = '22023';
  end if;

  select p.*
    into player_row
    from public.players as p
   where p.game_session_id = session_row.id
     and p.auth_user_id = caller_id;

  if not found then
    raise exception 'Player not found in this game session'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.game_answer_options as option
     where option.id = p_game_answer_option_id
       and option.game_question_id = p_game_question_id
  ) then
    raise exception 'Answer option does not belong to the current question'
      using errcode = '22023';
  end if;

  select v.*
    into vote_row
    from public.votes as v
   where v.game_session_id = session_row.id
     and v.game_question_id = p_game_question_id
     and v.player_id = player_row.id
   for update;

  if found then
    update public.votes as v
       set game_answer_option_id = p_game_answer_option_id,
           submitted_at = pg_catalog.now(),
           is_correct = null,
           points_awarded = null
     where v.id = vote_row.id
    returning v.* into vote_row;

    resulting_voted_count := session_row.voted_count;
    created_vote := false;
  else
    insert into public.votes as inserted_vote (
      game_session_id,
      game_question_id,
      player_id,
      game_answer_option_id
    )
    values (
      session_row.id,
      p_game_question_id,
      player_row.id,
      p_game_answer_option_id
    )
    returning inserted_vote.* into vote_row;

    update public.game_sessions as gs
       set voted_count = gs.voted_count + 1
     where gs.id = session_row.id
    returning gs.voted_count into resulting_voted_count;

    created_vote := true;
  end if;

  return query
  select
    vote_row.id,
    vote_row.game_session_id,
    vote_row.game_question_id,
    vote_row.player_id,
    vote_row.game_answer_option_id,
    vote_row.submitted_at,
    resulting_voted_count,
    created_vote;
end;
$$;

revoke all privileges
  on function public.join_game_session(text, text, text)
  from public, anon, authenticated, service_role;
grant execute
  on function public.join_game_session(text, text, text)
  to authenticated;

revoke all privileges
  on function public.submit_vote(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.submit_vote(uuid, uuid, uuid)
  to authenticated;

revoke all privileges
  on table public.players, public.votes
  from public, anon, authenticated;
grant select
  on table public.players, public.votes
  to authenticated;

revoke all privileges
  on table public.question_solutions, public.game_question_solutions
  from public, anon, authenticated;

create policy players_select_own
on public.players
for select
to authenticated
using (
  (select auth.uid()) is not null
  and auth_user_id = (select auth.uid())
);

create policy votes_select_own
on public.votes
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
      from public.players as p
     where p.id = public.votes.player_id
       and p.auth_user_id = (select auth.uid())
  )
);
