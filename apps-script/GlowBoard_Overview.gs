/**
 * GlowBoard Overview – Created by Mondiro
 * Chạy ngầm bằng tài khoản Google của bạn: mỗi phút xem file Google Sheet nào trong folder vừa sửa,
 * đọc cột Assignee / Status / Miêu tả của các tab rồi gửi lên board của team trên GlowBoard.
 * Không cần Deploy. Chỉ cần chọn hàm "setup" trên thanh công cụ → Run (1 lần) → cho phép quyền.
 * Tắt: Triggers (biểu tượng đồng hồ bên trái) → xoá trigger "sync".
 */
const FOLDER_ID = '{{FOLDER_ID}}';
const TEAM_ID = '{{TEAM_ID}}';
const TEAM_CODE = '{{TEAM_CODE}}';
const API_KEY = '{{API_KEY}}';
const PROJECT_ID = '{{PROJECT_ID}}';
const BOT_NAME = 'Overview (Google Sheet)';
const MAX_TABS = 15;
const HEARTBEAT_MS = 15 * 60 * 1000;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().deleteProperty('seen');
  sync();
  Logger.log('Xong! Mở GlowBoard → Overview để xem.');
}

function sync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const seen = JSON.parse(props.getProperty('seen') || '{}');
    const auth = fbAuth();
    ensureMember(auth, props);
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    const files = [], now = {};
    let changed = false;
    while (it.hasNext()) {
      const f = it.next(), id = f.getId(), up = f.getLastUpdated().getTime();
      files.push({ id: id, name: f.getName(), url: f.getUrl(), updated: up });
      now[id] = up;
      if (seen[id] === up) continue;
      let data;
      try { data = readAll(SpreadsheetApp.open(f)); }
      catch (err) { data = { error: String((err && err.message) || err) }; }
      data.id = id; data.name = f.getName(); data.url = f.getUrl(); data.updated = up; data.at = Date.now();
      fsSet(auth, '_ov_' + id, fitSize(data));
      seen[id] = up; changed = true;
    }
    Object.keys(seen).forEach(function (id) {
      if (!(id in now)) { fsDelete(auth, '_ov_' + id); delete seen[id]; changed = true; }
    });
    const last = Number(props.getProperty('indexAt') || 0);
    if (changed || Date.now() - last > HEARTBEAT_MS) {
      files.sort(function (a, b) { return a.name.localeCompare(b.name); });
      fsSet(auth, '_ovIndex', { folder: folder.getName(), files: files, bot: auth.uid, at: Date.now() });
      props.setProperty('indexAt', String(Date.now()));
    }
    props.setProperty('seen', JSON.stringify(seen));
  } finally {
    lock.releaseLock();
  }
}

/* ---------- đọc sheet ---------- */
// Các tab theo đúng thứ tự trong file (tab ngoài cùng bên trái đứng đầu), bỏ tab bị ẩn
function readAll(ss) {
  const tabs = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.isSheetHidden() || tabs.length >= MAX_TABS) return;
    tabs.push({ n: sh.getName(), rows: readRows(sh) });
  });
  return { tabs: tabs };
}

// Mỗi dòng: [assignee, status, id, miêu tả]. Dòng tiêu đề = dòng đầu tiên có cả "Assign…" và "Status".
function readRows(sh) {
  const v = sh.getDataRange().getDisplayValues();
  let h = -1, cA = -1, cS = -1, cD = -1, cI = -1;
  for (let r = 0; r < Math.min(v.length, 15) && h < 0; r++) {
    cA = cS = cD = cI = -1;
    v[r].forEach(function (x, c) {
      const t = String(x).toLowerCase().replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (cA < 0 && /assign/.test(t)) cA = c;
      else if (cS < 0 && /^(status|trạng thái)/.test(t)) cS = c;
      else if (cD < 0 && /(miêu tả|mô tả|description|tên task|task name)/.test(t)) cD = c;
      else if (cI < 0 && /(\bid\b|số thứ tự|stt)/.test(t)) cI = c;
    });
    if (cA >= 0 && cS >= 0) h = r;
  }
  if (h < 0) return null;
  const rows = [];
  let lastId = '';
  for (let r = h + 1; r < v.length; r++) {
    const id = cI >= 0 ? String(v[r][cI]).trim() : '';
    if (id) lastId = id;
    const a = String(v[r][cA]).trim();
    if (!a) continue;
    const d = cD >= 0 ? (String(v[r][cD]).split('\n').map(function (x) { return x.trim(); }).filter(String)[0] || '') : '';
    rows.push([a, String(v[r][cS]).trim(), id || lastId, d.slice(0, 90)]);
  }
  return rows;
}

// Firestore giới hạn 1MB / tài liệu → bớt tab cuối nếu quá lớn
function fitSize(data) {
  while (JSON.stringify(data).length > 900000 && data.tabs && data.tabs.length > 1) data.tabs.pop();
  return data;
}

/* ---------- gửi lên GlowBoard ---------- */
function fbAuth() {
  const cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  const tok = cache.get('idToken'), uid = props.getProperty('uid');
  if (tok && uid) return { idToken: tok, uid: uid };
  let res, j;
  const refresh = props.getProperty('refreshToken');
  if (refresh) {
    res = UrlFetchApp.fetch('https://securetoken.googleapis.com/v1/token?key=' + API_KEY, {
      method: 'post', payload: { grant_type: 'refresh_token', refresh_token: refresh }, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      j = JSON.parse(res.getContentText());
      props.setProperty('refreshToken', j.refresh_token); props.setProperty('uid', j.user_id);
      cache.put('idToken', j.id_token, 3000);
      return { idToken: j.id_token, uid: j.user_id };
    }
  }
  res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ returnSecureToken: true }) });
  j = JSON.parse(res.getContentText());
  props.setProperty('refreshToken', j.refreshToken); props.setProperty('uid', j.localId);
  props.deleteProperty('memberCode');
  cache.put('idToken', j.idToken, 3000);
  return { idToken: j.idToken, uid: j.localId };
}

function docUrl(path) {
  return 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + path;
}
function ensureMember(auth, props) {
  if (props.getProperty('memberCode') === TEAM_CODE + '|' + auth.uid) return;
  const body = { fields: {
    name: { stringValue: BOT_NAME }, code: { stringValue: TEAM_CODE },
    joinedAt: { timestampValue: new Date().toISOString() } } };
  const res = UrlFetchApp.fetch(docUrl('teams/' + TEAM_ID + '/members/' + auth.uid), {
    method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + auth.idToken },
    payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Không vào được team (mã team đã đổi hoặc team bị khóa?): ' + res.getContentText());
  props.setProperty('memberCode', TEAM_CODE + '|' + auth.uid);
}
function fsSet(auth, docId, data) {
  const body = { fields: { json: { stringValue: JSON.stringify(data) } } };
  const res = UrlFetchApp.fetch(docUrl('teams/' + TEAM_ID + '/items/' + docId), {
    method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + auth.idToken },
    payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    PropertiesService.getScriptProperties().deleteProperty('memberCode');
    throw new Error('Gửi dữ liệu lỗi ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}
function fsDelete(auth, docId) {
  UrlFetchApp.fetch(docUrl('teams/' + TEAM_ID + '/items/' + docId), {
    method: 'delete', headers: { Authorization: 'Bearer ' + auth.idToken }, muteHttpExceptions: true });
}
