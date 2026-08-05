-- Close voting and reveal the current frozen answer without scoring.

alter table public.lobby_public_sessions
  add column correct_option_id uuid,
  add column non_voters jsonb not null default '[]'::jsonb;

alter table public.lobby_public_sessions
  add constraint lobby_public_sessions_non_voters_array check (
    jsonb_typeof(non_voters) = 'array'
  );

create or replace function private.refresh_public_game_session(
  target_game_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.game_sessions as gs where gs.id = target_game_session_id
  ) then
    return;
  end if;

  insert into public.lobby_public_sessions (
    code,
    quiz_title,
    phase,
    participant_count,
    max_players,
    players,
    current_question_index,
    total_question_count,
    current_question,
    voted_count,
    correct_option_id,
    non_voters
  )
  select
    gs.code,
    gs.quiz_title,
    gs.phase,
    gs.participant_count,
    gs.max_players,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'nickname', player.nickname,
            'avatar_key', player.avatar_key
          )
          order by player.joined_at, player.id
        )
        from public.players as player
        where player.game_session_id = gs.id
      ),
      '[]'::jsonb
    ),
    gs.current_question_index,
    (
      select pg_catalog.count(*)::integer
      from public.game_questions as game_question
      where game_question.game_session_id = gs.id
    ),
    case
      when gs.current_game_question_id is null then null
      else (
        select pg_catalog.jsonb_build_object(
          'id', game_question.id,
          'position', game_question.position,
          'category', game_question.category_name,
          'prompt', game_question.prompt,
          'options', coalesce(
            (
              select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'id', game_option.id,
                  'text', game_option.label,
                  'position', game_option.position
                ) ||
                case
                  when gs.phase = 'answer_revealed' then
                    pg_catalog.jsonb_build_object(
                      'is_correct',
                        game_option.id = solution.correct_game_answer_option_id,
                      'players',
                        coalesce(
                          (
                            select pg_catalog.jsonb_agg(
                              pg_catalog.jsonb_build_object(
                                'nickname', voting_player.nickname,
                                'avatar_key', voting_player.avatar_key
                              )
                              order by voting_player.joined_at, voting_player.id
                            )
                            from public.votes as vote
                            join public.players as voting_player
                              on voting_player.id = vote.player_id
                             and voting_player.game_session_id = vote.game_session_id
                            where vote.game_session_id = gs.id
                              and vote.game_question_id = game_question.id
                              and vote.game_answer_option_id = game_option.id
                          ),
                          '[]'::jsonb
                        ),
                      'vote_count',
                        (
                          select pg_catalog.count(*)::integer
                          from public.votes as vote
                          where vote.game_session_id = gs.id
                            and vote.game_question_id = game_question.id
                            and vote.game_answer_option_id = game_option.id
                        )
                    )
                  else '{}'::jsonb
                end
                order by game_option.position
              )
              from public.game_answer_options as game_option
              where game_option.game_question_id = game_question.id
            ),
            '[]'::jsonb
          )
        )
        from public.game_questions as game_question
        where game_question.id = gs.current_game_question_id
          and game_question.game_session_id = gs.id
      )
    end,
    gs.voted_count,
    case
      when gs.phase = 'answer_revealed'
        then solution.correct_game_answer_option_id
      else null
    end,
    case
      when gs.phase = 'answer_revealed' then
        coalesce(
          (
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'nickname', non_voter.nickname,
                'avatar_key', non_voter.avatar_key
              )
              order by non_voter.joined_at, non_voter.id
            )
            from public.players as non_voter
            where non_voter.game_session_id = gs.id
              and not exists (
                select 1
                from public.votes as vote
                where vote.game_session_id = gs.id
                  and vote.game_question_id = gs.current_game_question_id
                  and vote.player_id = non_voter.id
              )
          ),
          '[]'::jsonb
        )
      else '[]'::jsonb
    end
  from public.game_sessions as gs
  left join public.game_question_solutions as solution
    on solution.game_question_id = gs.current_game_question_id
  where gs.id = target_game_session_id
  on conflict (code) do update
    set quiz_title = excluded.quiz_title,
        phase = excluded.phase,
        participant_count = excluded.participant_count,
        max_players = excluded.max_players,
        players = excluded.players,
        current_question_index = excluded.current_question_index,
        total_question_count = excluded.total_question_count,
        current_question = excluded.current_question,
        voted_count = excluded.voted_count,
        correct_option_id = excluded.correct_option_id,
        non_voters = excluded.non_voters;
end;
$$;

create function public.close_current_voting(p_game_session_id uuid)
returns table (
  session_code text,
  session_phase public.game_phase,
  current_question_index integer,
  received_votes integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.game_sessions%rowtype;
begin
  if p_game_session_id is null then
    raise exception 'Game session id is required' using errcode = '22023';
  end if;

  select gs.*
    into session_row
    from public.game_sessions as gs
   where gs.id = p_game_session_id
   for update;

  if not found then
    raise exception 'Game session not found' using errcode = 'P0002';
  end if;

  if session_row.phase <> 'voting_open' then
    raise exception 'Voting can only be closed while it is open'
      using errcode = 'P0001';
  end if;

  if session_row.current_game_question_id is null
    or session_row.current_question_index is null
  then
    raise exception 'Current question is not available'
      using errcode = '23514';
  end if;

  update public.game_sessions as closed_session
     set phase = 'voting_closed'
   where closed_session.id = session_row.id;

  return query
  select
    session_row.code,
    'voting_closed'::public.game_phase,
    session_row.current_question_index,
    session_row.voted_count;
end;
$$;

create function public.reveal_current_answer(p_game_session_id uuid)
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
  session_row public.game_sessions%rowtype;
  correct_option_id uuid;
begin
  if p_game_session_id is null then
    raise exception 'Game session id is required' using errcode = '22023';
  end if;

  select gs.*
    into session_row
    from public.game_sessions as gs
   where gs.id = p_game_session_id
   for update;

  if not found then
    raise exception 'Game session not found' using errcode = 'P0002';
  end if;

  if session_row.phase <> 'voting_closed' then
    raise exception 'Answer can only be revealed after voting is closed'
      using errcode = 'P0001';
  end if;

  if session_row.current_game_question_id is null
    or session_row.current_question_index is null
  then
    raise exception 'Current question is not available'
      using errcode = '23514';
  end if;

  select solution.correct_game_answer_option_id
    into correct_option_id
    from public.game_question_solutions as solution
   where solution.game_question_id = session_row.current_game_question_id;

  if not found or correct_option_id is null then
    raise exception 'Current question solution is not available'
      using errcode = '23514';
  end if;

  update public.game_questions as revealed_question
     set revealed_at = coalesce(revealed_question.revealed_at, pg_catalog.now())
   where revealed_question.id = session_row.current_game_question_id
     and revealed_question.game_session_id = session_row.id;

  update public.game_sessions as revealed_session
     set phase = 'answer_revealed'
   where revealed_session.id = session_row.id;

  return query
  select
    session_row.code,
    'answer_revealed'::public.game_phase,
    session_row.current_question_index,
    correct_option_id,
    session_row.voted_count,
    projection.current_question -> 'options',
    projection.non_voters
  from public.lobby_public_sessions as projection
  where projection.code = session_row.code;
end;
$$;

select private.refresh_public_game_session(gs.id)
from public.game_sessions as gs;

alter table public.lobby_public_sessions
  add constraint lobby_public_sessions_reveal_data_consistent check (
    (
      phase = 'answer_revealed'
      and correct_option_id is not null
    )
    or (
      phase <> 'answer_revealed'
      and correct_option_id is null
      and non_voters = '[]'::jsonb
    )
  );

revoke all privileges
  on function public.close_current_voting(uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.close_current_voting(uuid)
  to service_role;

revoke all privileges
  on function public.reveal_current_answer(uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.reveal_current_answer(uuid)
  to service_role;

revoke all privileges
  on function private.refresh_public_game_session(uuid)
  from public, anon, authenticated, service_role;

revoke all privileges
  on table public.game_sessions,
    public.game_questions,
    public.game_answer_options,
    public.game_question_solutions,
    public.players,
    public.votes
  from public, anon, authenticated;
