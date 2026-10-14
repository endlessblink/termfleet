import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// Owner report 2026-10-11: "Working on it at the bottom should be animated". Phones with
// "remove animations" on report reduced motion, and that switched the line off entirely.
// It must move normally and still fade gently (no movement) under reduced motion.
const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const page = `<!doctype html><style>${styles}</style><body class="chat"><main><div class="busyline" role="status"><span class="busyorb" aria-hidden="true"><i></i><i></i><i></i></span><span class="busytext">Working on it</span></div></main></body>`;

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`the working line is animated (${reducedMotion})`, async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ reducedMotion, viewport: { width: 390, height: 800 } });
      const tab = await context.newPage();
      await tab.setContent(page);
      const running = await tab.evaluate(() => ({
        dots: [...document.querySelectorAll('.busyorb i')].map(dot => dot.getAnimations().filter(a => a.playState === 'running' && a.effect.getComputedTiming().iterations === Infinity).length),
        text: document.querySelector('.busytext').getAnimations().filter(a => a.playState === 'running').length,
      }));
      assert.deepEqual(running.dots, [1, 1, 1], 'every dot keeps animating');
      assert.equal(running.text, 1, 'the words keep breathing');
    } finally {
      await browser.close();
    }
  });
}
