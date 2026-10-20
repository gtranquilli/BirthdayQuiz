-- Independent exams. Existing sessions and presentation RPC signatures stay compatible.
alter table public.game_sessions
  add column mode text not null default 'presentation' check (mode in ('presentation', 'exam')),
  add column exam_question_count integer,
  add constraint game_sessions_exam_config check (
    (mode = 'presentation' and exam_question_count is null) or
    (mode = 'exam' and exam_question_count between 1 and 32767 and exam_question_count is not null and source_preset_id is null)
  ),
  add constraint game_sessions_exam_phase check (mode <> 'exam' or phase in ('lobby', 'voting_open', 'finished'));
alter table public.lobby_public_sessions
  add column mode text not null default 'presentation' check (mode in ('presentation', 'exam')),
  add column submitted_count integer not null default 0 check (submitted_count >= 0);

create table public.exam_progress (
  player_id uuid primary key,
  game_session_id uuid not null,
  last_index integer not null default 0 check (last_index >= 0),
  submitted_at timestamptz,
  result jsonb,
  foreign key (player_id, game_session_id) references public.players(id, game_session_id) on delete cascade,
  unique (player_id, game_session_id),
  check ((submitted_at is null and result is null) or (submitted_at is not null and result is not null))
);
create index exam_progress_session_idx on public.exam_progress(game_session_id);
create table public.exam_answers (
  player_id uuid not null,
  game_session_id uuid not null,
  game_question_id uuid not null,
  game_answer_option_id uuid not null,
  confirmed_at timestamptz not null default now(),
  primary key (player_id, game_question_id),
  foreign key (player_id, game_session_id) references public.exam_progress(player_id, game_session_id) on delete cascade,
  foreign key (game_question_id, game_session_id) references public.game_questions(id, game_session_id) on delete cascade,
  foreign key (game_answer_option_id, game_question_id) references public.game_answer_options(id, game_question_id) on delete cascade
);
alter table public.exam_progress enable row level security;
alter table public.exam_answers enable row level security;
revoke all on public.exam_progress, public.exam_answers from public, anon, authenticated, service_role;
-- No direct client policies or Realtime publication: identity-bound RPCs only.

create or replace function private.refresh_public_game_session(
  target_game_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.game_sessions where id = target_game_session_id and mode = 'exam') then
    insert into public.lobby_public_sessions (
      code, quiz_title, phase, participant_count, max_players, players,
      current_question_index, total_question_count, current_question, voted_count,
      correct_option_id, non_voters, leaderboard, mode, submitted_count
    )
    select s.code, s.quiz_title, s.phase, s.participant_count, s.max_players,
      coalesce((select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'avatar_key', p.avatar_key)
        order by p.joined_at, p.id) from public.players p where p.game_session_id = s.id), '[]'::jsonb),
      null, s.exam_question_count, null, 0, null, '[]'::jsonb, '[]'::jsonb, 'exam',
      (select count(*)::integer from public.exam_progress e where e.game_session_id = s.id and e.submitted_at is not null)
    from public.game_sessions s where s.id = target_game_session_id
    on conflict (code) do update set quiz_title = excluded.quiz_title, phase = excluded.phase,
      participant_count = excluded.participant_count, max_players = excluded.max_players,
      players = excluded.players, current_question_index = null, total_question_count = excluded.total_question_count,
      current_question = null, voted_count = 0, correct_option_id = null, non_voters = '[]'::jsonb,
      leaderboard = '[]'::jsonb, mode = 'exam', submitted_count = excluded.submitted_count;
    return;
  end if;
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


-- Mode guard; presentation behavior unchanged.
create or replace function public.start_game_session(p_game_session_id uuid)
returns table (
  session_code text,
  session_phase public.game_phase,
  question_index integer,
  total_questions integer,
  question_id uuid,
  question_position smallint,
  question_category text,
  question_prompt text,
  question_options jsonb,
  received_votes integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.game_sessions%rowtype;
  config_row public.game_session_category_config%rowtype;
  source_question_row public.questions%rowtype;
  first_question_row public.game_questions%rowtype;
  configured_question_count integer;
  existing_question_count integer;
  available_question_count integer;
  selected_question_count integer;
  copied_option_count integer;
  copied_solution_count integer;
  next_question_position integer := 0::integer;
  new_game_question_id uuid;
begin
  if p_game_session_id is null then
    raise exception 'Game session id is required' using errcode = '22023';
  end if;

  select gs.*
    into session_row
    from public.game_sessions as gs
   where gs.id = p_game_session_id
   for update;

  if session_row.mode = 'exam' then
    raise exception 'Presentation operation is unavailable for exams' using errcode = 'P0001';
  end if;

  if not found then
    raise exception 'Game session not found' using errcode = 'P0002';
  end if;

  if session_row.phase <> 'lobby' then
    raise exception 'Game session can only be started from the lobby'
      using errcode = 'P0001';
  end if;

  if session_row.participant_count < 1 or not exists (
    select 1
      from public.players as p
     where p.game_session_id = session_row.id
  ) then
    raise exception 'At least one participant is required to start the game'
      using errcode = 'P0001';
  end if;

  select coalesce(
    pg_catalog.sum(config.question_count)::bigint,
    0::bigint
  )::integer
    into configured_question_count
    from public.game_session_category_config as config
   where config.game_session_id = session_row.id;

  if configured_question_count < 1 then
    raise exception 'The session has no configured questions'
      using errcode = 'P0001';
  end if;

  select pg_catalog.count(*)::integer
    into existing_question_count
    from public.game_questions as game_question
   where game_question.game_session_id = session_row.id;

  if existing_question_count = 0 then
    if session_row.source_quiz_id is null then
      raise exception 'The source quiz is no longer available'
        using errcode = 'P0001';
    end if;

    for config_row in
      select config.*
        from public.game_session_category_config as config
       where config.game_session_id = session_row.id
       order by config.position
    loop
      if config_row.question_count = 0 then
        continue;
      end if;

      if config_row.source_category_id is null then
        raise exception 'Configured category % is no longer available',
          config_row.category_name
          using errcode = 'P0001';
      end if;

      select pg_catalog.count(*)::integer
        into available_question_count
        from public.questions as source_question
       where source_question.category_id = config_row.source_category_id;

      if available_question_count < config_row.question_count then
        raise exception
          'Not enough questions for category %: requested %, available %',
          config_row.category_name,
          config_row.question_count,
          available_question_count
          using errcode = 'P0001';
      end if;

      selected_question_count := 0::integer;

      for source_question_row in
        select source_question.*
          from public.questions as source_question
         where source_question.category_id = config_row.source_category_id
         order by pg_catalog.md5(
           session_row.id::text || ':' || source_question.id::text
         ), source_question.id
         limit config_row.question_count
         for share
      loop
        selected_question_count := selected_question_count + 1::integer;
        next_question_position := next_question_position + 1::integer;

        insert into public.game_questions as created_question (
          game_session_id,
          source_question_id,
          position,
          category_name,
          prompt,
          points,
          image_storage_path,
          image_alt_text,
          image_width,
          image_height,
          image_updated_at
        )
        values (
          session_row.id,
          source_question_row.id,
          next_question_position,
          config_row.category_name,
          source_question_row.prompt,
          source_question_row.points,
          source_question_row.image_storage_path,
          source_question_row.image_alt_text,
          source_question_row.image_width,
          source_question_row.image_height,
          source_question_row.image_updated_at
        )
        returning created_question.id into new_game_question_id;

        insert into public.game_answer_options (
          game_question_id,
          source_answer_option_id,
          position,
          label,
          image_storage_path,
          image_alt_text,
          image_width,
          image_height,
          image_updated_at
        )
        select
          new_game_question_id,
          source_option.id,
          source_option.position,
          source_option.label,
          source_option.image_storage_path,
          source_option.image_alt_text,
          source_option.image_width,
          source_option.image_height,
          source_option.image_updated_at
        from public.answer_options as source_option
        where source_option.question_id = source_question_row.id
        order by source_option.position;

        get diagnostics copied_option_count = row_count;

        if copied_option_count <> 4 then
          raise exception 'Source question % does not have exactly four options',
            source_question_row.id
            using errcode = '23514';
        end if;

        insert into public.game_question_solutions (
          game_question_id,
          correct_game_answer_option_id
        )
        select
          new_game_question_id,
          snapshot_option.id
        from public.question_solutions as source_solution
        join public.game_answer_options as snapshot_option
          on snapshot_option.game_question_id = new_game_question_id
         and snapshot_option.source_answer_option_id =
           source_solution.correct_answer_option_id
        where source_solution.question_id = source_question_row.id;

        get diagnostics copied_solution_count = row_count;

        if copied_solution_count <> 1 then
          raise exception 'Source question % does not have one valid solution',
            source_question_row.id
            using errcode = '23514';
        end if;
      end loop;

      if selected_question_count <> config_row.question_count then
        raise exception 'Question availability changed while starting the game'
          using errcode = '40001';
      end if;
    end loop;
  elsif existing_question_count <> configured_question_count then
    raise exception 'The existing question snapshot is incomplete'
      using errcode = '23514';
  end if;

  select game_question.*
    into first_question_row
    from public.game_questions as game_question
   where game_question.game_session_id = session_row.id
     and game_question.position = 1;

  if not found then
    raise exception 'The first game question is missing' using errcode = '23514';
  end if;

  update public.game_sessions as started_session
     set phase = 'voting_open',
         current_game_question_id = first_question_row.id,
         current_question_index = 0::integer,
         voted_count = 0::integer,
         started_at = pg_catalog.now()
   where started_session.id = session_row.id;

  return query
  select
    session_row.code,
    'voting_open'::public.game_phase,
    0::integer,
    configured_question_count::integer,
    first_question_row.id,
    first_question_row.position,
    first_question_row.category_name,
    first_question_row.prompt,
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', game_option.id,
          'text', game_option.label,
          'position', game_option.position,
          'image_storage_path', game_option.image_storage_path,
          'image_alt_text', game_option.image_alt_text,
          'image_width', game_option.image_width,
          'image_height', game_option.image_height,
          'image_updated_at', game_option.image_updated_at
        )
        order by game_option.position
      )
      from public.game_answer_options as game_option
      where game_option.game_question_id = first_question_row.id
    ),
    0::integer;
end;
$$;

-- Mode guard; presentation behavior unchanged.
create or replace function public.submit_vote(
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

  if session_row.mode = 'exam' then
    raise exception 'Presentation operation is unavailable for exams' using errcode = 'P0001';
  end if;

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

-- Mode guard; presentation behavior unchanged.
create or replace function public.get_my_current_vote(p_code text)
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

  if session_row.mode = 'exam' then
    raise exception 'Presentation operation is unavailable for exams' using errcode = 'P0001';
  end if;

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

-- Mode guard; presentation behavior unchanged.
create or replace function public.close_current_voting(p_game_session_id uuid)
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

  if session_row.mode = 'exam' then
    raise exception 'Presentation operation is unavailable for exams' using errcode = 'P0001';
  end if;

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

-- Mode guard; presentation behavior unchanged.
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

  if v_session_row.mode = 'exam' then
    raise exception 'Presentation operation is unavailable for exams' using errcode = 'P0001';
  end if;

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

-- Mode guard; presentation behavior unchanged.
create or replace function public.score_and_advance_game_session(
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

  if v_session_row.mode = 'exam' then
    raise exception 'Presentation operation is unavailable for exams' using errcode = 'P0001';
  end if;

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

-- Count only complete questions; source constraints validate text/media and option ownership.
create function public.get_exam_question_count(p_quiz_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.questions q
  join public.quiz_categories c on c.id = q.category_id
  join public.question_solutions s on s.question_id = q.id
  where c.quiz_id = p_quiz_id and (select count(*) from public.answer_options a where a.question_id = q.id) = 4;
$$;

create function public.create_exam_session(p_quiz_id uuid, p_max_players integer, p_question_count integer)
returns table(game_session_id uuid, session_code text, quiz_title text, max_players integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_quiz public.quizzes%rowtype;
  v_id uuid;
  v_code text;
  v_bytes bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i integer;
  attempt integer;
begin
  if p_max_players is null or p_max_players <= 0 or p_question_count is null or p_question_count not between 1 and 32767 then
    raise exception 'Invalid exam configuration' using errcode = '22023';
  end if;
  select * into v_quiz from public.quizzes where id = p_quiz_id for share;
  if not found then raise exception 'Quiz not found' using errcode = 'P0002'; end if;
  if p_question_count > public.get_exam_question_count(p_quiz_id) then
    raise exception 'Not enough valid questions' using errcode = '22023';
  end if;
  for attempt in 1..10 loop
    v_bytes := uuid_send(gen_random_uuid()); v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    end loop;
    begin
      insert into public.game_sessions(code, source_quiz_id, quiz_title, preset_name, max_players, mode, exam_question_count)
      values(v_code, p_quiz_id, v_quiz.title, 'Esame', p_max_players, 'exam', p_question_count) returning id into v_id;
      exit;
    exception when unique_violation then v_id := null;
    end;
  end loop;
  if v_id is null then raise exception 'Unable to generate a room code'; end if;
  return query select v_id, v_code, v_quiz.title, p_max_players;
end;
$$;

create function public.start_exam_session(p_game_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.game_sessions%rowtype;
  q record;
  v_question_id uuid;
  v_first_id uuid;
  v_position integer := 0;
  v_options integer;
  v_solutions integer;
begin
  select * into s from public.game_sessions where id = p_game_session_id for update;
  if not found then raise exception 'Game session not found' using errcode = 'P0002'; end if;
  if s.mode <> 'exam' then raise exception 'Not an exam' using errcode = '22023'; end if;
  if s.phase <> 'lobby' then return; end if; -- Retry never replaces the frozen exam.
  if s.participant_count < 1 then
    raise exception 'At least one participant is required' using errcode = 'P0001';
  end if;
  -- Source content is read under a shared table lock, including options/solutions/media,
  -- so concurrent host edits cannot produce a mixed snapshot.
  lock table public.questions, public.quiz_categories, public.answer_options, public.question_solutions in share mode;
  if s.source_quiz_id is null or public.get_exam_question_count(s.source_quiz_id) < s.exam_question_count then
    raise exception 'Not enough valid questions' using errcode = 'P0001';
  end if;
  for q in
    select source.*, c.name as category_name from public.questions source
    join public.quiz_categories c on c.id = source.category_id
    join public.question_solutions sol on sol.question_id = source.id
    where c.quiz_id = s.source_quiz_id
      and (select count(*) from public.answer_options a where a.question_id = source.id) = 4
    order by random(), source.id limit s.exam_question_count
  loop
    v_position := v_position + 1;
    insert into public.game_questions(game_session_id, source_question_id, position, category_name, prompt, points,
      image_storage_path, image_alt_text, image_width, image_height, image_updated_at)
    values(s.id, q.id, v_position, q.category_name, q.prompt, q.points,
      q.image_storage_path, q.image_alt_text, q.image_width, q.image_height, q.image_updated_at)
    returning id into v_question_id;
    if v_position = 1 then v_first_id := v_question_id; end if;
    insert into public.game_answer_options(game_question_id, source_answer_option_id, position, label,
      image_storage_path, image_alt_text, image_width, image_height, image_updated_at)
    select v_question_id, a.id, a.position, a.label,
      a.image_storage_path, a.image_alt_text, a.image_width, a.image_height, a.image_updated_at
    from public.answer_options a where a.question_id = q.id order by a.position;
    get diagnostics v_options = row_count;
    insert into public.game_question_solutions(game_question_id, correct_game_answer_option_id)
    select v_question_id, a.id from public.question_solutions sol
    join public.game_answer_options a on a.source_answer_option_id = sol.correct_answer_option_id and a.game_question_id = v_question_id
    where sol.question_id = q.id;
    get diagnostics v_solutions = row_count;
    if v_options <> 4 or v_solutions <> 1 then raise exception 'Incomplete snapshot' using errcode = '23514'; end if;
  end loop;
  if v_position <> s.exam_question_count then raise exception 'Incomplete snapshot' using errcode = '23514'; end if;
  insert into public.exam_progress(player_id, game_session_id)
    select p.id, s.id from public.players p where p.game_session_id = s.id;
  -- Current question is an internal compatibility pointer, never exposed for exam rooms.
  update public.game_sessions set phase = 'voting_open', started_at = now(),
    current_game_question_id = v_first_id, current_question_index = 0 where id = s.id;
end;
$$;

-- Private projection shared by the authenticated player RPC and the authorized host RPC.
create function private.exam_player_snapshot(p_player_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'player_id', e.player_id, 'last_index', e.last_index, 'submitted_at', e.submitted_at, 'result', e.result,
    'completed_count', (select count(*) from public.exam_answers a where a.player_id = e.player_id),
    'questions', (select jsonb_agg(jsonb_build_object(
      'id', q.id, 'position', q.position, 'category', q.category_name, 'prompt', q.prompt,
      'image_storage_path', q.image_storage_path, 'image_alt_text', q.image_alt_text,
      'image_width', q.image_width, 'image_height', q.image_height, 'image_updated_at', q.image_updated_at,
      'selected_option_id', a.game_answer_option_id,
      'correct_option_id', case when e.submitted_at is not null then sol.correct_game_answer_option_id else null end,
      'options', (select jsonb_agg(jsonb_build_object(
        'id', o.id, 'position', o.position, 'text', o.label,
        'image_storage_path', o.image_storage_path, 'image_alt_text', o.image_alt_text,
        'image_width', o.image_width, 'image_height', o.image_height, 'image_updated_at', o.image_updated_at
      ) order by o.position) from public.game_answer_options o where o.game_question_id = q.id)
    ) order by q.position)
    from public.game_questions q
    join public.game_question_solutions sol on sol.game_question_id = q.id
    left join public.exam_answers a on a.game_question_id = q.id and a.player_id = e.player_id
    where q.game_session_id = e.game_session_id)
  ) from public.exam_progress e where e.player_id = p_player_id;
$$;

create function public.get_my_exam_progress(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_player_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Same session lock order as save, submit and rejoin: one consistent recovery snapshot.
  perform 1 from public.game_sessions where code = upper(btrim(p_code)) and mode = 'exam' for share;
  select p.id into v_player_id from public.players p join public.game_sessions s on s.id = p.game_session_id
  where s.code = upper(btrim(p_code)) and s.mode = 'exam' and p.auth_user_id = auth.uid();
  if not found then raise exception 'Player not found' using errcode = '42501'; end if;
  return private.exam_player_snapshot(v_player_id);
end;
$$;

-- Navigation persists separately from confirmation; null question means position-only.
-- A null option with a question explicitly clears that confirmed answer.
create function public.save_exam_progress(p_code text, p_last_index integer,
  p_game_question_id uuid default null, p_game_answer_option_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.game_sessions%rowtype; e public.exam_progress%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into s from public.game_sessions where code = upper(btrim(p_code)) for update;
  if not found or s.mode <> 'exam' then raise exception 'Exam not found' using errcode = '22023'; end if;
  select ep.* into e from public.exam_progress ep join public.players p on p.id = ep.player_id
    where ep.game_session_id = s.id and p.auth_user_id = auth.uid() for update of ep;
  if not found then raise exception 'Player not found' using errcode = '42501'; end if;
  if e.submitted_at is not null or s.phase <> 'voting_open' then
    raise exception 'Exam already submitted or inactive' using errcode = 'P0001';
  end if;
  if p_last_index is null or p_last_index < 0 or p_last_index >= s.exam_question_count or
    (p_game_question_id is null and p_game_answer_option_id is not null) then
    raise exception 'Invalid position or answer' using errcode = '22023';
  end if;
  if p_game_question_id is not null then
    if not exists (select 1 from public.game_questions where id = p_game_question_id and game_session_id = s.id) or
      (p_game_answer_option_id is not null and not exists (
        select 1 from public.game_answer_options where id = p_game_answer_option_id and game_question_id = p_game_question_id)) then
      raise exception 'Invalid question or option' using errcode = '22023';
    end if;
    if p_game_answer_option_id is null then
      delete from public.exam_answers where player_id = e.player_id and game_question_id = p_game_question_id;
    else
      insert into public.exam_answers(player_id, game_session_id, game_question_id, game_answer_option_id)
        values(e.player_id, s.id, p_game_question_id, p_game_answer_option_id)
        on conflict (player_id, game_question_id) do update
          set game_answer_option_id = excluded.game_answer_option_id, confirmed_at = now();
    end if;
  end if;
  update public.exam_progress set last_index = p_last_index where player_id = e.player_id;
  -- Notify host through the safe projection; never publish answers/progress rows.
  perform private.refresh_public_game_session(s.id);
  return private.exam_player_snapshot(e.player_id);
end;
$$;

create function public.submit_exam(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.game_sessions%rowtype; e public.exam_progress%rowtype;
  v_correct integer; v_answered integer; v_points integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Shared lock with answer saves, start, join and rejoin serializes concurrent requests.
  select * into s from public.game_sessions where code = upper(btrim(p_code)) for update;
  if not found or s.mode <> 'exam' then raise exception 'Exam not found' using errcode = '22023'; end if;
  select ep.* into e from public.exam_progress ep join public.players p on p.id = ep.player_id
    where ep.game_session_id = s.id and p.auth_user_id = auth.uid() for update of ep;
  if not found then raise exception 'Player not found' using errcode = '42501'; end if;
  if e.submitted_at is not null then return private.exam_player_snapshot(e.player_id); end if;
  if s.phase <> 'voting_open' then raise exception 'Exam inactive' using errcode = 'P0001'; end if;
  select count(a.game_answer_option_id)::integer,
    count(*) filter (where a.game_answer_option_id = sol.correct_game_answer_option_id)::integer,
    coalesce(sum(case when a.game_answer_option_id = sol.correct_game_answer_option_id then q.points else 0 end),0)::integer
  into v_answered, v_correct, v_points
  from public.game_questions q join public.game_question_solutions sol on sol.game_question_id = q.id
  left join public.exam_answers a on a.game_question_id = q.id and a.player_id = e.player_id
  where q.game_session_id = s.id;
  update public.exam_progress set submitted_at = now(), result = jsonb_build_object(
    'total', s.exam_question_count, 'correct', v_correct, 'incorrect', v_answered-v_correct,
    'omitted', s.exam_question_count-v_answered, 'percentage', round(100.0*v_correct/s.exam_question_count,2), 'points', v_points
  ) where player_id = e.player_id;
  -- Exam scores never enter players.total_score or the presentation leaderboard.
  if not exists (select 1 from public.exam_progress where game_session_id = s.id and submitted_at is null) then
    update public.game_sessions set phase = 'finished', finished_at = now() where id = s.id;
  end if;
  perform private.refresh_public_game_session(s.id);
  return private.exam_player_snapshot(e.player_id);
end;
$$;

create function public.get_host_exam_progress(p_code text, p_player_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.game_sessions%rowtype;
begin
  select * into s from public.game_sessions where code = upper(btrim(p_code)) and mode = 'exam' for share;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if p_player_id is not null then
    if not exists (select 1 from public.exam_progress where player_id = p_player_id and game_session_id = s.id and submitted_at is not null) then
      raise exception 'Submitted result not found' using errcode = 'P0002';
    end if;
    return private.exam_player_snapshot(p_player_id);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'playerId', p.id, 'nickname', p.nickname, 'avatarKey', p.avatar_key,
    'completedCount', (select count(*) from public.exam_answers a where a.player_id = p.id),
    'submittedAt', e.submitted_at, 'points', e.result->'points'
  ) order by p.joined_at, p.id) from public.players p
    left join public.exam_progress e on e.player_id = p.id where p.game_session_id = s.id), '[]'::jsonb);
end;
$$;

revoke all on function public.get_exam_question_count(uuid), public.create_exam_session(uuid,integer,integer),
  public.start_exam_session(uuid), public.get_host_exam_progress(text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_exam_question_count(uuid), public.create_exam_session(uuid,integer,integer),
  public.start_exam_session(uuid), public.get_host_exam_progress(text,uuid) to service_role;
revoke all on function private.exam_player_snapshot(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_my_exam_progress(text), public.save_exam_progress(text,integer,uuid,uuid),
  public.submit_exam(text) from public, anon, authenticated, service_role;
grant execute on function public.get_my_exam_progress(text), public.save_exam_progress(text,integer,uuid,uuid),
  public.submit_exam(text) to authenticated;
