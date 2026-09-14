// Renders every review-page state at 390px and 1280px and asserts the flow.
// Usage: NODE_PATH=$(npm root -g) node test/screenshots.js <outDir>
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { buildPreview } = require('./preview/harness');

const OUT = process.argv[2] || path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = [390, 1280];

async function shot(page, name, w) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
}

(async () => {
  const browser = await chromium.launch();
  const failures = [];
  const fail = (w, m) => failures.push(`${w}px: ${m}`);
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => fail(w, `pageerror: ${e.message}`));

    // 1. Email star tap, 5 stars: locked stars, no question, happy box, buttons off until text
    await page.setContent(buildPreview('email-5'));
    await page.waitForSelector('#happy:not(.hidden)');
    await page.waitForFunction(() => window.__mockServer.calls.length >= 1);
    if (!(await page.$eval('#rateQ', el => el.classList.contains('hidden')))) fail(w, 'question still shown after email rating');
    if ((await page.$$eval('.star.on', els => els.length)) !== 5) fail(w, 'email rating not shown locked');
    if (!(await page.$eval('.star[data-v="1"]', el => el.disabled))) fail(w, 'stars not locked from email');
    const first = await page.evaluate(() => window.__mockServer.calls[0]);
    if (!first || first.rating !== 5 || first.locked !== true) fail(w, `rate call wrong: ${JSON.stringify(first)}`);
    if ((await page.getAttribute('#googleBtn', 'aria-disabled')) !== 'true') fail(w, 'Google button enabled before text');
    await shot(page, '01-happy-empty', w);
    await page.fill('#reviewText', 'Alex made the whole process feel calm. Every question got a clear answer the same day, and we always knew what was coming next.');
    if ((await page.getAttribute('#googleBtn', 'aria-disabled')) !== 'false') fail(w, 'Google button still disabled after text');
    await shot(page, '02-happy-filled', w);
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#googleBtn')]);
    await popup.close().catch(() => {});
    await page.waitForFunction(() => window.__mockServer.calls.some(c => c.action === 'review.submit'));
    const sub = await page.evaluate(() => window.__mockServer.calls.find(c => c.action === 'review.submit'));
    if (!sub || sub.site !== 'google' || !/Alex made/.test(sub.text)) fail(w, `submit wrong: ${JSON.stringify(sub)}`);
    if (!/Copied/.test(await page.textContent('#copied'))) fail(w, 'copy hint missing');
    await shot(page, '03-happy-after-google', w);

    // 2. Email star tap, 2 stars: locked, private form, alert on load, then send
    await page.setContent(buildPreview('email-2'));
    await page.waitForSelector('#low:not(.hidden)');
    await shot(page, '05-low-empty', w);
    await page.fill('#fbComment', 'Showings were often rescheduled at the last minute and we struggled to reach anyone on weekends.');
    await page.check('#fbContact');
    await page.fill('#fbPhone', '215 555 0142');
    await shot(page, '06-low-filled', w);
    await page.click('#submitFeedback');
    await page.waitForSelector('#doneLow:not(.hidden)');
    if (!(await page.$eval('#low', el => el.classList.contains('hidden')))) fail(w, 'form still shown after feedback');
    await shot(page, '08-low-done', w);

    // 3. Button in email (no rating): question and live stars, box locked; keyboard select
    await page.setContent(buildPreview('button'));
    await page.waitForSelector('#rate:not(.hidden)');
    if (await page.$eval('#rateQ', el => el.classList.contains('hidden'))) fail(w, 'question hidden on unrated arrival');
    if (!(await page.$eval('#reviewText', el => el.disabled))) fail(w, 'review box not locked before a rating');
    await shot(page, '09-button-unrated', w);
    await page.focus('.star[data-v="1"]');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.waitForSelector('#happy:not(.hidden)');
    if ((await page.$eval('.star[aria-pressed="true"]', el => el.dataset.v)) !== '4') fail(w, 'keyboard rating not 4');
    await page.click('.star[data-v="2"]');
    await page.waitForSelector('#low:not(.hidden)');
    await page.click('.star[data-v="5"]');
    await page.waitForSelector('#happy:not(.hidden)');
    await shot(page, '10-button-rated', w);

    // 4. Seller copy
    await page.setContent(buildPreview('seller-4'));
    await page.waitForSelector('#happy:not(.hidden)');
    const g = await page.textContent('#greeting');
    if (!/sale of your home/.test(g)) fail(w, `seller greeting wrong: ${g}`);
    if (!/other sellers/.test(await page.textContent('#happyIntro'))) fail(w, 'seller intro wrong');
    await shot(page, '11-seller', w);

    // 5. Resume an unsubmitted 2-star rating from the button link
    await page.setContent(buildPreview('resume'));
    await page.waitForSelector('#low:not(.hidden)');
    if ((await page.$eval('.star[aria-pressed="true"]', el => el.dataset.v)) !== '2') fail(w, 'resume rating not 2');
    await shot(page, '12-resume', w);

    // 6. Terminal and error states
    for (const [sc, sel, n] of [['already', '#already', '13-already'], ['notfound', '#notfound', '14-notfound'], ['failed', '#failed', '15-failed'], ['no-address', '#rate', '16-no-address']]) {
      await page.setContent(buildPreview(sc));
      await page.waitForSelector(`${sel}:not(.hidden)`);
      await shot(page, n, w);
    }
    await ctx.close();
  }
  await browser.close();
  if (failures.length) { console.error('FAILURES:\n' + failures.join('\n')); process.exit(1); }
  console.log('ok: screenshots in', OUT);
})();
