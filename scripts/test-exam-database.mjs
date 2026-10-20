// Local-only integration harness. No connection to Supabase or remote credentials.
// EXAM_TEST_TOOLS points to an external npm prefix containing @electric-sql/pglite.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(
  join(process.env.EXAM_TEST_TOOLS, 'package.json'),
);
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) =>
  Object.values((await rows(sql, args))[0])[0];
async function rejects(sql, args, message) {
  await assert.rejects(() => db.query(sql, args), message);
  checks++;
}
async function role(name, uid = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    uid,
  ]);
  await db.exec(`set role ${name}`);
}
await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as
 $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 grant usage on schema auth to anon, authenticated, service_role;
 grant execute on function auth.uid() to anon, authenticated, service_role;
 create schema storage;
 create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
 create table storage.objects(id uuid primary key, bucket_id text);
 alter table storage.objects enable row level security;
 create publication supabase_realtime;
`);
for (const file of (await readdir('supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  try {
    await db.exec(await readFile(join('supabase/migrations', file), 'utf8'));
  } catch (error) {
    throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
  }
}
await db.exec(await readFile('supabase/seed.sql', 'utf8'));
const quiz = await scalar('select id from public.quizzes limit 1');
const count = await scalar('select public.get_exam_question_count($1)', [quiz]);
check(count >= 3, 'Seed has enough questions');
const users = Array.from(
  { length: 4 },
  (_, i) => `a0000000-0000-4000-8000-00000000000${i + 1}`,
);
for (const id of users)
  await db.query('insert into auth.users(id) values($1)', [id]);
await role('service_role');
await rejects(
  'select * from public.create_exam_session($1,1,$2)',
  [quiz, count + 1],
  'Reject excessive question count',
);
await rejects(
  'select * from public.create_exam_session($1,0,1)',
  [quiz],
  'Reject zero capacity',
);
const s = (
  await rows('select * from public.create_exam_session($1,2,3)', [quiz])
)[0];
const code = s.session_code;
await rejects(
  'select public.start_exam_session($1)',
  [s.game_session_id],
  'Require participant',
);
async function joinPlayer(code, nickname, avatar, user, hash) {
  return (
    await rows(
      'select * from public.join_game_session_with_rejoin_token($1,$2,$3,$4,$5,false)',
      [code, nickname, avatar, user, hash.repeat(64)],
    )
  )[0];
}
const p1 = await joinPlayer(code, 'Primo', 'fox', users[0], 'a');
await joinPlayer(code, 'Secondo', 'panda', users[1], 'b');
await rejects(
  'select * from public.join_game_session_with_rejoin_token($1,$2,$3,$4,$5,false)',
  [code, 'Terzo', 'koala', users[2], 'c'.repeat(64)],
  'Capacity enforced',
);
await db.query('select public.start_exam_session($1)', [s.game_session_id]);
await db.query('select public.start_exam_session($1)', [s.game_session_id]);
await rejects(
  'select * from public.start_game_session($1)',
  [s.game_session_id],
  'Presentation start blocked',
);
for (const name of [
  'close_current_voting',
  'reveal_current_answer',
  'score_and_advance_game_session',
]) {
  await rejects(
    `select * from public.${name}($1)`,
    [s.game_session_id],
    `${name} blocked on exam`,
  );
}
await rejects(
  'select * from public.join_game_session_with_rejoin_token($1,$2,$3,$4,$5,false)',
  [code, 'Terzo', 'koala', users[2], 'c'.repeat(64)],
  'Late join blocked',
);
await role('authenticated', users[0]);
let first = await scalar('select public.get_my_exam_progress($1)', [code]);
check(
  first.questions.length === 3 &&
    new Set(first.questions.map((q) => q.id)).size === 3,
  'Exact count, no duplicates',
);
check(
  first.questions.every(
    (q) => q.options.map((o) => o.position).join() === '1,2,3,4',
  ),
  'Answer order A-D',
);
check(
  first.questions.every((q) => q.correct_option_id === null),
  'No early solutions',
);
check(first.result === null, 'No early score');
for (const table of [
  'exam_progress',
  'exam_answers',
  'game_question_solutions',
  'game_questions',
  'votes',
  'players',
]) {
  await rejects(`select * from public.${table}`, [], `No direct read ${table}`);
}
await rejects(
  'select public.get_host_exam_progress($1)',
  [code],
  'No host RPC for player',
);
await rejects(
  'select * from public.submit_vote($1,$2)',
  [code, first.questions[0].options[0].id],
  'No presentation voting in exam',
);
await rejects(
  'select public.get_my_current_vote($1)',
  [code],
  'No presentation recovery in exam',
);
await rejects(
  'select public.save_exam_progress($1,0,$2,$3)',
  [code, first.questions[0].id, first.questions[1].options[0].id],
  'Wrong question-option pair rejected',
);
await rejects(
  'select public.save_exam_progress($1,3)',
  [code],
  'Invalid index rejected',
);
await db.query('select public.save_exam_progress($1,1)', [code]);
first = await scalar('select public.get_my_exam_progress($1)', [code]);
check(
  first.last_index === 1 && first.completed_count === 0,
  'Skipped question and position persist',
);
await role('authenticated', users[1]);
let second = await scalar('select public.get_my_exam_progress($1)', [code]);
check(
  second.questions.map((q) => q.id).join() ===
    first.questions.map((q) => q.id).join(),
  'Same ordered question set',
);
check(second.last_index === 0, 'Independent position');
await role('authenticated', users[2]);
await rejects(
  'select public.get_my_exam_progress($1)',
  [code],
  'Non-member cannot read exam',
);
await role('postgres');
const correct = await scalar(
  'select correct_game_answer_option_id from public.game_question_solutions where game_question_id=$1',
  [first.questions[0].id],
);
const wrong = first.questions[0].options.find((o) => o.id !== correct).id;
const oldPrompt = first.questions[0].prompt;
await db.query(
  "update public.questions set prompt='Changed source' where id=(select source_question_id from public.game_questions where id=$1)",
  [first.questions[0].id],
);
// All frozen fields, including options and media, must match the source at start.
check(await scalar(`select bool_and(q.image_storage_path is not distinct from source.image_storage_path
 and q.points = source.points) from public.game_questions q join public.questions source on source.id=q.source_question_id
 where q.game_session_id=$1`, [s.game_session_id]), 'Question media and points copied');
check(await scalar(`select bool_and(o.position = source.position and o.label is not distinct from source.label
 and o.image_storage_path is not distinct from source.image_storage_path)
 from public.game_answer_options o join public.answer_options source on source.id=o.source_answer_option_id
 join public.game_questions q on q.id=o.game_question_id where q.game_session_id=$1`, [s.game_session_id]), 'Options, positions and media copied');
await role('authenticated', users[0]);
await db.query('select public.save_exam_progress($1,0,$2,$3)', [code, first.questions[0].id, wrong]);
await db.query('select public.save_exam_progress($1,0,$2,null)', [code, first.questions[0].id]);
check((await scalar('select public.get_my_exam_progress($1)', [code])).completed_count === 0, 'Explicitly clearing answer restores omission');
await role('authenticated', users[0]);
await db.query('select public.save_exam_progress($1,0,$2,$3)', [
  code,
  first.questions[0].id,
  wrong,
]);
await db.query('select public.save_exam_progress($1,2,$2,$3)', [
  code,
  first.questions[0].id,
  correct,
]);
first = await scalar('select public.get_my_exam_progress($1)', [code]);
check(
  first.questions[0].selected_option_id === correct &&
    first.completed_count === 1,
  'Confirmed choice overwritten once',
);
check(first.questions[0].prompt === oldPrompt, 'Immutable source snapshot');
await role('service_role');
const hostBefore = await scalar('select public.get_host_exam_progress($1)', [
  code,
]);
check(
  hostBefore[0].completedCount === 1 && hostBefore[0].points === null,
  'Host progress without premature score',
);
await rejects(
  'select public.get_host_exam_progress($1,$2)',
  [code, p1.player_id],
  'Host correction gated by submission',
);
await db.query('select * from public.rejoin_game_session($1,$2,$3,$4)', [
  code,
  'a'.repeat(64),
  users[2],
  'd'.repeat(64),
]);
await rejects(
  'select * from public.rejoin_game_session($1,$2,$3,$4)',
  [code, 'a'.repeat(64), users[3], 'e'.repeat(64)],
  'Rotated token rejected',
);
await role('authenticated', users[0]);
await rejects(
  'select public.get_my_exam_progress($1)',
  [code],
  'Old Auth identity loses access',
);
await role('authenticated', users[2]);
let recovered = await scalar('select public.get_my_exam_progress($1)', [code]);
check(
  recovered.player_id === p1.player_id &&
    recovered.last_index === 2 &&
    recovered.completed_count === 1,
  'New Auth rejoin preserves identity and progress',
);
const results = await Promise.all([
  scalar('select public.submit_exam($1)', [code]),
  scalar('select public.submit_exam($1)', [code]),
]);
check(
  JSON.stringify(results[0]) === JSON.stringify(results[1]),
  'Double submission returns identical persisted result',
);
check(
  results[0].result.correct === 1 &&
    results[0].result.omitted === 2 &&
    results[0].result.incorrect === 0,
  'Partial submission scoring',
);
check(
  results[0].questions.every((q) => q.correct_option_id !== null),
  'Own corrections after submission',
);
await rejects(
  'select public.save_exam_progress($1,0,$2,$3)',
  [code, first.questions[0].id, wrong],
  'Submitted answers immutable',
);
await role('anon');
let projected = (
  await rows('select * from public.lobby_public_sessions where code=$1', [code])
)[0];
check(
  projected.phase === 'voting_open' && projected.submitted_count === 1,
  'One submission does not finish others',
);
check(
  projected.current_question === null &&
    projected.correct_option_id === null &&
    projected.leaderboard.length === 0,
  'Public display has no questions, scores or corrections',
);
await rejects(
  'select public.get_my_exam_progress($1)',
  [code],
  'Anonymous role cannot access personal RPC',
);
await role('authenticated', users[1]);
second = await scalar('select public.get_my_exam_progress($1)', [code]);
check(
  second.result === null &&
    second.questions.every((q) => q.correct_option_id === null),
  'Unsubmitted player receives no solutions after peer submits',
);
await db.query('select public.save_exam_progress($1,0,$2,$3)', [code, first.questions[0].id, wrong]);
const secondResult = await scalar('select public.submit_exam($1)', [code]);
check(secondResult.result.incorrect === 1 && secondResult.result.correct === 0 && secondResult.result.points === 0 && secondResult.result.omitted === 2, 'Incorrect and omitted score zero');
await role('anon');
projected = (
  await rows('select * from public.lobby_public_sessions where code=$1', [code])
)[0];
check(
  projected.phase === 'finished' &&
    projected.submitted_count === 2 &&
    projected.leaderboard.length === 0,
  'All submitted finishes privately',
);
await role('service_role');
check(
  (
    await scalar('select public.get_host_exam_progress($1,$2)', [
      code,
      p1.player_id,
    ])
  ).result.correct === 1,
  'Host can inspect submitted correction',
);
await db.query('select * from public.rejoin_game_session($1,$2,$3,$4)', [
  code,
  'd'.repeat(64),
  users[3],
  'e'.repeat(64),
]);
await role('authenticated', users[3]);
check(
  (await scalar('select public.get_my_exam_progress($1)', [code]))
    .submitted_at === results[0].submitted_at,
  'Result recovery after finished and Auth replacement',
);
await role('service_role');
const solo = (
  await rows('select * from public.create_exam_session($1,1,1)', [quiz])
)[0];
await joinPlayer(solo.session_code, 'Solo', 'fox', users[0], 'f');
await db.query('select public.start_exam_session($1)', [solo.game_session_id]);
await role('authenticated', users[0]);
check(
  (await scalar('select public.submit_exam($1)', [solo.session_code])).result
    .omitted === 1,
  'One-player exam permits all omitted',
);
check(
  (await scalar(
    'select phase from public.lobby_public_sessions where code=$1',
    [solo.session_code],
  )) === 'finished',
  'Solo exam finishes',
);
// Availability changes fail atomically before producing a partial frozen exam.
await role('service_role');
const unavailable = (await rows('select * from public.create_exam_session($1,1,$2)', [quiz, count]))[0];
await joinPlayer(unavailable.session_code, 'Atomic', 'koala', users[0], '3');
await role('postgres');
await db.exec('begin');
await db.query('delete from public.questions where id=(select id from public.questions limit 1)');
await rejects('select public.start_exam_session($1)', [unavailable.game_session_id], 'Availability revalidated at start');
await db.exec('rollback');
check(await scalar('select count(*)::integer from public.game_questions where game_session_id=$1', [unavailable.game_session_id]) === 0, 'Failed start leaves no partial snapshot');
// Full presentation lifecycle regression with two participants and all seeded questions.
await role('service_role');
const categories = await rows(
  'select id from public.quiz_categories where quiz_id=$1 order by position',
  [quiz],
);
const config = categories.map((c) => ({
  category_id: c.id,
  question_count: 1,
}));
const pres = (
  await rows('select * from public.create_game_session($1,null,2,$2)', [
    quiz,
    JSON.stringify(config),
  ])
)[0];
await joinPlayer(pres.session_code, 'Alpha', 'fox', users[0], '1');
await joinPlayer(pres.session_code, 'Beta', 'panda', users[1], '2');
await db.query('select * from public.start_game_session($1)', [
  pres.game_session_id,
]);
for (let i = 0; i < categories.length; i++) {
  await role('postgres');
  const option = await scalar(
    'select sol.correct_game_answer_option_id from public.game_sessions s join public.game_question_solutions sol on sol.game_question_id=s.current_game_question_id where s.id=$1',
    [pres.game_session_id],
  );
  await role('authenticated', users[0]);
  await db.query('select * from public.submit_vote($1,$2)', [
    pres.session_code,
    option,
  ]);
  await db.query('select * from public.submit_vote($1,$2)', [
    pres.session_code,
    option,
  ]);
  check(
    (await scalar('select public.get_my_current_vote($1)', [
      pres.session_code,
    ])) === option,
    'Presentation vote recovery',
  );
  const before = (
    await rows('select * from public.lobby_public_sessions where code=$1', [
      pres.session_code,
    ])
  )[0];
  check(
    before.mode === 'presentation' &&
      before.voted_count === 1 &&
      before.correct_option_id === null &&
      before.current_question.options.every((o) => !('is_correct' in o)),
    'Presentation privacy and vote count',
  );
  await role('service_role');
  await db.query('select * from public.close_current_voting($1)', [
    pres.game_session_id,
  ]);
  await role('authenticated', users[1]);
  await rejects(
    'select * from public.submit_vote($1,$2)',
    [pres.session_code, option],
    'Closed presentation rejects vote',
  );
  await role('service_role');
  await db.query('select * from public.reveal_current_answer($1)', [
    pres.game_session_id,
  ]);
  await role('anon');
  const reveal = (
    await rows('select * from public.lobby_public_sessions where code=$1', [
      pres.session_code,
    ])
  )[0];
  check(
    reveal.correct_option_id === option &&
      reveal.current_question.options.find((o) => o.id === option).players[0]
        .nickname === 'Alpha',
    'Reveal associates correct avatar/option',
  );
  await role('service_role');
  await db.query('select * from public.score_and_advance_game_session($1)', [
    pres.game_session_id,
  ]);
  await rejects(
    'select * from public.score_and_advance_game_session($1)',
    [pres.game_session_id],
    'Scoring cannot repeat',
  );
}
await role('anon');
const final = (
  await rows('select * from public.lobby_public_sessions where code=$1', [
    pres.session_code,
  ])
)[0];
check(
  final.phase === 'finished' &&
    final.leaderboard.length === 2 &&
    final.leaderboard[0].score > 0,
  'Presentation final ranking preserved',
);
console.log(
  `PASS: ${checks} database checks; all migrations and seed applied locally. PGlite serializes transactions; production concurrent-lock behavior needs a multi-connection PostgreSQL run.`,
);
await db.close();
