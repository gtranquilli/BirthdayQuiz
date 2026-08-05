-- Persist the revealed question score and atomically advance or finish.

alter table public.lobby_public_sessions
  add column leaderboard jsonb not null default '[]'::jsonb;

alter table public.lobby_public_sessions
  add constraint lobby_public_sessions_leaderboard_array check (
    pg_catalog.jsonb_typeof(leaderboard) = 'array'
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
    select 1
      from public.game_sessions as session_exists
     where session_exists.id = target_game_session_id
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
    non_voters,
    leaderboard
  )
  select
    session_row.code,
    session_row.quiz_title,
    session_row.phase,
    session_row.participant_count,
    session_row.max_players,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'nickname', player_row.nickname,
            'avatar_key', player_row.avatar_key
          )
          order by player_row.joined_at, player_row.id
        )
          from public.players as player_row
         where player_row.game_session_id = session_row.id
      ),
      '[]'::jsonb
    ),
    session_row.current_question_index,
    (
      select pg_catalog.count(*)::integer
        from public.game_questions as question_count_row
       where question_count_row.game_session_id = session_row.id
    ),
    case
      when session_row.current_game_question_id is null then null
      else (
        select pg_catalog.jsonb_build_object(
          'id', current_question.id,
          'position', current_question.position,
          'category', current_question.category_name,
          'prompt', current_question.prompt,
          'options', coalesce(
            (
              select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'id', option_row.id,
                  'text', option_row.label,
                  'position', option_row.position
                ) ||
                case
                  when session_row.phase = 'answer_revealed' then
                    pg_catalog.jsonb_build_object(
                      'is_correct',
                        option_row.id = solution.correct_game_answer_option_id,
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
                              from public.votes as vote_row
                              join public.players as voting_player
                                on voting_player.id = vote_row.player_id
                               and voting_player.game_session_id = vote_row.game_session_id
                             where vote_row.game_session_id = session_row.id
                               and vote_row.game_question_id = current_question.id
                               and vote_row.game_answer_option_id = option_row.id
                          ),
                          '[]'::jsonb
                        ),
                      'vote_count',
                        (
                          select pg_catalog.count(*)::integer
                            from public.votes as option_vote
                           where option_vote.game_session_id = session_row.id
                             and option_vote.game_question_id = current_question.id
                             and option_vote.game_answer_option_id = option_row.id
                        )
                    )
                  else '{}'::jsonb
                end
                order by option_row.position
              )
                from public.game_answer_options as option_row
               where option_row.game_question_id = current_question.id
            ),
            '[]'::jsonb
          )
        )
          from public.game_questions as current_question
         where current_question.id = session_row.current_game_question_id
           and current_question.game_session_id = session_row.id
      )
    end,
    session_row.voted_count,
    case
      when session_row.phase = 'answer_revealed'
        then solution.correct_game_answer_option_id
      else null
    end,
    case
      when session_row.phase = 'answer_revealed' then
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
             where non_voter.game_session_id = session_row.id
               and not exists (
                 select 1
                   from public.votes as non_voter_vote
                  where non_voter_vote.game_session_id = session_row.id
                    and non_voter_vote.game_question_id = session_row.current_game_question_id
                    and non_voter_vote.player_id = non_voter.id
               )
          ),
          '[]'::jsonb
        )
      else '[]'::jsonb
    end,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'rank', ranked_player.leaderboard_rank,
            'nickname', ranked_player.nickname,
            'avatar_key', ranked_player.avatar_key,
            'score', ranked_player.effective_score,
            'current_points', ranked_player.current_points
          )
          order by
            ranked_player.effective_score desc,
            ranked_player.joined_at,
            ranked_player.player_id
        )
          from (
            select
              scored_player.*,
              pg_catalog.rank() over (
                order by scored_player.effective_score desc
              )::integer as leaderboard_rank
              from (
                select
                  player_score.id as player_id,
                  player_score.nickname,
                  player_score.avatar_key,
                  player_score.joined_at,
                  player_score.total_score +
                    case
                      when session_row.phase = 'answer_revealed'
                        and current_vote.points_awarded is null
                        and current_vote.game_answer_option_id =
                          solution.correct_game_answer_option_id
                        then current_score_question.points
                      else 0
                    end as effective_score,
                  case
                    when session_row.phase = 'answer_revealed' then
                      coalesce(
                        current_vote.points_awarded,
                        case
                          when current_vote.game_answer_option_id =
                            solution.correct_game_answer_option_id
                            then current_score_question.points
                          else 0
                        end
                      )
                    else 0
                  end as current_points
                  from public.players as player_score
                  left join public.votes as current_vote
                    on current_vote.game_session_id = session_row.id
                   and current_vote.game_question_id =
                     session_row.current_game_question_id
                   and current_vote.player_id = player_score.id
                  left join public.game_questions as current_score_question
                    on current_score_question.id =
                      session_row.current_game_question_id
                   and current_score_question.game_session_id = session_row.id
                 where player_score.game_session_id = session_row.id
              ) as scored_player
          ) as ranked_player
      ),
      '[]'::jsonb
    )
  from public.game_sessions as session_row
  left join public.game_question_solutions as solution
    on solution.game_question_id = session_row.current_game_question_id
  where session_row.id = target_game_session_id
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
        non_voters = excluded.non_voters,
        leaderboard = excluded.leaderboard;
end;
$$;

create function public.score_and_advance_game_session(
  p_game_session_id uuid
)
returns table (
  session_code text,
  session_phase public.game_phase,
  current_question_index integer,
  total_question_count integer,
  leaderboard jsonb,
  current_question jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_row public.game_sessions%rowtype;
  v_next_question_row public.game_questions%rowtype;
  v_game_question_id uuid;
  v_correct_option_id uuid;
  v_question_points integer;
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

  if v_session_row.phase <> 'answer_revealed' then
    raise exception 'Scoring is only allowed after the answer is revealed'
      using errcode = 'P0001';
  end if;

  if v_session_row.current_game_question_id is null
    or v_session_row.current_question_index is null
  then
    raise exception 'Current question is not available'
      using errcode = '23514';
  end if;

  v_game_question_id := v_session_row.current_game_question_id;

  select
    question_row.points,
    solution_row.correct_game_answer_option_id
    into v_question_points, v_correct_option_id
    from public.game_questions as question_row
    join public.game_question_solutions as solution_row
      on solution_row.game_question_id = question_row.id
   where question_row.id = v_game_question_id
     and question_row.game_session_id = v_session_row.id;

  if not found
    or v_question_points is null
    or v_correct_option_id is null
  then
    raise exception 'Current question solution or score is not available'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.votes as evaluated_vote
     where evaluated_vote.game_session_id = v_session_row.id
       and evaluated_vote.game_question_id = v_game_question_id
       and (
         evaluated_vote.is_correct is not null
         or evaluated_vote.points_awarded is not null
       )
  ) then
    raise exception 'Current question has already been scored'
      using errcode = 'P0001';
  end if;

  with evaluated_votes as (
    update public.votes as vote_row
       set is_correct =
             vote_row.game_answer_option_id = v_correct_option_id,
           points_awarded =
             case
               when vote_row.game_answer_option_id = v_correct_option_id
                 then v_question_points
               else 0
             end
     where vote_row.game_session_id = v_session_row.id
       and vote_row.game_question_id = v_game_question_id
    returning vote_row.player_id, vote_row.points_awarded
  ), player_awards as (
    select
      evaluated_vote.player_id,
      pg_catalog.sum(evaluated_vote.points_awarded)::integer as awarded_points
      from evaluated_votes as evaluated_vote
     group by evaluated_vote.player_id
  )
  update public.players as scored_player
     set total_score = scored_player.total_score + player_award.awarded_points
    from player_awards as player_award
   where scored_player.id = player_award.player_id
     and scored_player.game_session_id = v_session_row.id;

  select next_question.*
    into v_next_question_row
    from public.game_questions as next_question
   where next_question.game_session_id = v_session_row.id
     and next_question.position = v_session_row.current_question_index + 2
   limit 1;

  if found then
    update public.game_questions as opened_question
       set revealed_at = null
     where opened_question.id = v_next_question_row.id
       and opened_question.game_session_id = v_session_row.id;

    update public.game_sessions as advanced_session
       set phase = 'voting_open',
           current_game_question_id = v_next_question_row.id,
           current_question_index = v_session_row.current_question_index + 1,
           voted_count = 0,
           finished_at = null
     where advanced_session.id = v_session_row.id;
  else
    update public.game_sessions as finished_session
       set phase = 'finished',
           current_game_question_id = null,
           voted_count = 0,
           finished_at = pg_catalog.now()
     where finished_session.id = v_session_row.id;
  end if;

  return query
  select
    projection.code,
    projection.phase,
    projection.current_question_index,
    projection.total_question_count,
    projection.leaderboard,
    projection.current_question
    from public.lobby_public_sessions as projection
   where projection.code = v_session_row.code;
end;
$$;

select private.refresh_public_game_session(session_row.id)
from public.game_sessions as session_row;

revoke all privileges
  on function public.score_and_advance_game_session(uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.score_and_advance_game_session(uuid)
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
