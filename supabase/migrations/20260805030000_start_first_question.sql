-- Start the first question atomically and extend the safe Realtime projection.

alter table public.game_sessions
  add column current_question_index integer;

update public.game_sessions as gs
   set current_question_index = game_question.position - 1
  from public.game_questions as game_question
 where game_question.id = gs.current_game_question_id
   and game_question.game_session_id = gs.id;

alter table public.game_sessions
  add constraint game_sessions_current_question_index_valid check (
    (phase = 'lobby' and current_question_index is null)
    or (
      phase in ('voting_open', 'voting_closed', 'answer_revealed')
      and current_question_index is not null
      and current_question_index >= 0
    )
    or (
      phase = 'finished'
      and (current_question_index is null or current_question_index >= 0)
    )
  );

alter table public.lobby_public_sessions
  add column current_question_index integer,
  add column total_question_count integer not null default 0,
  add column current_question jsonb,
  add column voted_count integer not null default 0;

alter table public.lobby_public_sessions
  add constraint lobby_public_sessions_current_question_index_valid check (
    current_question_index is null or current_question_index >= 0
  ),
  add constraint lobby_public_sessions_total_question_count_valid check (
    total_question_count >= 0
  ),
  add constraint lobby_public_sessions_voted_count_valid check (
    voted_count between 0 and participant_count
  ),
  add constraint lobby_public_sessions_current_question_object check (
    current_question is null or jsonb_typeof(current_question) = 'object'
  );

-- Session creation now stores only the selected configuration. Source content
-- is selected and frozen by start_game_session, immediately before play.
create or replace function public.create_game_session(
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
begin
  if p_quiz_id is null then
    raise exception 'Quiz id is required' using errcode = '22023';
  end if;

  if p_max_players is null or p_max_players <= 0 then
    raise exception 'Maximum players must be greater than zero'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_category_config) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_category_config) = 0
  then
    raise exception 'Category configuration must be a non-empty array'
      using errcode = '22023';
  end if;

  select q.*
    into quiz_row
    from public.quizzes as q
   where q.id = p_quiz_id
   for share;

  if not found then
    raise exception 'Quiz not found' using errcode = 'P0002';
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
      parsed_question_count := (category_config_item ->> 'question_count')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Invalid category configuration'
          using errcode = '22023';
    end;

    if parsed_question_count < 0 then
      raise exception 'Question count must be a non-negative integer'
        using errcode = '22023';
    end if;

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

  if total_question_count = 0 or total_question_count > 32767 then
    raise exception 'The session must contain between 1 and 32767 questions'
      using errcode = '22023';
  end if;

  for room_code_attempt in 1..32 loop
    random_uuid_bytes := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    candidate_code := '';

    for room_code_character_index in 0..5 loop
      candidate_code := candidate_code || pg_catalog.substr(
        room_code_alphabet,
        (pg_catalog.get_byte(random_uuid_bytes, room_code_character_index)
          % pg_catalog.char_length(room_code_alphabet)) + 1,
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
        current_question_index,
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
  end loop;

  return query
  select new_game_session_id, candidate_code, quiz_row.title, p_max_players;
end;
$$;

create function public.start_game_session(p_game_session_id uuid)
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
  next_question_position integer := 0;
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

  select pg_catalog.coalesce(pg_catalog.sum(config.question_count), 0)::integer
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

      selected_question_count := 0;

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
        selected_question_count := selected_question_count + 1;
        next_question_position := next_question_position + 1;

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
         current_question_index = 0,
         voted_count = 0,
         started_at = pg_catalog.now()
   where started_session.id = session_row.id;

  return query
  select
    session_row.code,
    'voting_open'::public.game_phase,
    0,
    configured_question_count,
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
    0;
end;
$$;

create function private.refresh_public_game_session(target_game_session_id uuid)
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
    voted_count
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
                )
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
    gs.voted_count
  from public.game_sessions as gs
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
        voted_count = excluded.voted_count;
end;
$$;

create or replace function private.sync_lobby_public_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.code <> new.code then
    delete from public.lobby_public_sessions where code = old.code;
  end if;

  perform private.refresh_public_game_session(new.id);
  return new;
end;
$$;

create or replace function private.refresh_lobby_public_players(
  target_game_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_public_game_session(target_game_session_id);
end;
$$;

drop trigger game_sessions_sync_lobby_public_session
  on public.game_sessions;

create trigger game_sessions_sync_lobby_public_session
after insert or update of
  code,
  quiz_title,
  phase,
  participant_count,
  max_players,
  current_game_question_id,
  current_question_index,
  voted_count
on public.game_sessions
for each row execute function private.sync_lobby_public_session();

select private.refresh_public_game_session(gs.id)
from public.game_sessions as gs;

revoke all privileges
  on function public.create_game_session(uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute
  on function public.create_game_session(uuid, uuid, integer, jsonb)
  to service_role;

revoke all privileges
  on function public.start_game_session(uuid)
  from public, anon, authenticated, service_role;
grant execute
  on function public.start_game_session(uuid)
  to service_role;

revoke all privileges
  on function private.refresh_public_game_session(uuid)
  from public, anon, authenticated, service_role;
revoke all privileges
  on function private.sync_lobby_public_session()
  from public, anon, authenticated, service_role;
revoke all privileges
  on function private.refresh_lobby_public_players(uuid)
  from public, anon, authenticated, service_role;

revoke all privileges
  on table public.game_sessions,
    public.game_questions,
    public.game_answer_options,
    public.game_question_solutions,
    public.players,
    public.votes
  from public, anon, authenticated;
