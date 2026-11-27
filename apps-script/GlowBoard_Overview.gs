/**
 * GlowBoard Overview – Created by Mondiro
 * Đọc các file Google Sheet trong 1 folder Drive, trả về cột Assignee / Status / Miêu tả
 * để GlowBoard hiện bảng Overview. Deploy: Web app · Execute as: Me · Who has access: Anyone.
 */
const FOLDER_ID = '1qU8jVJETb_pg5C2hocS3Hd2s4_jNf0ZG';

function doGet(e) {
  const p = (e && e.parameter) || {};
  let out;
  try {
    if (p.file) {
      out = { ok: true, file: readFile(SpreadsheetApp.openById(p.file), p.tab) };
    } else {
      let tabs = {};
      try { tabs = JSON.parse(p.tabs || '{}') || {}; } catch (err) {}
      out = { ok: true, folder: DriveApp.getFolderById(FOLDER_ID).getName(), files: listFiles(tabs) };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function listFiles(tabs) {
  const it = DriveApp.getFolderById(FOLDER_ID).getFilesByType(MimeType.GOOGLE_SHEETS);
  const files = [];
  while (it.hasNext()) {
    const f = it.next();
    try { files.push(readFile(SpreadsheetApp.open(f), tabs[f.getId()])); }
    catch (err) { files.push({ id: f.getId(), name: f.getName(), error: String((err && err.message) || err) }); }
  }
  files.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return files;
}

// Tab mặc định = tab ngoài cùng bên trái
function readFile(ss, tabName) {
  const sheets = ss.getSheets();
  const sh = (tabName && ss.getSheetByName(tabName)) || sheets[0];
  return {
    id: ss.getId(), name: ss.getName(), url: ss.getUrl(),
    tabs: sheets.map(function (s) { return s.getName(); }),
    tab: sh.getName(), rows: readRows(sh)
  };
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
    rows.push([a, String(v[r][cS]).trim(), id || lastId, cD >= 0 ? String(v[r][cD]).trim().slice(0, 160) : '']);
  }
  return rows;
}
