-- Quiz Engine MVP: atomic server-side game session creation.

create function public.create_game_session(
  p_quiz_id uuid,
  p_preset_id uuid,
  p_max_players integer,
  p_category_config jsonb
)
returns table (
  game_session_id uuid,
  session_code text,
  quiz_title text,
  max_players integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  quiz_row public.quizzes%rowtype;
  preset_row public.quiz_presets%rowtype;
  category_row public.quiz_categories%rowtype;
  source_question_row public.questions%rowtype;
  category_config_item jsonb;
  category_config_row record;
  configured_category_ids uuid[] := array[]::uuid[];
  parsed_category_id uuid;
  parsed_question_count integer;
  available_question_count bigint;
  total_question_count bigint := 0;
  effective_preset_name text;
  room_code_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  random_uuid_bytes bytea;
  candidate_code text;
  room_code_attempt integer;
  room_code_character_index integer;
  new_game_session_id uuid;
  new_game_question_id uuid;
  global_question_position integer := 0;
  selected_question_count integer;
  copied_option_count integer;
  copied_solution_count integer;
begin
  if p_quiz_id is null then
    raise exception 'Quiz id is required'
      using errcode = '22023';
  end if;

  if p_max_players is null or p_max_players <= 0 then
    raise exception 'Maximum players must be greater than zero'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_category_config) is distinct from 'array' then
    raise exception 'Category configuration must be an array'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_category_config) = 0 then
    raise exception 'Category configuration must not be empty'
      using errcode = '22023';
  end if;

  select q.*
    into quiz_row
    from public.quizzes as q
   where q.id = p_quiz_id
   for share;

  if not found then
    raise exception 'Quiz not found'
      using errcode = 'P0002';
  end if;

  if p_preset_id is null then
    effective_preset_name := 'Configurazione personalizzata';
  else
    select qp.*
      into preset_row
      from public.quiz_presets as qp
     where qp.id = p_preset_id
       and qp.quiz_id = p_quiz_id
     for share;

    if not found then
      raise exception 'Preset not found for the selected quiz'
        using errcode = '22023';
    end if;

    effective_preset_name := preset_row.name;
  end if;

  for category_config_item in
    select config.value
      from pg_catalog.jsonb_array_elements(p_category_config) as config(value)
  loop
    if pg_catalog.jsonb_typeof(category_config_item) <> 'object'
      or not (category_config_item ? 'category_id')
      or not (category_config_item ? 'question_count')
      or pg_catalog.jsonb_typeof(category_config_item -> 'category_id') <> 'string'
      or pg_catalog.jsonb_typeof(category_config_item -> 'question_count') <> 'number'
    then
      raise exception 'Each category configuration requires category_id and question_count'
        using errcode = '22023';
    end if;

    begin
      parsed_category_id := (category_config_item ->> 'category_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Category id must be a valid UUID'
          using errcode = '22023';
    end;

    if (category_config_item ->> 'question_count')
      !~ '^(0|[1-9][0-9]*)$'
    then
      raise exception 'Question count must be a non-negative integer'
        using errcode = '22023';
    end if;

    begin
      parsed_question_count :=
        (category_config_item ->> 'question_count')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Question count is outside the supported range'
          using errcode = '22023';
    end;

    if parsed_category_id = any(configured_category_ids) then
      raise exception 'A category can appear only once in the configuration'
        using errcode = '22023';
    end if;

    configured_category_ids := pg_catalog.array_append(
      configured_category_ids,
      parsed_category_id
    );

    select qc.*
      into category_row
      from public.quiz_categories as qc
     where qc.id = parsed_category_id
       and qc.quiz_id = p_quiz_id
     for share;

    if not found then
      raise exception 'Configured category does not belong to the selected quiz'
        using errcode = '22023';
    end if;

    select pg_catalog.count(*)
      into available_question_count
      from public.questions as q
     where q.category_id = parsed_category_id;

    if parsed_question_count > available_question_count then
      raise exception 'Not enough questions for category %', category_row.name
        using errcode = '22023';
    end if;

    total_question_count := total_question_count + parsed_question_count;
  end loop;

  if total_question_count = 0 then
    raise exception 'At least one question must be selected'
      using errcode = '22023';
  end if;

  if total_question_count > 32767 then
    raise exception 'Too many questions for a game session'
      using errcode = '22023';
  end if;

  for room_code_attempt in 1..32 loop
    random_uuid_bytes := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    candidate_code := '';

    for room_code_character_index in 0..5 loop
      candidate_code := candidate_code || pg_catalog.substr(
        room_code_alphabet,
        (pg_catalog.get_byte(
          random_uuid_bytes,
          room_code_character_index
        ) % pg_catalog.char_length(room_code_alphabet)) + 1,
        1
      );
    end loop;

    begin
      insert into public.game_sessions as created_session (
        code,
        source_quiz_id,
        quiz_title,
        source_preset_id,
        preset_name,
        max_players,
        phase,
        current_game_question_id,
        participant_count,
        voted_count
      )
      values (
        candidate_code,
        quiz_row.id,
        quiz_row.title,
        p_preset_id,
        effective_preset_name,
        p_max_players,
        'lobby',
        null,
        0,
        0
      )
      returning created_session.id into new_game_session_id;

      exit;
    exception
      when unique_violation then
        new_game_session_id := null;
    end;
  end loop;

  if new_game_session_id is null then
    raise exception 'Unable to generate a unique game session code'
      using errcode = 'P0001';
  end if;

  for category_config_row in
    select
      qc.id as category_id,
      qc.name as category_name,
      qc.position as category_position,
      (config.value ->> 'question_count')::integer as question_count
    from pg_catalog.jsonb_array_elements(p_category_config) as config(value)
    join public.quiz_categories as qc
      on qc.id = (config.value ->> 'category_id')::uuid
     and qc.quiz_id = p_quiz_id
    order by qc.position
  loop
    insert into public.game_session_category_config (
      game_session_id,
      source_category_id,
      position,
      category_name,
      question_count
    )
    values (
      new_game_session_id,
      category_config_row.category_id,
      category_config_row.category_position,
      category_config_row.category_name,
      category_config_row.question_count
    );

    selected_question_count := 0;

    for source_question_row in
      select q.*
        from public.questions as q
       where q.category_id = category_config_row.category_id
       order by pg_catalog.random()
       limit category_config_row.question_count
       for share
    loop
      selected_question_count := selected_question_count + 1;
      global_question_position := global_question_position + 1;

      insert into public.game_questions as created_question (
        game_session_id,
        source_question_id,
        position,
        category_name,
        prompt,
        points
      )
      values (
        new_game_session_id,
        source_question_row.id,
        global_question_position,
        category_config_row.category_name,
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
        raise exception 'Source question % does not have exactly one valid solution',
          source_question_row.id
          using errcode = '23514';
      end if;
    end loop;

    if selected_question_count <> category_config_row.question_count then
      raise exception 'Question availability changed while creating the session'
        using errcode = '40001';
    end if;
  end loop;

  return query
  select
    new_game_session_id,
    candidate_code,
    quiz_row.title,
    p_max_players;
end;
$$;

revoke all privileges
  on function public.create_game_session(uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute
  on function public.create_game_session(uuid, uuid, integer, jsonb)
  to service_role;
