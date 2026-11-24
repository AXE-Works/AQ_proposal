// node --test apps-script/Code.test.js   (GAS 전역을 mock 해서 Code.gs를 그대로 불러온다)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const sent = [], store = {};
  const ctx = {
    module: { exports: {} }, Date, JSON, String, Number, Math,
    MailApp: { sendEmail: (m) => sent.push(m) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ t, setMimeType() { return this; }, get() { return JSON.parse(this.t); } }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => store[k] ?? null, put: (k, v) => { store[k] = v; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx);
  return { gs: ctx.module.exports, sent, ctx };
}
const post = (gs, o) => gs.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } }).get();
const good = { subject: '[AQ 도입 문의] 테스트', body: '문의 내용\n1. 질문', replyTo: 'a@b.co' };

test('정상 요청은 고정 수신자로 발송되고 replyTo가 문의자다', () => {
  const { gs, sent } = load(); gs.setRecipient('inbox@axeworks.xyz');
  assert.deepStrictEqual(post(gs, good), { ok: true });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'inbox@axeworks.xyz');
  assert.strictEqual(sent[0].replyTo, 'a@b.co');
});
test('클라이언트가 보낸 to는 무시된다', () => {
  const { gs, sent } = load(); gs.setRecipient('inbox@axeworks.xyz');
  post(gs, { ...good, to: 'victim@x.com', cc: 'v@x.com' });
  assert.strictEqual(sent[0].to, 'inbox@axeworks.xyz');
  assert.strictEqual(sent[0].cc, undefined);
});
test('수신자 미설정이면 not_configured', () => {
  const { gs, sent } = load();
  assert.deepStrictEqual(post(gs, good), { ok: false, error: 'not_configured' });
  assert.strictEqual(sent.length, 0);
});
test('잘못된 이메일/빈 본문/과대 길이/깨진 JSON 거부', () => {
  const { gs, sent } = load(); gs.setRecipient('i@a.co');
  assert.strictEqual(post(gs, { ...good, replyTo: 'nope' }).error, 'bad_email');
  assert.strictEqual(post(gs, { ...good, body: '  ' }).error, 'bad_body');
  assert.strictEqual(post(gs, { ...good, body: 'x'.repeat(gs.LIMITS.body + 1) }).error, 'bad_body');
  assert.strictEqual(post(gs, { ...good, subject: 'x'.repeat(gs.LIMITS.subject + 1) }).error, 'bad_subject');
  assert.strictEqual(post(gs, '{oops').error, 'bad_json');
  assert.strictEqual(sent.length, 0);
});
test('subject의 개행은 제거된다', () => {
  const { gs, sent } = load(); gs.setRecipient('i@a.co');
  post(gs, { ...good, subject: 'a\r\nBcc: x@y.z' });
  assert.ok(!/[\r\n]/.test(sent[0].subject));
});
test('honeypot이 차 있으면 ok를 돌려주되 발송하지 않는다', () => {
  const { gs, sent } = load(); gs.setRecipient('i@a.co');
  assert.deepStrictEqual(post(gs, { ...good, hp: 'bot' }), { ok: true });
  assert.strictEqual(sent.length, 0);
});
test('시간당 한도를 넘으면 rate_limited', () => {
  const { gs, sent } = load(); gs.setRecipient('i@a.co');
  for (let i = 0; i < gs.LIMITS.perHour; i++) assert.strictEqual(post(gs, good).ok, true);
  assert.deepStrictEqual(post(gs, good), { ok: false, error: 'rate_limited' });
  assert.strictEqual(sent.length, gs.LIMITS.perHour);
});
test('MailApp 예외는 send_failed로 응답한다', () => {
  const { gs, ctx } = load(); gs.setRecipient('i@a.co');
  ctx.MailApp.sendEmail = () => { throw new Error('quota'); };
  assert.deepStrictEqual(post(gs, good), { ok: false, error: 'send_failed' });
});
