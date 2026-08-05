-- Minimal deterministic dataset for the Quiz Engine MVP.
-- All rows use fixed UUIDs so this seed can be safely rerun.

begin;

set constraints all deferred;

insert into public.quizzes (id, title)
values (
  '10000000-0000-4000-8000-000000000001',
  'Compleanno Giorgio'
)
on conflict (id) do update
set title = excluded.title;

insert into public.quiz_categories (id, quiz_id, name, position)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Serie',
    1
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Divertenti',
    2
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'Impossibili',
    3
  )
on conflict (id) do update
set
  quiz_id = excluded.quiz_id,
  name = excluded.name,
  position = excluded.position;

insert into public.quiz_presets (id, quiz_id, name)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Compleanno classico'
)
on conflict (id) do update
set
  quiz_id = excluded.quiz_id,
  name = excluded.name;

insert into public.preset_category_rules (
  preset_id,
  category_id,
  quiz_id,
  question_count
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    1
  ),
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    1
  ),
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    1
  )
on conflict (preset_id, category_id) do update
set
  quiz_id = excluded.quiz_id,
  question_count = excluded.question_count;

insert into public.questions (id, category_id, prompt, points)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'In quale mese si festeggia il compleanno di Giorgio?',
    100
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'Cosa si mette tradizionalmente sopra una torta di compleanno?',
    100
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003',
    'Quante lettere contiene la parola impossibili?',
    100
  )
on conflict (id) do update
set
  category_id = excluded.category_id,
  prompt = excluded.prompt,
  points = excluded.points;

insert into public.answer_options (id, question_id, position, label)
values
  (
    '50000000-0000-4000-8000-000000000101',
    '40000000-0000-4000-8000-000000000001',
    1,
    'Gennaio'
  ),
  (
    '50000000-0000-4000-8000-000000000102',
    '40000000-0000-4000-8000-000000000001',
    2,
    'Aprile'
  ),
  (
    '50000000-0000-4000-8000-000000000103',
    '40000000-0000-4000-8000-000000000001',
    3,
    'Agosto'
  ),
  (
    '50000000-0000-4000-8000-000000000104',
    '40000000-0000-4000-8000-000000000001',
    4,
    'Dicembre'
  ),
  (
    '50000000-0000-4000-8000-000000000201',
    '40000000-0000-4000-8000-000000000002',
    1,
    'Candeline'
  ),
  (
    '50000000-0000-4000-8000-000000000202',
    '40000000-0000-4000-8000-000000000002',
    2,
    'Calzini'
  ),
  (
    '50000000-0000-4000-8000-000000000203',
    '40000000-0000-4000-8000-000000000002',
    3,
    'Chiavi'
  ),
  (
    '50000000-0000-4000-8000-000000000204',
    '40000000-0000-4000-8000-000000000002',
    4,
    'Occhiali da sole'
  ),
  (
    '50000000-0000-4000-8000-000000000301',
    '40000000-0000-4000-8000-000000000003',
    1,
    '10'
  ),
  (
    '50000000-0000-4000-8000-000000000302',
    '40000000-0000-4000-8000-000000000003',
    2,
    '11'
  ),
  (
    '50000000-0000-4000-8000-000000000303',
    '40000000-0000-4000-8000-000000000003',
    3,
    '12'
  ),
  (
    '50000000-0000-4000-8000-000000000304',
    '40000000-0000-4000-8000-000000000003',
    4,
    '13'
  )
on conflict (id) do update
set
  question_id = excluded.question_id,
  position = excluded.position,
  label = excluded.label;

insert into public.question_solutions (
  question_id,
  correct_answer_option_id
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000103'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000201'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000302'
  )
on conflict (question_id) do update
set correct_answer_option_id = excluded.correct_answer_option_id;

-- Demo media metadata. Run `node scripts/upload-demo-media.mjs` after this seed to generate
-- and upload the matching original PNG assets to the quiz-media bucket.
update public.questions
set
  image_storage_path = 'quizzes/10000000-0000-4000-8000-000000000001/questions/40000000-0000-4000-8000-000000000001/demo-calendar.png',
  image_alt_text = 'Calendario illustrato con il mese di agosto evidenziato',
  image_width = 1200,
  image_height = 800,
  image_updated_at = '2026-08-05T12:00:00Z'::timestamptz
where id = '40000000-0000-4000-8000-000000000001';

update public.answer_options
set
  label = null,
  image_storage_path = 'quizzes/10000000-0000-4000-8000-000000000001/answers/' || id::text || '/demo-' || position::text || '.png',
  image_alt_text = case position
    when 1 then 'Candeline colorate sopra una torta di compleanno'
    when 2 then 'Un paio di calzini piegati'
    when 3 then 'Un mazzo di chiavi metalliche'
    when 4 then 'Un paio di occhiali da sole'
  end,
  image_width = 800,
  image_height = 600,
  image_updated_at = '2026-08-05T12:00:00Z'::timestamptz
where question_id = '40000000-0000-4000-8000-000000000002';

update public.answer_options
set
  image_storage_path = 'quizzes/10000000-0000-4000-8000-000000000001/answers/' || id::text || '/demo-' || position::text || '.png',
  image_alt_text = 'Tessera illustrata con il numero ' || label,
  image_width = 800,
  image_height = 600,
  image_updated_at = '2026-08-05T12:00:00Z'::timestamptz
where question_id = '40000000-0000-4000-8000-000000000003';

commit;
