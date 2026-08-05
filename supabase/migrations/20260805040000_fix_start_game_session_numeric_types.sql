-- Fix numeric type resolution in start_game_session without changing behavior.

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

  -- Older lobby rows may already contain a complete snapshot. Reuse it so a
  -- migration never changes the questions of an already-created room.
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
          points
        )
        values (
          session_row.id,
          source_question_row.id,
          next_question_position,
          config_row.category_name,
          source_question_row.prompt,
          source_question_row.points
        )
        returning created_question.id into new_game_question_id;

        insert into public.game_answer_options (
          game_question_id,
          source_answer_option_id,
          position,
          label
        )
        select
          new_game_question_id,
          source_option.id,
          source_option.position,
          source_option.label
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
          'position', game_option.position
        )
        order by game_option.position
      )
      from public.game_answer_options as game_option
      where game_option.game_question_id = first_question_row.id
    ),
    0::integer;
end;
$$;

revoke all privileges
  on function public.start_game_session(uuid)
  from public, anon, authenticated, service_role;

grant execute
  on function public.start_game_session(uuid)
  to service_role;
