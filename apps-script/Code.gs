/**
 * AQ 도입 문의 → 메일 발송 (Google Apps Script 웹 앱)
 *
 * 배포: 배포 > 새 배포 > 유형 "웹 앱" > 실행 계정 "나" > 액세스 "모든 사용자"
 * 코드를 고친 뒤에는 "배포 관리"에서 새 버전으로 다시 배포해야 /exec URL에 반영된다.
 */

// 수신자는 여기에서만 정한다. 클라이언트가 보낸 수신자 값은 쓰지 않는다.
var RECIPIENT = '';

var LIMITS = { email: 254, subject: 200, body: 20000, perHour: 20 };
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 입력 검증. 통과하면 {ok:true, mail}, 아니면 {ok:false, error}. */
function validate(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'bad_request' };
  if (p.hp) return { ok: true, spam: true };                       // honeypot: 사람은 비워 둔다
  var email = String(p.replyTo || '').trim();
  var subject = String(p.subject || '').replace(/[\r\n]+/g, ' ').trim();
  var body = String(p.body || '');
  if (!EMAIL_RE.test(email) || email.length > LIMITS.email) return { ok: false, error: 'bad_email' };
  if (!subject || subject.length > LIMITS.subject) return { ok: false, error: 'bad_subject' };
  if (!body.trim() || body.length > LIMITS.body) return { ok: false, error: 'bad_body' };
  return { ok: true, mail: { subject: subject, body: body, replyTo: email } };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 시간당 전체 발송 건수 제한. 한도 안이면 true. */
function takeSlot_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;
  try {
    var cache = CacheService.getScriptCache();
    var key = 'rl-' + Math.floor(Date.now() / 3600000);
    var n = Number(cache.get(key) || 0);
    if (n >= LIMITS.perHour) return false;
    cache.put(key, String(n + 1), 3600);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  var v = validate(p);
  if (!v.ok) return json_(v);
  if (v.spam) return json_({ ok: true });
  if (!RECIPIENT) return json_({ ok: false, error: 'not_configured' });
  if (!takeSlot_()) return json_({ ok: false, error: 'rate_limited' });
  try {
    MailApp.sendEmail({
      to: RECIPIENT,
      subject: v.mail.subject,
      body: v.mail.body,
      replyTo: v.mail.replyTo,
      name: 'AQ 도입 문의'
    });
  } catch (err) {
    return json_({ ok: false, error: 'send_failed' });
  }
  return json_({ ok: true });
}

function doGet() { return json_({ ok: true }); }

if (typeof module !== 'undefined') module.exports = { validate: validate, doPost: doPost, doGet: doGet, LIMITS: LIMITS, setRecipient: function (r) { RECIPIENT = r; } };
