-- Allow server-side host routes to read source quiz configuration and create
-- immutable game sessions. Public client roles intentionally receive no grants.

grant usage on schema public to service_role;

grant select
  on table
    public.quizzes,
    public.quiz_categories,
    public.questions,
    public.quiz_presets,
    public.preset_category_rules
  to service_role;

grant execute
  on function public.create_game_session(uuid, uuid, integer, jsonb)
  to service_role;
