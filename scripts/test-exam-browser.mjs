// UI-only tests with controlled HTTP fixtures. No external service requests or credentials.
// EXAM_TEST_TOOLS must contain @playwright/test and its installed chromium/webkit browsers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
const require = createRequire(
  join(process.env.EXAM_TEST_TOOLS, 'package.json'),
);
const { chromium, webkit, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 20000 });
const port = 3197;
const base = `http://localhost:${port}`;
const secret = 'local-browser-test-secret-at-least-32-chars';
const server = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)],
  {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-ui-fixture',
      SUPABASE_SERVICE_ROLE_KEY: 'local-fixture-only',
      HOST_SESSION_SECRET: secret,
      HOST_ACCESS_PASSWORD: 'local-test-only',
    },
  },
);
let logs = '';
server.stdout.on('data', (d) => {
  logs = (logs + d).slice(-5000);
});
server.stderr.on('data', (d) => {
  logs = (logs + d).slice(-5000);
});
const screenshotDir =
  process.env.EXAM_TEST_OUTPUT ??
  join(process.env.EXAM_TEST_TOOLS, 'screenshots');
await mkdir(screenshotDir, { recursive: true });
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (i === 119) throw new Error(`Server startup failed: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  for (const [name, engine] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    if (process.env.EXAM_TEST_BROWSER && process.env.EXAM_TEST_BROWSER !== name) continue;
    const browser = await engine.launch({ headless: true, timeout: 30000 });
    try {
      let phase = 'lobby';
      const members = [
        { nickname: 'Primo', avatarKey: 'fox' },
        { nickname: 'Secondo', avatarKey: 'panda' },
      ];
      const progress = members.map((_, playerIndex) => ({
        player_id: `player-${playerIndex}`,
        last_index: 0,
        submitted_at: null,
        result: null,
        completed_count: 0,
        questions: Array.from({ length: 3 }, (_, i) => ({
          id: `q${i}`,
          position: i + 1,
          category: 'Esame demo',
          prompt: `Domanda di prova ${i + 1}`,
          selected_option_id: null,
          correct_option_id: null,
          options: Array.from({ length: 4 }, (_, o) => ({
            id: `q${i}-o${o}`,
            position: o + 1,
            text: `Opzione ${o + 1}`,
          })),
        })),
      }));
      for (const p of progress) {
        Object.assign(p.questions[2], {
          image_storage_path: 'quizzes/10000000-0000-4000-8000-000000000001/questions/40000000-0000-4000-8000-000000000001/missing.png',
          image_alt_text: 'Immagine domanda di prova', image_width: 640, image_height: 360, image_updated_at: '2026-10-20T10:00:00Z',
        });
        Object.assign(p.questions[2].options[0], {
          image_storage_path: 'quizzes/10000000-0000-4000-8000-000000000001/answers/50000000-0000-4000-8000-000000000001/missing.png',
          image_alt_text: 'Immagine risposta di prova', image_width: 400, image_height: 300, image_updated_at: '2026-10-20T10:00:00Z',
        });
      }
      const publicSnapshot = () => ({
        code: 'ABCDEF',
        quiz_title: 'Esame di prova',
        phase,
        mode: 'exam',
        participant_count: 2,
        max_players: 2,
        players: members.map((p) => ({
          nickname: p.nickname,
          avatar_key: p.avatarKey,
        })),
        current_question_index: null,
        total_question_count: 3,
        current_question: null,
        voted_count: 0,
        correct_option_id: null,
        non_voters: [],
        leaderboard: [],
        submitted_count: progress.filter((p) => p.submitted_at).length,
      });
      const runtimeErrors = [];
      let lastCreated;
      let rejoinCalls = 0;
      const contexts = [];
      async function makePage(playerIndex = null, host = false) {
        const context = await browser.newContext({
          viewport:
            playerIndex === null
              ? { width: 1280, height: 720 }
              : { width: 320, height: 800 },
          serviceWorkers: 'block',
        });
        contexts.push(context);
        // Hide the development indicator, which overlaps bottom buttons at 320px.
        // Runtime errors still fail the test via pageerror below.
        await context.addInitScript(() =>
          document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = 'nextjs-portal { display: none !important; }';
            document.head.append(style);
          }),
        );
        const now = Math.floor(Date.now() / 1000);
        if (host) {
          const payload = Buffer.from(
            JSON.stringify({
              version: 1,
              issuedAt: now,
              expiresAt: now + 3600,
            }),
          ).toString('base64url');
          const signature = createHmac('sha256', secret)
            .update(payload)
            .digest('base64url');
          await context.addCookies([
            {
              name: 'quiz_engine_host_session',
              value: `${payload}.${signature}`,
              url: base,
              httpOnly: true,
            },
          ]);
        }
        if (playerIndex !== null) {
          const session = {
            access_token: 'fixture-access',
            refresh_token: 'fixture-refresh',
            token_type: 'bearer',
            expires_at: now + 3600,
            expires_in: 3600,
            user: {
              id: `user-${playerIndex}`,
              is_anonymous: true,
              app_metadata: {},
              user_metadata: {},
              aud: 'authenticated',
              created_at: new Date().toISOString(),
            },
          };
          await context.addCookies([
            {
              name: 'sb-127-auth-token',
              value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`,
              url: base,
            },
          ]);
          await context.addInitScript(() =>
            localStorage.setItem('quiz-engine:rejoin:ABCDEF', 'a'.repeat(43)),
          );
        }
        await context.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          const path = url.pathname;
          if (path === '/_next/image') return route.fulfill({ status: 404, body: '' });
          const json = (data) => route.fulfill({ json: data });
          if (url.port === '54329') {
            if (path.includes('lobby_public_sessions'))
              return json(publicSnapshot());
            if (path.includes('/auth/v1/'))
              return json({
                access_token: 'fixture-access',
                refresh_token: 'fixture-refresh',
                token_type: 'bearer',
                expires_in: 3600,
                user: {
                  id: `new-user-${playerIndex}`,
                  is_anonymous: true,
                  app_metadata: {},
                  user_metadata: {},
                  aud: 'authenticated',
                  created_at: new Date().toISOString(),
                },
              });
            if (path.includes('/rpc/')) {
              const p = progress[playerIndex];
              const input = route.request().postDataJSON();
              if (path.endsWith('/save_exam_progress')) {
                if (p.submitted_at)
                  return route.fulfill({
                    status: 400,
                    json: { code: 'P0001' },
                  });
                p.last_index = input.p_last_index;
                if (input.p_game_question_id)
                  p.questions.find(
                    (q) => q.id === input.p_game_question_id,
                  ).selected_option_id = input.p_game_answer_option_id;
                p.completed_count = p.questions.filter(
                  (q) => q.selected_option_id,
                ).length;
              }
              if (path.endsWith('/submit_exam') && !p.submitted_at) {
                p.submitted_at = new Date().toISOString();
                p.questions.forEach((q) => {
                  q.correct_option_id = `${q.id}-o0`;
                });
                const correct = p.questions.filter(
                  (q) => q.selected_option_id === q.correct_option_id,
                ).length;
                p.result = {
                  total: 3,
                  correct,
                  incorrect: p.completed_count - correct,
                  omitted: 3 - p.completed_count,
                  percentage: Math.round((correct / 3) * 10000) / 100,
                  points: correct * 100,
                };
                if (progress.every((p) => p.submitted_at)) phase = 'finished';
              }
              return json(p);
            }
            return route.abort();
          }
          if (url.origin !== base) return route.abort();
          if (path === '/api/host/quizzes')
            return json({
              quizzes: [
                {
                  id: '10000000-0000-4000-8000-000000000001',
                  title: 'Esame di prova',
                  availableExamQuestionCount: 3,
                  categories: [],
                  presets: [],
                },
              ],
            });
          if (path === '/api/host/game-sessions') {
            if (route.request().method() === 'POST') {
              lastCreated = route.request().postDataJSON();
              return json({
                session: {
                  id: 'fixture',
                  code: 'ABCDEF',
                  title: 'Esame di prova',
                  maxPlayers: 2,
                },
              });
            }
            return json({ sessions: [] });
          }
          if (path === '/api/host/game-sessions/ABCDEF')
            return json({
              session: {
                id: 'fixture',
                code: 'ABCDEF',
                title: 'Esame di prova',
                presetName: 'Esame',
                phase,
                participantCount: 2,
                maxPlayers: 2,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                players: members.map((p, i) => ({
                  ...p,
                  id: `player-${i}`,
                  joinedAt: new Date().toISOString(),
                })),
              },
            });
          if (path.endsWith('/ABCDEF/start')) {
            phase = 'voting_open';
            return json({ started: true, mode: 'exam' });
          }
          if (path.endsWith('/ABCDEF/exam')) {
            if (url.searchParams.has('playerId'))
              return json({
                progress: progress.find(
                  (p) => p.player_id === url.searchParams.get('playerId'),
                ),
              });
            return json({
              players: members.map((p, i) => ({
                ...p,
                playerId: `player-${i}`,
                completedCount: progress[i].completed_count,
                submittedAt: progress[i].submitted_at,
                points: progress[i].result?.points ?? null,
              })),
            });
          }
          if (path.endsWith('/participant'))
            return json({ player: members[playerIndex] });
          if (path.endsWith('/rejoin')) {
            rejoinCalls++;
            return json({
              player: members[playerIndex],
              rejoinToken: 'b'.repeat(43),
            });
          }
          if (path.startsWith('/api/')) return route.abort();
          return route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(20000);
        page.on('pageerror', (error) => runtimeErrors.push(error.message));
        page.on('dialog', (dialog) => dialog.accept());
        return page;
      }
      // WebKit on Windows is tested in one active mobile context; multi-context
      // orchestration and the full host/display workflow run in Chromium below.
      if (name === 'webkit') {
        phase = 'voting_open';
        const mobile = await makePage(0);
        await mobile.goto(`${base}/play/ABCDEF`);
        await expect(mobile.getByRole('heading', { name: 'Domanda di prova 1' })).toBeVisible();
        await mobile.getByRole('button', { name: /A.*Opzione 1/ }).click();
        await mobile.getByRole('button', { name: 'Conferma e continua' }).click();
        await expect(mobile.getByRole('heading', { name: 'Domanda di prova 2' })).toBeVisible();
        await mobile.reload();
        await expect(mobile.getByRole('heading', { name: 'Domanda di prova 2' })).toBeVisible();
        await mobile.context().clearCookies(); await mobile.reload();
        await expect(mobile.getByRole('heading', { name: 'Domanda di prova 2' })).toBeVisible();
        assert.ok(rejoinCalls > 0);
        await mobile.getByRole('button', { name: 'Salta', exact: true }).click();
        await mobile.getByRole('button', { name: 'Termina esame' }).click();
        await expect(mobile.getByText('Risposte date: 1. Domande mancanti: 2.')).toBeVisible();
        await mobile.getByRole('button', { name: 'Consegna definitivamente' }).click();
        await expect(mobile.getByRole('heading', { name: 'Esame consegnato', exact: true })).toBeVisible();
        assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await mobile.screenshot({ path: join(screenshotDir, 'webkit-exam-results.png'), fullPage: true, timeout: 10000 });
        assert.deepEqual(runtimeErrors, []);
        console.log('PASS webkit: isolated mobile player, confirm/skip, refresh, Auth loss/rejoin, partial submission, private results and 320px layout.');
        continue;
      }
      const host = await makePage(null, true);
      const display = await makePage();
      const one = await makePage(0);
      const two = await makePage(1);
      await host.goto(`${base}/host`);
      await host.getByLabel('Modalità').selectOption('exam');
      await expect(host.getByText('Domande per categoria')).toHaveCount(0);
      await host.getByLabel('Numero di domande').fill('3');
      await expect(host.getByLabel('Numero massimo giocatori')).toHaveValue('');
      await host.getByLabel('Numero massimo giocatori').fill('2');
      await host
        .getByRole('button', { name: 'Crea partita', exact: true })
        .click();
      await expect(
        host.getByText('Partita creata', { exact: true }),
      ).toBeVisible();
      assert.equal(lastCreated.mode, 'exam');
      assert.equal(lastCreated.questionCount, 3);
      await host.goto(`${base}/host/ABCDEF`);
      await display.goto(`${base}/display/ABCDEF`);
      await one.goto(`${base}/play/ABCDEF`);
      await two.goto(`${base}/play/ABCDEF`);
      await expect(one.getByText('In attesa che l’host inizi')).toBeVisible();
      await host.getByRole('button', { name: 'Avvia esame' }).click();
      await host.reload();
      await display.reload();
      await one.reload();
      await two.reload();
      await one.bringToFront();
      await expect(
        one.getByRole('heading', { name: 'Domanda di prova 1' }),
      ).toBeVisible();
      await expect(
        two.getByRole('heading', { name: 'Domanda di prova 1' }),
      ).toBeVisible();
      await expect(
        display.getByText('Ancora in corso', { exact: true }),
      ).toBeVisible();
      await expect(display.getByText('Domanda di prova 1')).toHaveCount(0);
      await one.getByRole('button', { name: /A.*Opzione 1/ }).click();
      await expect(
        one.getByText('Scelta non salvata: premi Conferma.'),
      ).toBeVisible();
      assert.equal(progress[0].completed_count, 0);
      await one.getByRole('button', { name: 'Conferma e continua' }).click();
      await expect(
        one.getByRole('heading', { name: 'Domanda di prova 2' }),
      ).toBeVisible();
      await one.getByRole('button', { name: 'Salta', exact: true }).click();
      await expect(
        one.getByRole('heading', { name: 'Domanda di prova 3' }),
      ).toBeVisible();
      await one
        .getByRole('button', { name: 'Domanda 1, confermata', exact: true })
        .click();
      await one.getByRole('button', { name: /B.*Opzione 2/ }).click();
      await one.getByRole('button', { name: 'Conferma e continua' }).click();
      await expect(
        one.getByRole('heading', { name: 'Domanda di prova 2' }),
      ).toBeVisible();
      await one.reload();
      await expect(
        one.getByRole('heading', { name: 'Domanda di prova 2' }),
      ).toBeVisible();
      assert.equal(progress[0].questions[0].selected_option_id, 'q0-o1');
      assert.equal(progress[1].last_index, 0);
      await one.context().setOffline(true);
      await expect(
        one.getByText('Sei offline.', { exact: false }),
      ).toBeVisible();
      await expect(
        one.getByRole('button', { name: 'Conferma e continua' }),
      ).toBeDisabled();
      await one.context().setOffline(false);
      await one.context().clearCookies();
      await one.reload();
      await expect(
        one.getByRole('heading', { name: 'Domanda di prova 2' }),
      ).toBeVisible();
      assert.ok(rejoinCalls > 0);
      await one
        .getByRole('button', { name: 'Domanda 3, mancante', exact: true })
        .click();
      await one.getByRole('button', { name: /A.*Opzione 1/ }).click();
      await one.getByRole('button', { name: 'Termina esame' }).click();
      await expect(
        one.getByText('Risposte date: 1. Domande mancanti: 2.'),
      ).toBeVisible();
      await expect(
        one.getByText('La scelta attuale non è confermata', { exact: false }),
      ).toBeVisible();
      await one.getByRole('button', { name: 'Torna alla revisione' }).click();
      await one
        .getByRole('button', { name: 'Conferma risposta', exact: true })
        .click();
      await expect(
        one.getByText('Risposta salvata.', { exact: true }),
      ).toBeVisible();
      await one.screenshot({
        path: join(screenshotDir, `${name}-exam-mobile.png`),
        fullPage: true,
      });
      assert.ok(
        await one.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        'No horizontal scrolling at 320px',
      );
      await one.getByRole('button', { name: 'Termina esame' }).click();
      await one
        .getByRole('button', { name: 'Consegna definitivamente' })
        .click();
      await expect(
        one.getByRole('heading', { name: 'Esame consegnato', exact: true }),
      ).toBeVisible();
      await one.reload();
      await expect(
        one.getByRole('heading', { name: 'Esame consegnato', exact: true }),
      ).toBeVisible();
      await expect(
        two.getByText('Risposta corretta', { exact: false }),
      ).toHaveCount(0);
      await host.bringToFront();
      await host.reload();
      await host.getByRole('button', { name: /punti · Correzione/ }).click();
      await expect(
        host.getByRole('heading', { name: 'Risultato di Primo' }),
      ).toBeVisible();
      await two.bringToFront();
      await two
        .getByRole('button', { name: 'Domanda 3, mancante', exact: true })
        .click();
      await two.getByRole('button', { name: 'Termina esame' }).click();
      await two
        .getByRole('button', { name: 'Consegna definitivamente' })
        .click();
      await expect(
        two.getByRole('heading', { name: 'Esame consegnato', exact: true }),
      ).toBeVisible();
      await display.bringToFront();
      await display.reload();
      await expect(
        display.getByText('Tutti hanno consegnato · Esame concluso'),
      ).toBeVisible();
      await expect(
        display.getByText('Risposta corretta', { exact: false }),
      ).toHaveCount(0);
      await display.screenshot({
        path: join(screenshotDir, `${name}-exam-display.png`),
        fullPage: true,
      });
      await one.screenshot({
        path: join(screenshotDir, `${name}-exam-results.png`),
        fullPage: true,
      });
      await expect(one.getByRole('img', { name: 'Immagine domanda di prova', exact: true })).toBeVisible();
      await expect(one.getByRole('img', { name: 'Immagine risposta di prova', exact: true })).toBeVisible();
      assert.deepEqual(runtimeErrors, [], 'No browser runtime errors');
      for (const context of contexts) await context.close();
      console.log(
        `PASS ${name}: host, display, two isolated players; create/start, skip/change/save, refresh/Auth loss/offline, partial submission, private correction, final state, 320px layout.`,
      );
    } catch (error) {
      console.error('Local Next server diagnostics:', logs);
      for (const c of browser.contexts())
        for (const page of c.pages()) {
          console.error(
            'Failure page',
            page.url(),
            (
              await page
                .locator('main')
                .innerText()
                .catch(() => '')
            ).slice(0, 250),
          );
          await page
            .screenshot({
              timeout: 5000,
              path: join(
                screenshotDir,
                `${name}-failure-${browser.contexts().indexOf(c)}.png`,
              ),
            })
            .catch(() => {});
        }
      throw error;
    } finally {
      await browser.close();
    }
  }
} finally {
  if (process.platform === 'win32')
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  else server.kill('SIGTERM');
}
