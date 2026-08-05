-- Structured quiz media stored in a public-read, server-write Storage bucket.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'quiz-media',
  'quiz-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy quiz_media_public_read
on storage.objects
for select
to public
using (bucket_id = 'quiz-media');

-- No insert, update or delete policies are created for anon/authenticated.
-- service_role writes through the server and bypasses Storage RLS.

alter table public.questions
  drop constraint questions_prompt_not_blank;

alter table public.questions
  alter column prompt drop not null,
  add column image_storage_path text,
  add column image_alt_text text,
  add column image_width integer,
  add column image_height integer,
  add column image_updated_at timestamptz;

alter table public.questions
  add constraint questions_content_required check (
    (prompt is not null and pg_catalog.btrim(prompt) <> '')
    or image_storage_path is not null
  ),
  add constraint questions_media_consistent check (
    (
      image_storage_path is null
      and image_alt_text is null
      and image_width is null
      and image_height is null
      and image_updated_at is null
    )
    or (
      image_storage_path is not null
      and image_alt_text is not null
      and pg_catalog.btrim(image_alt_text) <> ''
      and image_width > 0
      and image_height > 0
      and image_updated_at is not null
    )
  ),
  add constraint questions_media_path_valid check (
    image_storage_path is null
    or image_storage_path ~ '^quizzes/[0-9a-f-]{36}/questions/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp)$'
  );

alter table public.answer_options
  drop constraint answer_options_label_not_blank;

alter table public.answer_options
  alter column label drop not null,
  add column image_storage_path text,
  add column image_alt_text text,
  add column image_width integer,
  add column image_height integer,
  add column image_updated_at timestamptz;

alter table public.answer_options
  add constraint answer_options_content_required check (
    (label is not null and pg_catalog.btrim(label) <> '')
    or image_storage_path is not null
  ),
  add constraint answer_options_media_consistent check (
    (
      image_storage_path is null
      and image_alt_text is null
      and image_width is null
      and image_height is null
      and image_updated_at is null
    )
    or (
      image_storage_path is not null
      and image_alt_text is not null
      and pg_catalog.btrim(image_alt_text) <> ''
      and image_width > 0
      and image_height > 0
      and image_updated_at is not null
    )
  ),
  add constraint answer_options_media_path_valid check (
    image_storage_path is null
    or image_storage_path ~ '^quizzes/[0-9a-f-]{36}/answers/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp)$'
  );

alter table public.game_questions
  drop constraint game_questions_prompt_not_blank;

alter table public.game_questions
  alter column prompt drop not null,
  add column image_storage_path text,
  add column image_alt_text text,
  add column image_width integer,
  add column image_height integer,
  add column image_updated_at timestamptz;

alter table public.game_questions
  add constraint game_questions_content_required check (
    (prompt is not null and pg_catalog.btrim(prompt) <> '')
    or image_storage_path is not null
  ),
  add constraint game_questions_media_consistent check (
    (
      image_storage_path is null
      and image_alt_text is null
      and image_width is null
      and image_height is null
      and image_updated_at is null
    )
    or (
      image_storage_path is not null
      and image_alt_text is not null
      and pg_catalog.btrim(image_alt_text) <> ''
      and image_width > 0
      and image_height > 0
      and image_updated_at is not null
    )
  ),
  add constraint game_questions_media_path_valid check (
    image_storage_path is null
    or image_storage_path ~ '^quizzes/[0-9a-f-]{36}/questions/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp)$'
  );

alter table public.game_answer_options
  drop constraint game_answer_options_label_not_blank;

alter table public.game_answer_options
  alter column label drop not null,
  add column image_storage_path text,
  add column image_alt_text text,
  add column image_width integer,
  add column image_height integer,
  add column image_updated_at timestamptz;

alter table public.game_answer_options
  add constraint game_answer_options_content_required check (
    (label is not null and pg_catalog.btrim(label) <> '')
    or image_storage_path is not null
  ),
  add constraint game_answer_options_media_consistent check (
    (
      image_storage_path is null
      and image_alt_text is null
      and image_width is null
      and image_height is null
      and image_updated_at is null
    )
    or (
      image_storage_path is not null
      and image_alt_text is not null
      and pg_catalog.btrim(image_alt_text) <> ''
      and image_width > 0
      and image_height > 0
      and image_updated_at is not null
    )
  ),
  add constraint game_answer_options_media_path_valid check (
    image_storage_path is null
    or image_storage_path ~ '^quizzes/[0-9a-f-]{36}/answers/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp)$'
  );

grant select, update on table public.questions, public.answer_options
  to service_role;

grant select on table public.game_questions, public.game_answer_options
  to service_role;

revoke insert, update, delete
  on table public.questions, public.answer_options
  from anon, authenticated;

-- Freeze media metadata together with question text and answers at game start.
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

revoke all privileges
  on function public.start_game_session(uuid)
  from public, anon, authenticated, service_role;

grant execute
  on function public.start_game_session(uuid)
  to service_role;

-- Enrich the existing safe Realtime projection without exposing future
-- questions, source-table identifiers or Storage credentials.
create function private.add_media_to_public_game_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_question public.game_questions%rowtype;
  v_options jsonb;
begin
  if new.current_question is null then
    return new;
  end if;

  select game_question.*
    into v_game_question
    from public.game_sessions as game_session
    join public.game_questions as game_question
      on game_question.id = game_session.current_game_question_id
     and game_question.game_session_id = game_session.id
   where game_session.code = new.code;

  if not found then
    return new;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      projected_option.value || pg_catalog.jsonb_build_object(
        'image_storage_path', game_option.image_storage_path,
        'image_alt_text', game_option.image_alt_text,
        'image_width', game_option.image_width,
        'image_height', game_option.image_height,
        'image_updated_at', game_option.image_updated_at
      )
      order by projected_option.ordinality
    ),
    '[]'::jsonb
  )
    into v_options
    from pg_catalog.jsonb_array_elements(
      new.current_question -> 'options'
    ) with ordinality as projected_option(value, ordinality)
    join public.game_answer_options as game_option
      on game_option.id = (projected_option.value ->> 'id')::uuid
     and game_option.game_question_id = v_game_question.id;

  new.current_question := new.current_question || pg_catalog.jsonb_build_object(
    'image_storage_path', v_game_question.image_storage_path,
    'image_alt_text', v_game_question.image_alt_text,
    'image_width', v_game_question.image_width,
    'image_height', v_game_question.image_height,
    'image_updated_at', v_game_question.image_updated_at,
    'options', v_options
  );

  return new;
end;
$$;

create trigger lobby_public_sessions_add_media
before insert or update of current_question
on public.lobby_public_sessions
for each row
execute function private.add_media_to_public_game_projection();

do $$
declare
  v_session_id uuid;
begin
  for v_session_id in
    select game_session.id from public.game_sessions as game_session
  loop
    perform private.refresh_public_game_session(v_session_id);
  end loop;
end;
$$;

revoke all privileges
  on function private.add_media_to_public_game_projection()
  from public, anon, authenticated, service_role;
