-- Safe lobby projection for public snapshots and Realtime updates.

alter table public.players
  add constraint players_avatar_key_allowed check (
    avatar_key in (
      'fox',
      'panda',
      'koala',
      'lion',
      'tiger',
      'owl',
      'frog',
      'penguin',
      'octopus',
      'unicorn',
      'robot',
      'astronaut'
    )
  );

create table public.lobby_public_sessions (
  code text primary key
    references public.game_sessions (code)
    on update cascade
    on delete cascade,
  quiz_title text not null,
  phase public.game_phase not null,
  participant_count integer not null,
  max_players integer not null,
  players jsonb not null default '[]'::jsonb,

  constraint lobby_public_sessions_code_format check (
    code ~ '^[A-HJ-NP-Z2-9]{6}$'
  ),
  constraint lobby_public_sessions_quiz_title_not_blank check (
    btrim(quiz_title) <> ''
  ),
  constraint lobby_public_sessions_participant_count_valid check (
    participant_count between 0 and max_players
  ),
  constraint lobby_public_sessions_max_players_positive check (
    max_players > 0
  ),
  constraint lobby_public_sessions_players_array check (
    jsonb_typeof(players) = 'array'
  )
);

create function private.sync_lobby_public_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.code <> new.code then
    delete from public.lobby_public_sessions
     where code = old.code;
  end if;

  insert into public.lobby_public_sessions (
    code,
    quiz_title,
    phase,
    participant_count,
    max_players,
    players
  )
  values (
    new.code,
    new.quiz_title,
    new.phase,
    new.participant_count,
    new.max_players,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'nickname', p.nickname,
            'avatar_key', p.avatar_key
          )
          order by p.joined_at, p.id
        )
          from public.players as p
         where p.game_session_id = new.id
      ),
      '[]'::jsonb
    )
  )
  on conflict (code) do update
    set quiz_title = excluded.quiz_title,
        phase = excluded.phase,
        participant_count = excluded.participant_count,
        max_players = excluded.max_players,
        players = excluded.players;

  return new;
end;
$$;

create function private.refresh_lobby_public_players(
  target_game_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lobby_public_sessions as lobby
     set players = coalesce(
       (
         select jsonb_agg(
           jsonb_build_object(
             'nickname', p.nickname,
             'avatar_key', p.avatar_key
           )
           order by p.joined_at, p.id
         )
           from public.players as p
          where p.game_session_id = target_game_session_id
       ),
       '[]'::jsonb
     )
    from public.game_sessions as gs
   where gs.id = target_game_session_id
     and lobby.code = gs.code;
end;
$$;

create function private.sync_lobby_public_players()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_lobby_public_players(old.game_session_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.game_session_id <> new.game_session_id then
    perform private.refresh_lobby_public_players(old.game_session_id);
  end if;

  perform private.refresh_lobby_public_players(new.game_session_id);
  return new;
end;
$$;

create trigger game_sessions_sync_lobby_public_session
after insert or update of code, quiz_title, phase, participant_count, max_players
on public.game_sessions
for each row execute function private.sync_lobby_public_session();

create trigger players_sync_lobby_public_players
after insert or update of game_session_id, nickname, avatar_key or delete
on public.players
for each row execute function private.sync_lobby_public_players();

insert into public.lobby_public_sessions (
  code,
  quiz_title,
  phase,
  participant_count,
  max_players,
  players
)
select
  gs.code,
  gs.quiz_title,
  gs.phase,
  gs.participant_count,
  gs.max_players,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'nickname', p.nickname,
          'avatar_key', p.avatar_key
        )
        order by p.joined_at, p.id
      )
        from public.players as p
       where p.game_session_id = gs.id
    ),
    '[]'::jsonb
  )
from public.game_sessions as gs;

alter table public.lobby_public_sessions enable row level security;

revoke all privileges
  on table public.game_sessions, public.players
  from public, anon, authenticated;

revoke all privileges
  on table public.lobby_public_sessions
  from public, anon, authenticated, service_role;

grant usage on schema public to anon, authenticated;

grant select
  on table public.lobby_public_sessions
  to anon, authenticated;

create policy lobby_public_sessions_select
on public.lobby_public_sessions
for select
to anon, authenticated
using (true);

revoke all privileges
  on function private.sync_lobby_public_session()
  from public, anon, authenticated, service_role;

revoke all privileges
  on function private.refresh_lobby_public_players(uuid)
  from public, anon, authenticated, service_role;

revoke all privileges
  on function private.sync_lobby_public_players()
  from public, anon, authenticated, service_role;

alter publication supabase_realtime
  add table public.lobby_public_sessions;
