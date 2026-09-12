// Local preview harness for apps-script/ReviewPage.html.
// Replaces the four server hand-off scriptlets with mock values and stubs
// window.fetch with an in-page mock server, so the page runs in any browser.
'use strict';
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', '..', 'apps-script', 'ReviewPage.html');

const BASE_INIT = {
  ok: true, state: 'rate',
  firstName: 'Molly', addressLine1: '2137 Christian St', addressLine2: 'Philadelphia, PA 19146',
  role: 'buyer', agents: ['Alex Clark', 'Chelsey Stiles', 'Francini Castor Weil', 'Jason Wittenstein', 'Rayma Abdallah', 'Ryan Stawasz'],
  agentName: 'Alex Clark', email: 'molly@example.com', dealId: 89,
  token: null, lockedPath: null, savedRating: 0, status: 'new', rating: 0, links: null
};

const SCENARIOS = {
  'email-5':   { init: { rating: 5 } },
  'email-2':   { init: { rating: 2 } },
  'button':    { init: { rating: 0 } },
  'seller-4':  { init: { rating: 4, role: 'seller', firstName: 'Aerin', addressLine1: '820 N Burns St #6', addressLine2: 'Philadelphia, PA 19130' } },
  'resume-low':{ init: { rating: 5, lockedPath: 'low', savedRating: 2, token: 'tok_existing', status: 'rated' } },
  'already':   { init: { status: 'reviewed', token: 'tok_done' } },
  'notfound':  { init: { ok: false, state: 'notfound' } },
  'failed':    { init: { ok: false, state: 'error' } },
  'no-address':{ init: { rating: 5, addressLine1: '', addressLine2: '' } }
};

// Mock server: mirrors the locking rules the real doPost enforces.
const MOCK_SERVER = `
(function(){
  var srv = { path: INIT.lockedPath || null, status: INIT.status || 'new', rating: INIT.savedRating || 0, token: INIT.token || null, calls: [] };
  window.__mockServer = srv;
  window.fetch = function (url, opts) {
    var b = JSON.parse(opts.body); srv.calls.push(b);
    var res = { ok: true };
    if (b.action === 'review.rate') {
      var wanted = b.rating >= 4 ? 'happy' : 'low';
      if (!srv.token) srv.token = 'tok_' + Math.random().toString(36).slice(2);
      if (srv.path === 'low' && wanted === 'happy') { /* locked */ }
      else srv.path = wanted;
      srv.rating = b.rating; srv.status = 'rated';
      res = { ok: true, token: srv.token, path: srv.path, status: srv.status, rating: srv.rating };
    } else if (b.action === 'review.submit') {
      srv.status = 'reviewed';
      res = { ok: true, status: 'reviewed', links: { google: 'https://g.page/r/EXAMPLE/review', zillow: 'https://www.zillow.com/profile/example-agent/' } };
    } else if (b.action === 'review.feedback') {
      srv.status = 'feedback';
      res = { ok: true, status: 'feedback' };
    } else if (b.action === 'review.click') {
      res = { ok: true };
    }
    if (window.__mockFail) res = { ok: false, error: window.__mockFail };
    return Promise.resolve({ json: function () { return Promise.resolve(res); } });
  };
})();
`;

function buildPreview(name) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error('unknown scenario ' + name);
  const init = Object.assign({}, BASE_INIT, sc.init);
  let html = fs.readFileSync(PAGE, 'utf8');
  html = html.replace('<?!= initJson ?>', JSON.stringify(init).replace(/</g, '\\u003c'));
  html = html.replace("'<?= baseUrl ?>'", "'https://example.invalid/exec'");
  html = html.replace("'<?= submitToken ?>'", "'mock-submit-token'");
  html = html.replace("'<?= qaTestToken ?>'", "''");
  html = html.replace('// ---- End server hand-off.', '// ---- End server hand-off.\n' + MOCK_SERVER);
  if (html.indexOf('<?') !== -1) throw new Error('unreplaced scriptlet left in preview');
  return html;
}

module.exports = { buildPreview, SCENARIOS, BASE_INIT };

if (require.main === module) {
  const out = path.join(process.argv[3] || process.cwd(), (process.argv[2] || 'email-5') + '.html');
  fs.writeFileSync(out, buildPreview(process.argv[2] || 'email-5'));
  console.log('wrote', out);
}
