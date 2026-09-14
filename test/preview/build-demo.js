// Builds a self-contained, clickable demo: page 1 is the FUB email as the
// client sees it; its stars and button lead to page 2, the review page, run
// against a mock server. A look switcher previews alternative palettes.
// Usage: node test/preview/build-demo.js <out.html>
'use strict';
const fs = require('fs');
const path = require('path');
const { SCENARIOS, BASE_INIT } = require('./harness');

const out = process.argv[2];
if (!out) { console.error('usage: build-demo.js <out.html>'); process.exit(1); }
const root = path.join(__dirname, '..', '..');
let html = fs.readFileSync(path.join(root, 'apps-script', 'ReviewPage.html'), 'utf8');

// Strip the document wrapper: the host page supplies doctype/html/head/body.
html = html.replace(/^[\s\S]*?<title>/, '<title>').replace(/<\/head>\s*<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '');
html = html.replace('<title>Your experience | The Stawasz Group</title>', '<title>TSG Client Review Demo</title>');

// Page 1: the email, with sample merge values and links rewired to the demo.
let email = fs.readFileSync(path.join(root, 'email', 'fub-review-email.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/, '')
  .replace(/%contact_first_name%/g, 'Molly').replace(/%agent_name%/g, 'Alex Clark')
  .replace(/https:\/\/script\.google\.com\/macros\/s\/[^"?]+\/exec\?page=review&e=%contact_email%&r=(\d)/g, '#email-$1')
  .replace(/https:\/\/script\.google\.com\/macros\/s\/[^"?]+\/exec\?page=review&e=%contact_email%/g, '#button');

const scenarios = {};
for (let r = 1; r <= 5; r++) scenarios['email-' + r] = Object.assign({}, BASE_INIT, { rating: r });
scenarios['button'] = Object.assign({}, BASE_INIT, { rating: 0 });
scenarios['seller-4'] = Object.assign({}, BASE_INIT, SCENARIOS['seller-4'].init);
scenarios['already'] = Object.assign({}, BASE_INIT, SCENARIOS['already'].init);

const demoBar = `
<style>
  .demo { background: #1D2620; color: #F6F1E6; font-family: 'Archivo', Arial, sans-serif; font-size: 13px; padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
  .demo span { opacity: .75; }
  .demo a { color: #F6F1E6; text-decoration: none; padding: 5px 10px; border: 1px solid rgba(246,241,230,.35); border-radius: 3px; }
  .demo a[aria-current="true"] { background: #2F5240; border-color: #2F5240; }
  .demo.looks { background: #26322B; }
  #demoEmail { background: #F6F1E6; padding-bottom: 24px; }
  .mailhead { max-width: 560px; margin: 0 auto; padding: 20px 12px 0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #5E6963; line-height: 1.5; }
  .mailhead b { color: #1D2620; }

  /* Previous look, demo only, for comparison. */
  body[data-look="cream"] { --green: #F6F1E6; --green-deep: #FFFFFF; --green-line: #DDD8CC; --cream: #1D2620; --cream-soft: #5E6963; --star-empty: #C9CFC9; --disabled-bg: #D9DCD7; --disabled-ink: #5E6963; --error: #8A2E22; --field: #FFFFFF; }
  body[data-look="cream"] .band { background: #2F5240; color: #F6F1E6; }
  body[data-look="cream"] .btn { background: #2F5240; color: #FFFFFF; }
  body[data-look="cream"] .btn:hover { background: #26432F; }
  body[data-look="cream"] .btn[disabled], body[data-look="cream"] .btn[aria-disabled="true"] { background: #D9DCD7; color: #5E6963; }
  body[data-look="cream"] .copied { color: #2F5240; }
  body[data-look="cream"] .star.on svg { filter: none; stroke: none; }
  body[data-look="cream"] .star svg { stroke: none; }
  body[data-look="cream"] textarea, body[data-look="cream"] input[type=tel] { border-color: #9AA39D; }
  body[data-look="cream"] .sheet { border-radius: 0; }
</style>
<nav class="demo" aria-label="Demo pages">
  <span>Page 1 is the email. Tap a star or the button to reach page 2.</span>
  <a href="#email" data-sc="email">Email</a>
  <a href="#button" data-sc="button">Review page, unrated</a>
  <a href="#seller-4" data-sc="seller-4">Seller</a>
  <a href="#already" data-sc="already">Already reviewed</a>
  <span>Mock data. Nothing is saved.</span>
</nav>
<nav class="demo looks" aria-label="Looks">
  <span>Look:</span>
  <a href="#" data-look="green">Green, brass stars (new)</a>
  <a href="#" data-look="cream">Cream (previous)</a>
</nav>
<div id="demoEmail" class="hidden">
  <div class="mailhead"><b>From:</b> Alex Clark &lt;alex@tsg.homes&gt;<br><b>Subject:</b> How was your experience with us?</div>
  ${email}
</div>`;

const initCode = `var __SCENARIOS = ${JSON.stringify(scenarios).replace(/</g, '\\u003c')};
var INIT = { ok: false, state: 'error' };
function __pick() { var sc = (location.hash || '#email').slice(1); return (sc !== 'email' && !__SCENARIOS[sc]) ? 'email' : sc; }
function __go() {
  var sc = __pick();
  document.querySelectorAll('.demo a[data-sc]').forEach(function (a) { a.setAttribute('aria-current', a.dataset.sc === sc || (sc.indexOf('email-') === 0 && a.dataset.sc === 'button') ? 'true' : 'false'); });
  var onEmail = sc === 'email';
  document.getElementById('demoEmail').classList.toggle('hidden', !onEmail);
  document.querySelector('.band').classList.toggle('hidden', onEmail);
  document.querySelector('main').classList.toggle('hidden', onEmail);
  document.querySelector('footer').classList.toggle('hidden', onEmail);
  if (!onEmail && window.__boot) { window.__mockReset(__SCENARIOS[sc]); window.__boot(__SCENARIOS[sc]); window.scrollTo(0, 0); }
}
window.addEventListener('hashchange', __go);
(function () {
  var look = 'green'; try { look = localStorage.getItem('tsgLook2') || 'green'; } catch (e) {}
  document.body.setAttribute('data-look', look);
  document.querySelectorAll('.demo a[data-look]').forEach(function (a) {
    a.setAttribute('aria-current', a.dataset.look === look ? 'true' : 'false');
    a.addEventListener('click', function (ev) { ev.preventDefault(); try { localStorage.setItem('tsgLook2', a.dataset.look); } catch (e) {} document.body.setAttribute('data-look', a.dataset.look); document.querySelectorAll('.demo a[data-look]').forEach(function (b) { b.setAttribute('aria-current', b === a ? 'true' : 'false'); }); });
  });
})();`;

html = html.replace('var INIT = <?!= initJson ?>;', initCode);
html = html.replace("'<?= baseUrl ?>'", "'https://example.invalid/exec'").replace("'<?= submitToken ?>'", "'demo'").replace("'<?= qaTestToken ?>'", "''");

const mock = `
(function(){
  var srv = { status: 'new', token: null };
  window.__mockReset = function (init) { srv.status = init.status || 'new'; srv.token = init.token || null; };
  window.fetch = function (url, opts) {
    var b = JSON.parse(opts.body); var res = { ok: true };
    if (b.action === 'review.rate') { if (!srv.token) srv.token = 'demo_' + Math.random().toString(36).slice(2); srv.status = 'rated'; res = { ok: true, token: srv.token, status: 'rated', links: { google: 'https://www.google.com/maps', zillow: 'https://www.zillow.com/' } }; }
    else if (b.action === 'review.submit') { srv.status = 'reviewed'; res = { ok: true, status: 'reviewed' }; }
    else if (b.action === 'review.feedback') { srv.status = 'feedback'; res = { ok: true, status: 'feedback' }; }
    return new Promise(function (r) { setTimeout(function () { r({ json: function () { return Promise.resolve(res); } }); }, 250); });
  };
})();`;
html = html.replace('// ---- End server hand-off.', '// ---- End server hand-off.' + mock);
// Demo hook: restart the page in place for a new scenario, resetting form state.
html = html.replace(/\n  boot\(\);\n\}\)\(\);/, `
  window.__boot = function (init) {
    INIT = init;
    state.rating = 0; state.path = null; state.token = null; state.status = 'new'; state.reviewText = ''; state.links = null; state.saved = false;
    reviewText.value = ''; fbComment.value = ''; fbContact.checked = false; $('fbPhone').value = ''; $('fbPhoneWrap').classList.add('hidden');
    submitFeedback.disabled = true; $('copied').textContent = ''; $('starsHint').textContent = ''; state.locked = false; $('stars').classList.remove('locked'); $('rateQ').classList.remove('hidden'); starEls.forEach(function (el) { el.disabled = false; el.removeAttribute('aria-disabled'); });
    $('copyFallback').classList.add('hidden');
    boot();
  };
  boot(); __go();
})();`);
if (!html.includes('window.__boot')) throw new Error('boot hook not applied');
html = html.replace('<div class="band">THE STAWASZ GROUP</div>', demoBar + '\n<div class="band">THE STAWASZ GROUP</div>');
if (html.includes('<?')) throw new Error('scriptlet left in demo');
fs.writeFileSync(out, html);
console.log('wrote', out);
