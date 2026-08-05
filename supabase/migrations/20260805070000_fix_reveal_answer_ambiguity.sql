create or replace function public.reveal_current_answer(p_game_session_id uuid)
returns table (
  session_code text,
  session_phase public.game_phase,
  current_question_index integer,
  correct_game_answer_option_id uuid,
  received_votes integer,
  answer_distribution jsonb,
  non_voting_players jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_row public.game_sessions%rowtype;
  v_game_question_id uuid;
  v_correct_option_id uuid;
  v_received_votes integer;
begin
  if p_game_session_id is null then
    raise exception 'Game session id is required' using errcode = '22023';
  end if;

  select session_source.*
    into v_session_row
    from public.game_sessions as session_source
   where session_source.id = p_game_session_id
   for update;

  if not found then
    raise exception 'Game session not found' using errcode = 'P0002';
  end if;

  if v_session_row.phase <> 'voting_closed' then
    raise exception 'Answer can only be revealed after voting is closed'
      using errcode = 'P0001';
  end if;

  if v_session_row.current_game_question_id is null
    or v_session_row.current_question_index is null
  then
    raise exception 'Current question is not available'
      using errcode = '23514';
  end if;

  v_game_question_id := v_session_row.current_game_question_id;
  v_received_votes := v_session_row.voted_count;

  select solution.correct_game_answer_option_id
    into v_correct_option_id
    from public.game_question_solutions as solution
   where solution.game_question_id = v_game_question_id;

  if not found or v_correct_option_id is null then
    raise exception 'Current question solution is not available'
      using errcode = '23514';
  end if;

  update public.game_questions as revealed_question
     set revealed_at = coalesce(revealed_question.revealed_at, pg_catalog.now())
   where revealed_question.id = v_game_question_id
     and revealed_question.game_session_id = v_session_row.id;

  update public.game_sessions as revealed_session
     set phase = 'answer_revealed'
   where revealed_session.id = v_session_row.id;

  return query
  select
    v_session_row.code,
    'answer_revealed'::public.game_phase,
    v_session_row.current_question_index,
    v_correct_option_id,
    v_received_votes,
    projection.current_question -> 'options',
    projection.non_voters
  from public.lobby_public_sessions as projection
  where projection.code = v_session_row.code;
end;
$$;

revoke all privileges
  on function public.reveal_current_answer(uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.reveal_current_answer(uuid)
  to service_role;
