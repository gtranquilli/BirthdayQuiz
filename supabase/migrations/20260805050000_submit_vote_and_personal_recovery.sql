-- Persist participant votes through authenticated, identity-bound RPCs only.

create function public.submit_vote(
  p_code text,
  p_game_answer_option_id uuid
)
returns table (
  selected_option_id uuid,
  voted_count integer,
  current_question_index integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  normalized_code text;
  session_row public.game_sessions%rowtype;
  player_row public.players%rowtype;
  vote_row public.votes%rowtype;
  resulting_voted_count integer;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  normalized_code := pg_catalog.upper(pg_catalog.btrim(p_code));

  if normalized_code is null
    or normalized_code !~ '^[A-HJ-NP-Z2-9]{6}$'
    or p_game_answer_option_id is null
  then
    raise exception 'Game code and answer option are required'
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

  if session_row.phase <> 'voting_open' then
    raise exception 'Voting is not open'
      using errcode = 'P0001';
  end if;

  if session_row.current_game_question_id is null
    or session_row.current_question_index is null
  then
    raise exception 'Current question is not available'
      using errcode = '23514';
  end if;

  select player.*
    into player_row
    from public.players as player
   where player.game_session_id = session_row.id
     and player.auth_user_id = caller_id;

  if not found then
    raise exception 'Player not found in this game session'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.game_answer_options as game_option
     where game_option.id = p_game_answer_option_id
       and game_option.game_question_id = session_row.current_game_question_id
  ) then
    raise exception 'Answer option does not belong to the current question'
      using errcode = '22023';
  end if;

  select vote.*
    into vote_row
    from public.votes as vote
   where vote.game_session_id = session_row.id
     and vote.game_question_id = session_row.current_game_question_id
     and vote.player_id = player_row.id
   for update;

  if found then
    update public.votes as vote
       set game_answer_option_id = p_game_answer_option_id,
           submitted_at = pg_catalog.now(),
           is_correct = null,
           points_awarded = null
     where vote.id = vote_row.id
    returning vote.* into vote_row;

    resulting_voted_count := session_row.voted_count;
  else
    insert into public.votes as inserted_vote (
      game_session_id,
      game_question_id,
      player_id,
      game_answer_option_id
    )
    values (
      session_row.id,
      session_row.current_game_question_id,
      player_row.id,
      p_game_answer_option_id
    )
    returning inserted_vote.* into vote_row;

    update public.game_sessions as updated_session
       set voted_count = updated_session.voted_count + 1
     where updated_session.id = session_row.id
    returning updated_session.voted_count into resulting_voted_count;
  end if;

  return query
  select
    vote_row.game_answer_option_id,
    resulting_voted_count,
    session_row.current_question_index;
end;
$$;

create function public.get_my_current_vote(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  normalized_code text;
  session_row public.game_sessions%rowtype;
  player_row public.players%rowtype;
  selected_option_id uuid;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  normalized_code := pg_catalog.upper(pg_catalog.btrim(p_code));

  if normalized_code is null
    or normalized_code !~ '^[A-HJ-NP-Z2-9]{6}$'
  then
    raise exception 'Game code is required'
      using errcode = '22023';
  end if;

  select gs.*
    into session_row
    from public.game_sessions as gs
   where gs.code = normalized_code;

  if not found then
    raise exception 'Game session not found'
      using errcode = 'P0002';
  end if;

  select player.*
    into player_row
    from public.players as player
   where player.game_session_id = session_row.id
     and player.auth_user_id = caller_id;

  if not found then
    raise exception 'Player not found in this game session'
      using errcode = 'P0002';
  end if;

  if session_row.current_game_question_id is null then
    return null;
  end if;

  select vote.game_answer_option_id
    into selected_option_id
    from public.votes as vote
   where vote.game_session_id = session_row.id
     and vote.game_question_id = session_row.current_game_question_id
     and vote.player_id = player_row.id;

  return selected_option_id;
end;
$$;

-- The original three-argument RPC is superseded and no longer callable by
-- participant roles. Keeping the function avoids altering applied history.
revoke all privileges
  on function public.submit_vote(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all privileges
  on function public.submit_vote(text, uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.submit_vote(text, uuid)
  to authenticated;

revoke all privileges
  on function public.get_my_current_vote(text)
  from public, anon, authenticated, service_role;
grant execute
  on function public.get_my_current_vote(text)
  to authenticated;

drop policy if exists votes_select_own on public.votes;
revoke all privileges
  on table public.votes
  from public, anon, authenticated;
