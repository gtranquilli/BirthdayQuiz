-- Quiz Engine MVP: schema only.
-- RLS is enabled without policies; access policies are intentionally deferred.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.game_phase as enum (
  'lobby',
  'voting_open',
  'voting_closed',
  'answer_revealed',
  'finished'
);

-- Source quiz content ---------------------------------------------------------

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_at timestamptz not null default now(),

  constraint quizzes_title_not_blank check (btrim(title) <> '')
);

create table public.quiz_categories (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  name text not null,
  position smallint not null,
  created_at timestamptz not null default now(),

  constraint quiz_categories_name_not_blank check (btrim(name) <> ''),
  constraint quiz_categories_position_positive check (position > 0),
  constraint quiz_categories_quiz_name_key unique (quiz_id, name),
  constraint quiz_categories_quiz_position_key unique (quiz_id, position),
  constraint quiz_categories_id_quiz_key unique (id, quiz_id)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.quiz_categories (id) on delete cascade,
  prompt text not null,
  points integer not null,
  created_at timestamptz not null default now(),

  constraint questions_prompt_not_blank check (btrim(prompt) <> ''),
  constraint questions_points_positive check (points > 0)
);

create table public.answer_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  position smallint not null,
  label text not null,
  created_at timestamptz not null default now(),

  constraint answer_options_position_range check (position between 1 and 4),
  constraint answer_options_label_not_blank check (btrim(label) <> ''),
  constraint answer_options_question_position_key unique (question_id, position),
  constraint answer_options_id_question_key unique (id, question_id)
);

create table public.question_solutions (
  question_id uuid primary key references public.questions (id) on delete cascade,
  correct_answer_option_id uuid not null,
  created_at timestamptz not null default now(),

  constraint question_solutions_option_belongs_to_question_fk
    foreign key (correct_answer_option_id, question_id)
    references public.answer_options (id, question_id)
    on delete cascade
);

create table public.quiz_presets (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),

  constraint quiz_presets_name_not_blank check (btrim(name) <> ''),
  constraint quiz_presets_quiz_name_key unique (quiz_id, name),
  constraint quiz_presets_id_quiz_key unique (id, quiz_id)
);

create table public.preset_category_rules (
  preset_id uuid not null,
  category_id uuid not null,
  quiz_id uuid not null,
  question_count integer not null,
  created_at timestamptz not null default now(),

  constraint preset_category_rules_pkey primary key (preset_id, category_id),
  constraint preset_category_rules_count_nonnegative check (question_count >= 0),
  constraint preset_category_rules_preset_quiz_fk
    foreign key (preset_id, quiz_id)
    references public.quiz_presets (id, quiz_id)
    on delete cascade,
  constraint preset_category_rules_category_quiz_fk
    foreign key (category_id, quiz_id)
    references public.quiz_categories (id, quiz_id)
    on delete cascade
);

-- Frozen game session ---------------------------------------------------------

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  source_quiz_id uuid references public.quizzes (id) on delete set null,
  quiz_title text not null,
  source_preset_id uuid references public.quiz_presets (id) on delete set null,
  preset_name text not null,
  max_players integer not null,
  phase public.game_phase not null default 'lobby',
  current_game_question_id uuid,
  participant_count integer not null default 0,
  voted_count integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint game_sessions_code_key unique (code),
  constraint game_sessions_code_format check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  constraint game_sessions_quiz_title_not_blank check (btrim(quiz_title) <> ''),
  constraint game_sessions_preset_name_not_blank check (btrim(preset_name) <> ''),
  constraint game_sessions_max_players_positive check (max_players > 0),
  constraint game_sessions_participant_count_valid check (
    participant_count between 0 and max_players
  ),
  constraint game_sessions_voted_count_valid check (
    voted_count between 0 and participant_count
  ),
  constraint game_sessions_lobby_has_no_current_question check (
    phase <> 'lobby' or current_game_question_id is null
  ),
  constraint game_sessions_active_phase_has_current_question check (
    phase not in ('voting_open', 'voting_closed', 'answer_revealed')
    or current_game_question_id is not null
  ),
  constraint game_sessions_started_at_valid check (
    started_at is null or started_at >= created_at
  ),
  constraint game_sessions_finished_at_valid check (
    finished_at is null or (started_at is not null and finished_at >= started_at)
  ),
  constraint game_sessions_updated_at_valid check (updated_at >= created_at)
);

create table public.game_session_category_config (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions (id) on delete cascade,
  source_category_id uuid references public.quiz_categories (id) on delete set null,
  position smallint not null,
  category_name text not null,
  question_count integer not null,
  created_at timestamptz not null default now(),

  constraint game_session_category_config_position_positive check (position > 0),
  constraint game_session_category_config_name_not_blank check (btrim(category_name) <> ''),
  constraint game_session_category_config_count_nonnegative check (question_count >= 0),
  constraint game_session_category_config_session_position_key
    unique (game_session_id, position)
);

create table public.game_questions (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions (id) on delete cascade,
  source_question_id uuid references public.questions (id) on delete set null,
  position smallint not null,
  category_name text not null,
  prompt text not null,
  points integer not null,
  revealed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint game_questions_position_positive check (position > 0),
  constraint game_questions_category_name_not_blank check (btrim(category_name) <> ''),
  constraint game_questions_prompt_not_blank check (btrim(prompt) <> ''),
  constraint game_questions_points_positive check (points > 0),
  constraint game_questions_revealed_at_valid check (
    revealed_at is null or revealed_at >= created_at
  ),
  constraint game_questions_session_position_key unique (game_session_id, position),
  constraint game_questions_id_session_key unique (id, game_session_id)
);

create table public.game_answer_options (
  id uuid primary key default gen_random_uuid(),
  game_question_id uuid not null references public.game_questions (id) on delete cascade,
  source_answer_option_id uuid references public.answer_options (id) on delete set null,
  position smallint not null,
  label text not null,
  created_at timestamptz not null default now(),

  constraint game_answer_options_position_range check (position between 1 and 4),
  constraint game_answer_options_label_not_blank check (btrim(label) <> ''),
  constraint game_answer_options_question_position_key unique (game_question_id, position),
  constraint game_answer_options_id_question_key unique (id, game_question_id)
);

create table public.game_question_solutions (
  game_question_id uuid primary key references public.game_questions (id) on delete cascade,
  correct_game_answer_option_id uuid not null,
  created_at timestamptz not null default now(),

  constraint game_question_solutions_option_belongs_to_question_fk
    foreign key (correct_game_answer_option_id, game_question_id)
    references public.game_answer_options (id, game_question_id)
    on delete cascade
);

alter table public.game_sessions
  add constraint game_sessions_current_question_belongs_to_session_fk
  foreign key (current_game_question_id, id)
  references public.game_questions (id, game_session_id)
  deferrable initially deferred;

-- Players, votes and scoring --------------------------------------------------

create table public.players (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete restrict,
  nickname text not null,
  nickname_normalized text generated always as (lower(btrim(nickname))) stored,
  avatar_key text not null,
  total_score integer not null default 0,
  joined_at timestamptz not null default now(),

  constraint players_nickname_length check (char_length(btrim(nickname)) between 2 and 20),
  constraint players_avatar_key_not_blank check (btrim(avatar_key) <> ''),
  constraint players_total_score_nonnegative check (total_score >= 0),
  constraint players_session_user_key unique (game_session_id, auth_user_id),
  constraint players_session_nickname_key unique (game_session_id, nickname_normalized),
  constraint players_id_session_key unique (id, game_session_id)
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions (id) on delete cascade,
  game_question_id uuid not null,
  player_id uuid not null,
  game_answer_option_id uuid not null,
  submitted_at timestamptz not null default now(),
  is_correct boolean,
  points_awarded integer,

  constraint votes_session_question_player_key
    unique (game_session_id, game_question_id, player_id),
  constraint votes_question_belongs_to_session_fk
    foreign key (game_question_id, game_session_id)
    references public.game_questions (id, game_session_id)
    on delete cascade,
  constraint votes_player_belongs_to_session_fk
    foreign key (player_id, game_session_id)
    references public.players (id, game_session_id)
    on delete cascade,
  constraint votes_option_belongs_to_question_fk
    foreign key (game_answer_option_id, game_question_id)
    references public.game_answer_options (id, game_question_id)
    on delete cascade,
  constraint votes_evaluation_consistent check (
    (is_correct is null and points_awarded is null)
    or (is_correct is not null and points_awarded is not null)
  ),
  constraint votes_points_nonnegative check (
    points_awarded is null or points_awarded >= 0
  ),
  constraint votes_incorrect_awards_zero check (
    is_correct is not false or points_awarded = 0
  )
);

-- Deferred aggregate invariants ----------------------------------------------
-- A source or frozen question is valid only with four options and one solution.
-- Deferred constraint triggers allow all related rows to be inserted in one
-- transaction and validate the final state at commit time.

create function private.assert_source_question_complete(target_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  option_count integer;
  solution_count integer;
begin
  if not exists (
    select 1 from public.questions where id = target_question_id
  ) then
    return;
  end if;

  select count(*)
    into option_count
    from public.answer_options
   where question_id = target_question_id;

  if option_count <> 4 then
    raise exception 'Question % must have exactly four answer options; found %',
      target_question_id,
      option_count
      using errcode = '23514';
  end if;

  select count(*)
    into solution_count
    from public.question_solutions
   where question_id = target_question_id;

  if solution_count <> 1 then
    raise exception 'Question % must have exactly one solution; found %',
      target_question_id,
      solution_count
      using errcode = '23514';
  end if;
end;
$$;

create function private.check_source_question_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'questions' then
    if tg_op <> 'INSERT' then
      perform private.assert_source_question_complete(old.id);
    end if;
    if tg_op <> 'DELETE' then
      perform private.assert_source_question_complete(new.id);
    end if;
  else
    if tg_op <> 'INSERT' then
      perform private.assert_source_question_complete(old.question_id);
    end if;
    if tg_op <> 'DELETE' then
      perform private.assert_source_question_complete(new.question_id);
    end if;
  end if;

  return null;
end;
$$;

create constraint trigger questions_must_be_complete
after insert or update or delete on public.questions
deferrable initially deferred
for each row execute function private.check_source_question_integrity();

create constraint trigger answer_options_preserve_question_integrity
after insert or update or delete on public.answer_options
deferrable initially deferred
for each row execute function private.check_source_question_integrity();

create constraint trigger question_solutions_preserve_question_integrity
after insert or update or delete on public.question_solutions
deferrable initially deferred
for each row execute function private.check_source_question_integrity();

create function private.assert_game_question_complete(target_game_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  option_count integer;
  solution_count integer;
begin
  if not exists (
    select 1 from public.game_questions where id = target_game_question_id
  ) then
    return;
  end if;

  select count(*)
    into option_count
    from public.game_answer_options
   where game_question_id = target_game_question_id;

  if option_count <> 4 then
    raise exception 'Game question % must have exactly four answer options; found %',
      target_game_question_id,
      option_count
      using errcode = '23514';
  end if;

  select count(*)
    into solution_count
    from public.game_question_solutions
   where game_question_id = target_game_question_id;

  if solution_count <> 1 then
    raise exception 'Game question % must have exactly one solution; found %',
      target_game_question_id,
      solution_count
      using errcode = '23514';
  end if;
end;
$$;

create function private.check_game_question_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'game_questions' then
    if tg_op <> 'INSERT' then
      perform private.assert_game_question_complete(old.id);
    end if;
    if tg_op <> 'DELETE' then
      perform private.assert_game_question_complete(new.id);
    end if;
  else
    if tg_op <> 'INSERT' then
      perform private.assert_game_question_complete(old.game_question_id);
    end if;
    if tg_op <> 'DELETE' then
      perform private.assert_game_question_complete(new.game_question_id);
    end if;
  end if;

  return null;
end;
$$;

create constraint trigger game_questions_must_be_complete
after insert or update or delete on public.game_questions
deferrable initially deferred
for each row execute function private.check_game_question_integrity();

create constraint trigger game_answer_options_preserve_question_integrity
after insert or update or delete on public.game_answer_options
deferrable initially deferred
for each row execute function private.check_game_question_integrity();

create constraint trigger game_question_solutions_preserve_question_integrity
after insert or update or delete on public.game_question_solutions
deferrable initially deferred
for each row execute function private.check_game_question_integrity();

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger game_sessions_set_updated_at
before update on public.game_sessions
for each row execute function private.set_updated_at();

revoke all on all functions in schema private from public, anon, authenticated;

-- Supporting indexes ---------------------------------------------------------

create index questions_category_id_idx
  on public.questions (category_id);

create index question_solutions_correct_option_idx
  on public.question_solutions (correct_answer_option_id);

create index preset_category_rules_category_id_idx
  on public.preset_category_rules (category_id);

create index game_sessions_source_quiz_id_idx
  on public.game_sessions (source_quiz_id);

create index game_sessions_source_preset_id_idx
  on public.game_sessions (source_preset_id);

create index game_sessions_phase_idx
  on public.game_sessions (phase);

create index game_sessions_current_question_id_idx
  on public.game_sessions (current_game_question_id);

create index game_session_category_config_source_category_idx
  on public.game_session_category_config (source_category_id);

create index game_questions_source_question_id_idx
  on public.game_questions (source_question_id);

create index game_answer_options_source_option_id_idx
  on public.game_answer_options (source_answer_option_id);

create index game_question_solutions_correct_option_idx
  on public.game_question_solutions (correct_game_answer_option_id);

create index players_auth_user_id_idx
  on public.players (auth_user_id);

create index players_leaderboard_idx
  on public.players (game_session_id, total_score desc, joined_at asc);

create index votes_player_id_idx
  on public.votes (player_id);

create index votes_question_option_idx
  on public.votes (game_question_id, game_answer_option_id);

-- Secure-by-default baseline. Policies will be added in a later migration.

alter table public.quizzes enable row level security;
alter table public.quiz_categories enable row level security;
alter table public.questions enable row level security;
alter table public.answer_options enable row level security;
alter table public.question_solutions enable row level security;
alter table public.quiz_presets enable row level security;
alter table public.preset_category_rules enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_session_category_config enable row level security;
alter table public.game_questions enable row level security;
alter table public.game_answer_options enable row level security;
alter table public.game_question_solutions enable row level security;
alter table public.players enable row level security;
alter table public.votes enable row level security;
