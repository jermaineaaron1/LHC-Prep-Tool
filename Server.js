/** ============================================================
    LHC Worship Prep — SERVER.GS  (Stable Build)
    Spreadsheet ID fixed per your project.
===============================================================*/

const CONFIG = {
  SPREADSHEET_ID: "13xnjS92van4qY39CObWOuC7ccqUcxNLWgaT4QZgC7Tw",

  // Sheet names
  SHEET_SONGS: "Songs",
  SHEET_ROSTER_PREFIX: "Roster ",   // e.g. “Roster 2025”
  
  // Songs sheet fixed columns (MUST match your sheet headers)
  SONG_COLS: [
    "ID",
    "Title",
    "Artist",
    "Category",
    "Key",
    "Tempo",
    "Theme",
    "Season",
    "Style",
    "Lyrics",
    "DocLinks",
    "YouTube",
    "UpdatedAt"
  ],

  // Roster duty rows MUST match Column A labels in each Roster sheet
  ROSTER_ROWS: [
    "Date",
    "Liturgical Day",
    "Preacher",
    "Worship Leader / Liturgist",
    "1st Reading",
    "Psalm Reading",
    "2nd Reading",
    "Gospel Reading",
    "Bible Reader 1",
    "Bible Reader 2",
    "Usher 1",
    "Usher 2",
    "Communion Assistance 1",
    "Communion Assistance 2",
    "Communion Assistance 3",
    "Altar Guild 1",
    "Altar Guild 2",
    "Pianist",
    "Guitarist",
    "Bassist",
    "Drummer",
    "Other Instrument",
    "Singer 1",
    "Singer 2",
    "Singer 3",
    "Singer 4",
    "LCD (Visual)",
    "Live Streaming",
    "PA (Audio)"
  ]
};

/** ============================================================
    Internal helpers
===============================================================*/

function _ss() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function _sheet(name) {
  const ss = _ss();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function _uuid(prefix) {
  return (prefix || "ID") + "-" + Utilities.getUuid().substring(0, 8);
}

function _now() {
  return new Date().toISOString();
}

/** ============================================================
    META — for “Connected to:” in sidebar
===============================================================*/

function getAppMeta() {
  const ss = _ss();
  return {
    spreadsheetName: ss.getName(),
    songsSheetName: CONFIG.SHEET_SONGS
  };
}

/** ============================================================
    SONGS API
===============================================================*/

function getSongs() {
  const sh = _sheet(CONFIG.SHEET_SONGS);
  const header = CONFIG.SONG_COLS;
  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    // No songs yet
    return [];
  }

  const range = sh.getRange(2, 1, lastRow - 1, header.length);
  const values = range.getValues();
  const out = [];

  values.forEach(row => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = row[i] || "";
    });
    out.push(obj);
  });

  return out;
}

function saveSong(data) {
  const sh = _sheet(CONFIG.SHEET_SONGS);
  const header = CONFIG.SONG_COLS;

  // Ensure ID and UpdatedAt
  let id = data.ID || _uuid("S");
  data.ID = id;
  data.UpdatedAt = _now();

  // Normalise row array
  const rowArr = header.map(h => (data[h] || "").toString().trim());

  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    // Try to find existing ID
    const existingRange = sh.getRange(2, 1, lastRow - 1, header.length);
    const existingValues = existingRange.getValues();
    for (let i = 0; i < existingValues.length; i++) {
      if (existingValues[i][0] === id) {
        // Update row
        sh.getRange(i + 2, 1, 1, header.length).setValues([rowArr]);
        return { ok: true, id: id, updated: true };
      }
    }
  }

  // Append as new row
  sh.appendRow(rowArr);
  return { ok: true, id: id, updated: false };
}

function cleanSongsSheet() {
  const sh = _sheet(CONFIG.SHEET_SONGS);
  const header = CONFIG.SONG_COLS;
  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    return { ok: true, msg: "No data rows to clean." };
  }

  const range = sh.getRange(2, 1, lastRow - 1, header.length);
  const values = range.getValues();

  values.forEach(row => {
    for (let c = 0; c < header.length; c++) {
      if (row[c] == null) row[c] = "";
      row[c] = String(row[c]).trim();
    }
    if (!row[0]) row[0] = _uuid("S"); // ensure ID
    row[header.length - 1] = _now();  // set UpdatedAt
  });

  range.setValues(values);
  return { ok: true };
}

/** ============================================================
    ROSTER API
===============================================================*/

function getRosterYear(param) {
  const year = String(param && param.year ? param.year : "");
  if (!/^\d{4}$/.test(year)) {
    throw new Error("Invalid year for getRosterYear: " + year);
  }

  const sheetName = CONFIG.SHEET_ROSTER_PREFIX + year;
  const sh = _sheet(sheetName);
  const rows = CONFIG.ROSTER_ROWS;

  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();

  // If sheet is empty or only has Column A and maybe no dates
  if (lastCol < 2 || lastRow < 1) {
    return {
      year: year,
      dates: [],
      rows: rows,
      grid: {}
    };
  }

  // Row 1: dates from col B onwards
  const dateRowValues = sh.getRange(1, 2, 1, lastCol - 1).getValues()[0];
  const dates = dateRowValues.map(d => String(d || "").trim());

  const grid = {};

  if (dates.length > 0) {
    // Duty assignments start at row 2 in sheet
    // We read as many rows as we have in CONFIG, but excess will be safe
    const dataRange = sh.getRange(
      2,
      2,
      Math.max(rows.length - 1, 1),   // at least 1
      lastCol - 1
    );
    const values = dataRange.getValues();

    rows.forEach((role, rIdx) => {
      if (rIdx === 0) return; // row 0 is "Date" label in col A

      const rowIndexInRange = rIdx - 1;
      if (!values[rowIndexInRange]) return; // sheet may not have that many rows yet

      dates.forEach((date, cIdx) => {
        if (!date) return;
        const cellVal = values[rowIndexInRange][cIdx];
        grid[role + "|" + date] = cellVal || "";
      });
    });
  }

  return {
    year: year,
    dates: dates,
    rows: rows,
    grid: grid
  };
}

function saveRosterCell(param) {
  const year  = String(param.year);
  const date  = String(param.dateISO);
  const role  = String(param.duty);
  const value = param.value || "";

  if (!/^\d{4}$/.test(year)) {
    throw new Error("Invalid year for saveRosterCell: " + year);
  }

  const sh = _sheet(CONFIG.SHEET_ROSTER_PREFIX + year);
  const rows = CONFIG.ROSTER_ROWS;

  // Find row index by duty label
  const rowIdx = rows.indexOf(role);
  if (rowIdx < 0) {
    throw new Error("Duty/role not found in CONFIG.ROSTER_ROWS: " + role);
  }

  const lastCol = sh.getLastColumn();
  if (lastCol < 2) {
    throw new Error("Roster sheet has no date columns yet.");
  }

  const dateRowValues = sh.getRange(1, 2, 1, lastCol - 1).getValues()[0];

  let colIdx = -1;
  for (let i = 0; i < dateRowValues.length; i++) {
    if (String(dateRowValues[i]).trim() === date) {
      colIdx = i + 2; // sheet column index
      break;
    }
  }

  if (colIdx === -1) {
    throw new Error("Date not found in roster sheet: " + date);
  }

  // rowIdx is index in CONFIG.ROSTER_ROWS (0-based), sheet row = rowIdx + 1
  const targetRow = rowIdx + 1;
  const cell = sh.getRange(targetRow, colIdx);
  cell.setValue(value);

  // For now, no approval workflow; always approved=true
  return { ok: true, approved: true };
}

/** ============================================================
    PUBLIC doGet()
===============================================================*/

function doGet(e) {
  // IMPORTANT:
  // If your HTML file in Apps Script is named "Index" (capital I),
  // change "index" below to "Index".
  return HtmlService
    .createHtmlOutputFromFile("Index")
    .setTitle("LHC Worship Prep")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
