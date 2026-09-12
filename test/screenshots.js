// Renders every review-page state at 390px and 1280px, plus the email.
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
  await page.waitForTimeout(350); // let star animation settle
  await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
}

(async () => {
  const browser = await chromium.launch();
  const failures = [];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => failures.push(`${w}px pageerror: ${e.message}`));

    // 1. Email star tap, 5 stars -> happy path -> submit -> links -> copy
    await page.setContent(buildPreview('email-5'));
    await page.waitForSelector('#happy:not(.hidden)');
    await shot(page, '01-happy-empty', w);
    await page.fill('#reviewText', 'Alex made the whole process feel calm. Every question got a clear answer the same day, and we always knew what was coming next.');
    await shot(page, '02-happy-filled', w);
    await page.click('#submitReview');
    await page.waitForSelector('#doneHappy:not(.hidden)');
    await shot(page, '03-happy-done', w);
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#googleBtn')]);
    await popup.close().catch(() => {});
    await shot(page, '04-happy-copied', w);
    const copied = await page.textContent('#copied');
    if (!/Copied/.test(copied)) failures.push(`${w}px: copy hint missing: "${copied}"`);

    // 2. Email star tap, 2 stars -> low path -> fill -> send
    await page.setContent(buildPreview('email-2'));
    await page.waitForSelector('#low:not(.hidden)');
    await shot(page, '05-low-empty', w);
    await page.fill('#fbComment', 'Showings were often rescheduled at the last minute and we struggled to reach anyone on weekends.');
    await page.check('#fbContact');
    await page.fill('#fbPhone', '215 555 0142');
    await shot(page, '06-low-filled', w);
    // Locked: tapping 5 on the low path must not reveal the happy box.
    await page.click('.star[data-v="5"]');
    await page.waitForTimeout(100);
    const happyVisible = await page.$eval('#happy', el => !el.classList.contains('hidden'));
    if (happyVisible) failures.push(`${w}px: low path flipped to happy`);
    await shot(page, '07-low-locked-after-5', w);
    await page.click('#submitFeedback');
    await page.waitForSelector('#doneLow:not(.hidden)');
    await shot(page, '08-low-done', w);

    // 3. Button in email (no rating), then keyboard selection
    await page.setContent(buildPreview('button'));
    await page.waitForSelector('#rate:not(.hidden)');
    await shot(page, '09-button-unrated', w);
    await page.focus('.star[data-v="1"]');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.waitForSelector('#happy:not(.hidden)', { timeout: 5000 });
    const checked = await page.$eval('.star[aria-pressed="true"]', el => el.dataset.v);
    if (checked !== '4') failures.push(`${w}px: keyboard rating expected 4 got ${checked}`);
    await shot(page, '10-keyboard-4', w);

    // 4. Seller copy
    await page.setContent(buildPreview('seller-4'));
    await page.waitForSelector('#happy:not(.hidden)');
    const g = await page.textContent('#greeting');
    if (!/sell this home/.test(g)) failures.push(`${w}px: seller greeting wrong: ${g}`);
    await shot(page, '11-seller', w);

    // 5. Resume a locked low request from a 5-star email link
    await page.setContent(buildPreview('resume-low'));
    await page.waitForSelector('#low:not(.hidden)');
    await page.waitForTimeout(100);
    const hv = await page.$eval('#happy', el => !el.classList.contains('hidden'));
    if (hv) failures.push(`${w}px: resumed low request flipped to happy`);
    await shot(page, '12-resume-low', w);

    // 6. Terminal and error states
    for (const [sc, sel, n] of [['already', '#already', '13-already'], ['notfound', '#notfound', '14-notfound'], ['failed', '#failed', '15-failed'], ['no-address', '#happy', '16-no-address']]) {
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
