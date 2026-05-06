// ================================================================
// LHC WORSHIP PREP - Server.gs (v2.8 COMPLETE)
// Updated to match index_v2.8_FINAL.html
// All functions from original + new v2.8 features
// ================================================================

// ================================================================
// RUN THIS FUNCTION FIRST TO AUTHORIZE DRIVE API
// In the editor: Select this function and click "Run"
// ================================================================
function authorizeDriveAPI() {
  // This triggers authorization for all required services
  Logger.log('Authorizing Drive API...');

  // Test DriveApp
  var files = DriveApp.getFiles();
  Logger.log('DriveApp authorized: ' + (files ? 'Yes' : 'No'));

  // Test Advanced Drive Service
  try {
    var about = Drive.About.get();
    Logger.log('Drive Advanced Service authorized: Yes');
    Logger.log('User: ' + about.user.displayName);
  } catch (e) {
    Logger.log('Drive Advanced Service error: ' + e.toString());
  }

  // Test DocumentApp
  try {
    var doc = DocumentApp.create('_temp_auth_test_');
    var docId = doc.getId();
    DriveApp.getFileById(docId).setTrashed(true);
    Logger.log('DocumentApp authorized: Yes');
  } catch (e) {
    Logger.log('DocumentApp error: ' + e.toString());
  }

  Logger.log('Authorization complete! You can now use Smart Import.');
  return 'Authorization complete!';
}

// Test file upload to Drive — run this from the editor to verify permissions
function testDriveUpload() {
  try {
    var folder = getDriveFolder_('drive_folder_documents', 'Documents');
    Logger.log('Target folder: ' + folder.getName() + ' (id: ' + folder.getId() + ')');

    var blob = Utilities.newBlob('Test upload content', 'text/plain', '_test_upload_.txt');
    var file = folder.createFile(blob);
    Logger.log('File created: ' + file.getName() + ' (id: ' + file.getId() + ')');

    // Clean up
    file.setTrashed(true);
    Logger.log('Test upload successful! Drive file upload is working.');
    return 'Upload test passed!';
  } catch (e) {
    Logger.log('Test upload FAILED: ' + e.toString());
    return 'Upload test FAILED: ' + e.toString();
  }
}

var CONFIG = {
  SPREADSHEET_ID: '13xnjS92van4qY39CObWOuC7ccqUcxNLWgaT4QZgC7Tw',
  SONGS_SHEET: 'Songs',
  ORDERS_SHEET: 'Orders',
  ORDER_SONGS_SHEET: 'OrderSongs',           // v2.9: Song references with customizations
  ORDER_ITEMS_SHEET: 'OrderItems',           // v3.0: All order items (songs, liturgy, content)
  ORDER_CHANGES_SHEET: 'OrderChanges',       // v2.9: Sync/collaboration tracking
  ROSTER_SHEET: 'Roster',
  ROSTER_NAMES_SHEET: 'RosterNames',
  ROSTER_CHANGES_SHEET: 'RosterChanges',
  ROSTER_HISTORY_SHEET: 'RosterHistory',
  MESSAGES_SHEET: 'Messages',
  ANNOUNCEMENTS_SHEET: 'Announcements',
  SETTINGS_SHEET: 'Settings',
  BACKGROUNDS_SHEET: 'Backgrounds',
  BG_DRIVE_FOLDER: 'LHC-Worship-Backgrounds',
  DRIVE_ROOT_FOLDER: 'LHC Worship Files'
};

// Service sections for worship order
var SERVICE_SECTIONS = [
  { id: 'preparation', label: 'Song of Preparation' },
  { id: 'response', label: 'Song of Response' },
  { id: 'offering', label: 'Offertory Song' },
  { id: 'communion', label: 'Communion Song' },
  { id: 'thanksgiving', label: 'Song of Thanksgiving' },
  { id: 'dismissal', label: 'Dismissal/Sending Song' },
  { id: 'other', label: 'Other' }
];

// Get the spreadsheet (works for standalone scripts)
function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

// ================================================================
// SERVE WEB APP
// ================================================================
function doGet(e) {
  // Serve dedicated projection screen when ?mode=proj is present
  if (e && e.parameter && e.parameter.mode === 'proj') {
    return HtmlService.createHtmlOutputFromFile('ProjectionScreen')
      .setTitle('LHC Worship – Projection')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Serve presenter remote when ?mode=remote is present
  if (e && e.parameter && e.parameter.mode === 'remote') {
    return HtmlService.createHtmlOutputFromFile('SermonRemote')
      .setTitle('LHC Worship – Presenter Remote')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  }

  // ── Website proxy: fetch external URL server-side, strip X-Frame-Options ──
  // Frontend embeds: {webAppUrl}?proxy=encodeURIComponent(targetUrl)
  if (e && e.parameter && e.parameter.proxy) {
    return handleWebProxy_(e.parameter.proxy);
  }

  var template = HtmlService.createTemplateFromFile('Index');
  // Pass deep-link parameters for media sharing
  template.mediaUrl = (e && e.parameter && e.parameter.media) ? e.parameter.media : '';
  template.songHint = (e && e.parameter && e.parameter.song) ? e.parameter.song : '';
  // Pass deep-link parameters for order sharing
  template.deepLinkOrder = (e && e.parameter && e.parameter.order) ? e.parameter.order : '';
  template.deepLinkView  = (e && e.parameter && e.parameter.view)  ? e.parameter.view  : '';
  // Pass deep-link for date-based order open/create (from roster WhatsApp share)
  template.deepLinkDate  = (e && e.parameter && e.parameter.date)  ? e.parameter.date  : '';
  template.deepLinkDname = (e && e.parameter && e.parameter.dname) ? e.parameter.dname : '';
  // Pass deep-link parameter for playlist player
  template.deepLinkPlaylist = (e && e.parameter && e.parameter.playlist) ? e.parameter.playlist : '';
  // Pass deep-link parameter for songbook sharing (?sb=sb-ID or ?sb=order-ID)
  template.deepLinkSongbook = (e && e.parameter && e.parameter.sb) ? e.parameter.sb : '';
  // Pass share-inbox params (Web Share Target via PWA shell)
  template.shareInboxUrl   = (e && e.parameter && e.parameter.shareInbox)   ? e.parameter.shareInbox   : '';
  template.shareInboxTitle = (e && e.parameter && e.parameter.shareTitle)   ? e.parameter.shareTitle   : '';
  template.shareInboxText  = (e && e.parameter && e.parameter.shareText)    ? e.parameter.shareText    : '';
  // Pass the webapp URL for sharing links
  template.webAppUrl = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('LHC Worship Prep')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ================================================================
// GET SONGS (with statistics fields + MULTIPLE attachments support)
// ================================================================
function getSongs() {
  var sheet = getSheet_(CONFIG.SONGS_SHEET);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var idx = buildHeaderIndex_(header);

  // Core columns
  var colId = findColumn_(idx, ['id', 'song id', 'song_id']);
  var colTitle = findColumn_(idx, ['title', 'song title', 'name']);
  var colArtist = findColumn_(idx, ['artist', 'composer']);
  var colTheme = findColumn_(idx, ['themes', 'theme']);
  var colKey = findColumn_(idx, ['keys', 'key']);
  var colTempo = findColumn_(idx, ['mood', 'tempo', 'bpm', 'feel']);
  var colStyle = findColumn_(idx, ['style', 'category', 'genre']);
  var colSeason = findColumn_(idx, ['seasons', 'season']);
  
  // NEW v2.8: Support for multiple attachments
  var colAttachments = findColumn_(idx, ['attachments', 'doclinks', 'doc links', 'docurl', 'documents']);
  var colYouTubeUrls = findColumn_(idx, ['youtubeurls', 'youtube urls', 'youtubelinks', 'youtube links']);
  
  // Legacy single attachment columns (for backwards compatibility)
  var colDocs = findColumn_(idx, ['lyricsurl', 'lyrics url', 'lead sheet', 'doc']);
  var colYouTube = findColumn_(idx, ['youtube', 'youtube url', 'youtubeurl']);
  
  var colLyrics = findColumn_(idx, ['lyrics', 'lyrics & chords', 'lyrics and chords']);
  var colScripture = findColumn_(idx, ['scripture', 'scripture reference', 'scripturereference', 'bible reference']);

  // Statistics columns
  var colUseCount = findColumn_(idx, ['usecount', 'use count', 'use_count', 'times used', 'timesused']);
  var colLastUsed = findColumn_(idx, ['lastused', 'last used', 'last_used', 'lastusedate']);
  var colDateAdded = findColumn_(idx, ['dateadded', 'date added', 'date_added', 'created', 'createdate']);
  var colLastEdited = findColumn_(idx, ['lastedited', 'last edited', 'last_edited', 'modified', 'lastmodified']);

  var songs = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var title = colTitle >= 0 ? asString_(row[colTitle]) : '';
    if (!title) continue;

    // Parse multiple attachments (v2.8 format: JSON array)
    var attachments = [];
    if (colAttachments >= 0 && row[colAttachments]) {
      try {
        attachments = JSON.parse(row[colAttachments]);
      } catch (e) {
        // If not JSON, treat as single URL string
        var url = asString_(row[colAttachments]);
        if (url) attachments = [{ url: url, name: 'Document', type: 'GDOC' }];
      }
    } else if (colDocs >= 0 && row[colDocs]) {
      // Fallback to legacy single doc column
      var url = asString_(row[colDocs]);
      if (url) attachments = [{ url: url, name: 'Document', type: 'GDOC' }];
    }
    
    // Parse multiple YouTube URLs (v2.8 format: JSON array)
    var youtubeUrls = [];
    if (colYouTubeUrls >= 0 && row[colYouTubeUrls]) {
      try {
        youtubeUrls = JSON.parse(row[colYouTubeUrls]);
      } catch (e) {
        // If not JSON, treat as single URL
        var url = asString_(row[colYouTubeUrls]);
        if (url) youtubeUrls = [url];
      }
    } else if (colYouTube >= 0 && row[colYouTube]) {
      // Fallback to legacy single YouTube column (may contain JSON array or plain URL)
      var rawYt = asString_(row[colYouTube]);
      if (rawYt) {
        try {
          var parsed = JSON.parse(rawYt);
          youtubeUrls = Array.isArray(parsed) ? parsed : [rawYt];
        } catch (e2) {
          youtubeUrls = [rawYt];
        }
      }
    }

    songs.push({
      id: colId >= 0 ? asString_(row[colId]) : 'row_' + r,
      title: title,
      artist: colArtist >= 0 ? asString_(row[colArtist]) : '',
      theme: colTheme >= 0 ? asString_(row[colTheme]) : '',
      key: colKey >= 0 ? asString_(row[colKey]) : '',
      tempo: colTempo >= 0 ? asString_(row[colTempo]) : '',
      style: colStyle >= 0 ? asString_(row[colStyle]) : '',
      season: colSeason >= 0 ? asString_(row[colSeason]) : '',
      
      // v2.8: Multiple attachments support
      attachments: attachments,
      youtube: youtubeUrls, // Array of YouTube URLs
      
      // Legacy fields (for backwards compatibility)
      lyricsUrl: attachments.length > 0 ? attachments[0].url : '',
      
      lyrics: colLyrics >= 0 ? asString_(row[colLyrics]) : '',
      scripture: colScripture >= 0 ? asString_(row[colScripture]) : '',

      // Statistics fields
      useCount: colUseCount >= 0 ? parseInt(row[colUseCount]) || 0 : 0,
      lastUsed: colLastUsed >= 0 ? formatDate_(row[colLastUsed]) : '',
      dateAdded: colDateAdded >= 0 ? formatDate_(row[colDateAdded]) : '',
      lastEdited: colLastEdited >= 0 ? formatDate_(row[colLastEdited]) : ''
    });
  }

  return songs;
}

// ================================================================
// CREATE SONG (v2.8 with multiple attachments)
// ================================================================
function createSong(song) {
  if (!song || !song.title) throw new Error('Song title is required');

  var sheet = getSheet_(CONFIG.SONGS_SHEET);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id', 'song id', 'song_id']);
  var colTitle = findColumn_(idx, ['title', 'song title', 'name']);
  var colArtist = findColumn_(idx, ['artist', 'composer']);
  var colTheme = findColumn_(idx, ['themes', 'theme']);
  var colKey = findColumn_(idx, ['keys', 'key']);
  var colTempo = findColumn_(idx, ['mood', 'tempo', 'bpm', 'feel']);
  var colStyle = findColumn_(idx, ['style', 'category', 'genre']);
  var colSeason = findColumn_(idx, ['seasons', 'season']);
  
  // v2.8: Multiple attachments columns
  var colAttachments = findColumn_(idx, ['attachments', 'doclinks', 'doc links']);
  var colYouTubeUrls = findColumn_(idx, ['youtubeurls', 'youtube urls', 'youtubelinks']);
  var colYouTube = findColumn_(idx, ['youtube', 'youtube url', 'youtubeurl']);

  var colLyrics = findColumn_(idx, ['lyrics', 'lyrics & chords', 'lyrics and chords']);
  var colScripture = findColumn_(idx, ['scripture', 'scripture reference', 'scripturereference', 'bible reference']);
  var colDateAdded = findColumn_(idx, ['dateadded', 'date added', 'date_added', 'created']);
  var colUseCount = findColumn_(idx, ['usecount', 'use count', 'use_count']);

  var newId = 'song_' + new Date().getTime();
  var newRow = [];
  for (var i = 0; i < header.length; i++) newRow.push('');

  if (colId >= 0) newRow[colId] = newId;
  if (colTitle >= 0) newRow[colTitle] = song.title || '';
  if (colArtist >= 0) newRow[colArtist] = song.artist || '';
  if (colTheme >= 0) newRow[colTheme] = song.theme || '';
  if (colKey >= 0) newRow[colKey] = song.key || '';
  if (colTempo >= 0) newRow[colTempo] = song.tempo || '';
  if (colStyle >= 0) newRow[colStyle] = song.category || song.style || '';
  if (colSeason >= 0) newRow[colSeason] = song.season || '';
  
  // v2.8: Save attachments as JSON array
  if (colAttachments >= 0) {
    var attachments = song.attachments || [];
    newRow[colAttachments] = JSON.stringify(attachments);
  }
  
  // v2.8: Save YouTube URLs as JSON array (with legacy column fallback)
  var ytCol = colYouTubeUrls >= 0 ? colYouTubeUrls : colYouTube;
  if (ytCol >= 0) {
    var youtubeUrls = song.youtube || [];
    newRow[ytCol] = JSON.stringify(youtubeUrls);
  }
  
  if (colLyrics >= 0) newRow[colLyrics] = song.lyrics || '';
  if (colScripture >= 0) newRow[colScripture] = song.scripture || '';
  if (colDateAdded >= 0) newRow[colDateAdded] = new Date();
  if (colUseCount >= 0) newRow[colUseCount] = 0;

  sheet.appendRow(newRow);

  return { success: true, id: newId };
}

// ================================================================
// UPDATE SONG (v2.8 with multiple attachments)
// ================================================================
function updateSong(song) {
  if (!song || !song.id) throw new Error('Song ID is required');

  var sheet = getSheet_(CONFIG.SONGS_SHEET);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id', 'song id', 'song_id']);
  var colTitle = findColumn_(idx, ['title', 'song title', 'name']);
  var colArtist = findColumn_(idx, ['artist', 'composer']);
  var colTheme = findColumn_(idx, ['themes', 'theme']);
  var colKey = findColumn_(idx, ['keys', 'key']);
  var colTempo = findColumn_(idx, ['mood', 'tempo', 'bpm', 'feel']);
  var colStyle = findColumn_(idx, ['style', 'category', 'genre']);
  var colSeason = findColumn_(idx, ['seasons', 'season']);
  
  // v2.8: Multiple attachments
  var colAttachments = findColumn_(idx, ['attachments', 'doclinks', 'doc links']);
  var colYouTubeUrls = findColumn_(idx, ['youtubeurls', 'youtube urls', 'youtubelinks']);
  var colYouTube = findColumn_(idx, ['youtube', 'youtube url', 'youtubeurl']);

  var colLyrics = findColumn_(idx, ['lyrics', 'lyrics & chords', 'lyrics and chords']);
  var colScripture = findColumn_(idx, ['scripture', 'scripture reference', 'scripturereference', 'bible reference']);
  var colLastEdited = findColumn_(idx, ['lastedited', 'last edited', 'last_edited', 'modified', 'lastmodified']);

  if (colId < 0) throw new Error('ID column not found in sheet');

  // Find the row
  var rowIndex = -1;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colId]).trim() === String(song.id).trim()) {
      rowIndex = r + 1;
      break;
    }
  }
  
  if (rowIndex < 0) throw new Error('Song not found: ' + song.id);

  // Update fields
  if (colTitle >= 0 && song.title !== undefined) 
    sheet.getRange(rowIndex, colTitle + 1).setValue(song.title || '');
  if (colArtist >= 0 && song.artist !== undefined) 
    sheet.getRange(rowIndex, colArtist + 1).setValue(song.artist || '');
  if (colTheme >= 0 && song.theme !== undefined) 
    sheet.getRange(rowIndex, colTheme + 1).setValue(song.theme || '');
  if (colKey >= 0 && song.key !== undefined) 
    sheet.getRange(rowIndex, colKey + 1).setValue(song.key || '');
  if (colTempo >= 0 && song.tempo !== undefined) 
    sheet.getRange(rowIndex, colTempo + 1).setValue(song.tempo || '');
  if (colStyle >= 0 && (song.category !== undefined || song.style !== undefined)) 
    sheet.getRange(rowIndex, colStyle + 1).setValue(song.category || song.style || '');
  if (colSeason >= 0 && song.season !== undefined) 
    sheet.getRange(rowIndex, colSeason + 1).setValue(song.season || '');
  
  // v2.8: Update attachments array
  if (colAttachments >= 0 && song.attachments !== undefined) {
    sheet.getRange(rowIndex, colAttachments + 1).setValue(JSON.stringify(song.attachments));
  }
  
  // v2.8: Update YouTube URLs array (with legacy column fallback)
  if (song.youtube !== undefined) {
    if (colYouTubeUrls >= 0) {
      sheet.getRange(rowIndex, colYouTubeUrls + 1).setValue(JSON.stringify(song.youtube));
    } else if (colYouTube >= 0) {
      sheet.getRange(rowIndex, colYouTube + 1).setValue(JSON.stringify(song.youtube));
    }
  }
  
  if (colLyrics >= 0 && song.lyrics !== undefined)
    sheet.getRange(rowIndex, colLyrics + 1).setValue(song.lyrics || '');
  if (colScripture >= 0 && song.scripture !== undefined)
    sheet.getRange(rowIndex, colScripture + 1).setValue(song.scripture || '');

  // Update timestamp
  if (colLastEdited >= 0) 
    sheet.getRange(rowIndex, colLastEdited + 1).setValue(new Date());

  return { success: true, id: song.id };
}

// ================================================================
// DELETE SONG
// ================================================================
function deleteSong(songId) {
  if (!songId) throw new Error('Song ID is required');

  var sheet = getSheet_(CONFIG.SONGS_SHEET);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id', 'song id', 'song_id']);
  if (colId < 0) throw new Error('ID column not found in sheet');

  var rowIndex = -1;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colId]).trim() === String(songId).trim()) {
      rowIndex = r + 1;
      break;
    }
  }
  
  if (rowIndex < 0) throw new Error('Song not found: ' + songId);

  sheet.deleteRow(rowIndex);

  return { success: true, deletedId: songId };
}

// ================================================================
// UPDATE SONG LYRICS
// ================================================================
function updateSongLyrics(songId, lyrics) {
  if (!songId) throw new Error('Song ID is required');

  var sheet = getSheet_(CONFIG.SONGS_SHEET);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id', 'song id', 'song_id']);
  var colLyrics = findColumn_(idx, ['lyrics', 'lyrics & chords', 'lyrics and chords']);
  var colLastEdited = findColumn_(idx, ['lastedited', 'last edited', 'last_edited', 'modified', 'lastmodified']);

  if (colId < 0) throw new Error('ID column not found');
  if (colLyrics < 0) throw new Error('Lyrics column not found');

  var rowIndex = -1;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colId]).trim() === String(songId).trim()) {
      rowIndex = r + 1;
      break;
    }
  }
  
  if (rowIndex < 0) throw new Error('Song not found: ' + songId);

  sheet.getRange(rowIndex, colLyrics + 1).setValue(lyrics || '');
  
  if (colLastEdited >= 0) 
    sheet.getRange(rowIndex, colLastEdited + 1).setValue(new Date());

  return { success: true };
}

// ================================================================
// INCREMENT USE COUNT
// ================================================================
function incrementSongUseCount(songId) {
  if (!songId) return { success: false, error: 'Song ID is required' };

  var sheet = getSheet_(CONFIG.SONGS_SHEET);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id', 'song id', 'song_id']);
  var colUseCount = findColumn_(idx, ['usecount', 'use count', 'use_count', 'times used', 'timesused']);
  var colLastUsed = findColumn_(idx, ['lastused', 'last used', 'last_used', 'lastusedate']);

  if (colId < 0) return { success: false, error: 'ID column not found' };

  var rowIndex = -1;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colId]).trim() === String(songId).trim()) {
      rowIndex = r + 1;
      break;
    }
  }
  
  if (rowIndex < 0) return { success: false, error: 'Song not found' };

  if (colUseCount >= 0) {
    var currentCount = parseInt(data[rowIndex - 1][colUseCount]) || 0;
    sheet.getRange(rowIndex, colUseCount + 1).setValue(currentCount + 1);
  }
  
  if (colLastUsed >= 0) {
    sheet.getRange(rowIndex, colLastUsed + 1).setValue(new Date());
  }

  return { success: true };
}

// ================================================================
// GET ORDERS
// ================================================================
function getOrders() {
  var sheet;
  try {
    sheet = getSheet_(CONFIG.ORDERS_SHEET);
  } catch (e) {
    return [];
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id', 'order id', 'order_id']);
  var colTitle = findColumn_(idx, ['title', 'order title', 'name']);
  var colDate = findColumn_(idx, ['date', 'service date', 'servicedate']);

  var orders = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var title = colTitle >= 0 ? asString_(row[colTitle]) : '';
    if (!title) continue;
    
    orders.push({
      id: colId >= 0 ? asString_(row[colId]) : 'order_' + r,
      title: title,
      serviceDate: colDate >= 0 ? asString_(row[colDate]) : ''
    });
  }

  return orders;
}

// ================================================================
// LOAD ORDER
// ================================================================
function loadOrder(orderId) {
  var orders = getOrders();
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].id === orderId) return orders[i];
  }
  return null;
}

// ================================================================
// SAVE ORDER
// ================================================================
function saveOrder(payload) {
  // TODO: Implement full order saving
  return { success: true, id: payload.id || 'new_order' };
}

// ================================================================
// DELETE ORDER - Works with legacy JSON format
// ================================================================
function deleteOrder(orderId) {
  if (!orderId) return { success: false, error: 'Order ID required' };

  try {
    var ordersSheet = getSheet_(CONFIG.ORDERS_SHEET);
    var ordersData = ordersSheet.getDataRange().getValues();
    var ordersHeader = ordersData[0];
    var ordersIdx = buildHeaderIndex_(ordersHeader);

    // Check for legacy JSON column vs new ID column
    var colJson = findColumn_(ordersIdx, ['json', 'data', 'orderdata']);
    var colId = findColumn_(ordersIdx, ['id', 'orderid']);

    var rowToDelete = -1;

    for (var r = ordersData.length - 1; r >= 1; r--) {
      var row = ordersData[r];
      var matchFound = false;

      // Try matching by ID column (new format)
      if (colId >= 0 && String(row[colId] || '').trim() === String(orderId).trim()) {
        matchFound = true;
      }

      // Try matching by ID inside JSON column (legacy format)
      if (!matchFound && colJson >= 0 && row[colJson]) {
        try {
          var jsonData = row[colJson];
          if (typeof jsonData === 'string' && jsonData.trim().startsWith('{')) {
            jsonData = JSON.parse(jsonData);
          }
          if (jsonData && (jsonData.id === orderId || jsonData.createdDate === orderId)) {
            matchFound = true;
          }
        } catch (e) {
          // JSON parse failed, continue
        }
      }

      if (matchFound) {
        rowToDelete = r + 1; // Sheet rows are 1-indexed
        break;
      }
    }

    if (rowToDelete > 0) {
      ordersSheet.deleteRow(rowToDelete);
      Logger.log('Deleted order row ' + rowToDelete + ' for orderId: ' + orderId);
    } else {
      Logger.log('Order not found for deletion: ' + orderId);
      return { success: false, error: 'Order not found' };
    }

    // Also try to delete from OrderSongs/OrderItems sheets if they exist
    try {
      var songsSheet = getSheet_(CONFIG.ORDER_SONGS_SHEET);
      var songsData = songsSheet.getDataRange().getValues();
      var songsHeader = songsData[0];
      var songsIdx = buildHeaderIndex_(songsHeader);
      var colOrderId = findColumn_(songsIdx, ['orderid', 'order_id']);

      for (var sr = songsData.length - 1; sr >= 1; sr--) {
        if (colOrderId >= 0 && String(songsData[sr][colOrderId]).trim() === String(orderId).trim()) {
          songsSheet.deleteRow(sr + 1);
        }
      }
    } catch (e) {
      // OrderSongs sheet may not exist, that's OK
    }

    return { success: true };
  } catch (e) {
    Logger.log('Delete order error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ================================================================
// UPDATE ORDER - Updates order in legacy JSON format
// ================================================================
function updateOrderInSheet(orderData) {
  if (!orderData) return { success: false, error: 'Order data required' };

  try {
    var ordersSheet = getSheet_(CONFIG.ORDERS_SHEET);
    var ordersData = ordersSheet.getDataRange().getValues();
    var ordersHeader = ordersData[0];
    var ordersIdx = buildHeaderIndex_(ordersHeader);

    var colId = findColumn_(ordersIdx, ['id', 'orderid']);
    var colJson = findColumn_(ordersIdx, ['json', 'data', 'orderdata']);
    var colDate = findColumn_(ordersIdx, ['date', 'servicedate']);
    var colUpdatedAt = findColumn_(ordersIdx, ['updatedat', 'updated_at', 'lastedited']);
    var colType = findColumn_(ordersIdx, ['type', 'ordertype']);

    // CRITICAL: Ensure Data column exists for storing items
    if (colJson < 0) {
      Logger.log('updateOrderInSheet - Data column missing, adding it now');
      // Add Data column after Id column (or at end if no Id)
      var insertPos = colId >= 0 ? colId + 2 : ordersHeader.length + 1;
      ordersSheet.insertColumnAfter(insertPos - 1);
      ordersSheet.getRange(1, insertPos).setValue('Data');

      // Refresh the data and indices
      ordersData = ordersSheet.getDataRange().getValues();
      ordersHeader = ordersData[0];
      ordersIdx = buildHeaderIndex_(ordersHeader);
      colJson = findColumn_(ordersIdx, ['json', 'data', 'orderdata']);

      // Also update other column indices that may have shifted
      colId = findColumn_(ordersIdx, ['id', 'orderid']);
      colDate = findColumn_(ordersIdx, ['date', 'servicedate']);
      colUpdatedAt = findColumn_(ordersIdx, ['updatedat', 'updated_at', 'lastedited']);
      colType = findColumn_(ordersIdx, ['type', 'ordertype']);

      Logger.log('updateOrderInSheet - Data column added at position ' + insertPos);
    }

    Logger.log('updateOrderInSheet - Headers: ' + JSON.stringify(ordersHeader));
    Logger.log('updateOrderInSheet - Column indices: Id=' + colId + ', Json=' + colJson + ', UpdatedAt=' + colUpdatedAt + ', Type=' + colType);
    Logger.log('updateOrderInSheet - Items to save: ' + (orderData.items ? orderData.items.length : 0));

    var rowToUpdate = -1;
    var timestamp = new Date();

    // Generate ID if not provided (new order)
    var orderId = orderData.id || orderData.createdDate || ('order_' + timestamp.getTime());
    Logger.log('updateOrderInSheet - Looking for orderId: ' + orderId);

    // Find the row to update
    for (var r = 1; r < ordersData.length; r++) {
      var row = ordersData[r];
      var matchFound = false;

      // First try matching by Id column (new format)
      if (colId >= 0 && row[colId]) {
        var rowId = String(row[colId]).trim();
        if (rowId === String(orderId).trim()) {
          matchFound = true;
          Logger.log('updateOrderInSheet - Found by Id column at row ' + r);
        }
      }

      // Then try matching by ID inside JSON column (legacy format)
      if (!matchFound && colJson >= 0 && row[colJson]) {
        try {
          var jsonData = row[colJson];
          if (typeof jsonData === 'string' && jsonData.trim().startsWith('{')) {
            jsonData = JSON.parse(jsonData);
          }
          if (jsonData && (jsonData.id === orderId || jsonData.createdDate === orderId)) {
            matchFound = true;
            Logger.log('updateOrderInSheet - Found by JSON id at row ' + r);
          }
        } catch (e) {
          // JSON parse failed
        }
      }

      if (matchFound) {
        rowToUpdate = r + 1;
        break;
      }
    }

    Logger.log('updateOrderInSheet - rowToUpdate: ' + rowToUpdate);

    // Prepare the complete order JSON with all content
    var orderJson = {
      id: orderId,
      title: orderData.title || 'Untitled Order',
      orderName: orderData.title || 'Untitled Order', // Legacy field
      type: orderData.type || 'traditional',
      serviceDate: orderData.serviceDate || '',
      template: orderData.template || {},
      createdDate: orderData.createdDate || orderData.id,
      lastEdited: timestamp.toISOString(),
      createdBy: orderData.createdBy || '',
      // Store all items (songs, liturgy, content boxes) with full customizations
      items: orderData.items || [],
      // Store section states
      sections: orderData.sections || {},
      // Store background settings
      backgrounds: orderData.backgrounds || {}
    };

    if (rowToUpdate > 0) {
      // Update existing row
      Logger.log('updateOrderInSheet - Updating existing row ' + rowToUpdate);
      if (colId >= 0) {
        ordersSheet.getRange(rowToUpdate, colId + 1).setValue(orderId);
      }
      if (colJson >= 0) {
        var jsonStr = JSON.stringify(orderJson);
        Logger.log('updateOrderInSheet - Writing JSON to column ' + (colJson + 1) + ', length: ' + jsonStr.length + ', items: ' + (orderJson.items ? orderJson.items.length : 0));
        ordersSheet.getRange(rowToUpdate, colJson + 1).setValue(jsonStr);
      } else {
        Logger.log('updateOrderInSheet - ERROR: colJson is ' + colJson + ', cannot write JSON!');
      }
      if (colUpdatedAt >= 0) {
        ordersSheet.getRange(rowToUpdate, colUpdatedAt + 1).setValue(timestamp);
      }
      if (colDate >= 0 && orderData.serviceDate) {
        ordersSheet.getRange(rowToUpdate, colDate + 1).setValue(orderData.serviceDate);
      }
      if (colType >= 0 && orderData.type) {
        ordersSheet.getRange(rowToUpdate, colType + 1).setValue(orderData.type);
      }

      Logger.log('updateOrderInSheet - Updated order in row ' + rowToUpdate);
    } else {
      // Insert new row (append)
      Logger.log('updateOrderInSheet - Creating new row, header length: ' + ordersHeader.length + ', colJson: ' + colJson);
      var newRow = [];
      for (var c = 0; c < ordersHeader.length; c++) {
        if (c === colId) {
          newRow.push(orderId);
        } else if (c === colDate) {
          newRow.push(orderData.serviceDate || '');
        } else if (c === colJson) {
          var jsonStr = JSON.stringify(orderJson);
          Logger.log('updateOrderInSheet - Adding JSON at position ' + c + ', length: ' + jsonStr.length + ', items: ' + (orderJson.items ? orderJson.items.length : 0));
          newRow.push(jsonStr);
        } else if (c === colUpdatedAt) {
          newRow.push(timestamp);
        } else if (c === colType) {
          newRow.push(orderData.type || 'traditional');
        } else {
          newRow.push('');
        }
      }
      Logger.log('updateOrderInSheet - New row has ' + newRow.length + ' columns');
      ordersSheet.appendRow(newRow);
      Logger.log('updateOrderInSheet - Created new order row with ID: ' + orderId);
    }

    return {
      success: true,
      id: orderId,
      lastEdited: timestamp.toISOString(),
      isNew: rowToUpdate <= 0
    };
  } catch (e) {
    Logger.log('Update order error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ================================================================
// RENAME ORDER - Updates only the title
// ================================================================
function renameOrder(orderId, newTitle) {
  if (!orderId || !newTitle) return { success: false, error: 'Order ID and new title required' };

  try {
    var ordersSheet = getSheet_(CONFIG.ORDERS_SHEET);
    var ordersData = ordersSheet.getDataRange().getValues();
    var ordersHeader = ordersData[0];
    var ordersIdx = buildHeaderIndex_(ordersHeader);

    var colId = findColumn_(ordersIdx, ['id', 'orderid']);
    var colJson = findColumn_(ordersIdx, ['json', 'data', 'orderdata']);
    var colUpdatedAt = findColumn_(ordersIdx, ['updatedat', 'updated_at', 'lastedited']);

    Logger.log('renameOrder - Looking for orderId: ' + orderId);
    Logger.log('renameOrder - Column indices: Id=' + colId + ', Json=' + colJson);

    for (var r = 1; r < ordersData.length; r++) {
      var row = ordersData[r];
      var matchFound = false;

      // First try matching by Id column (new format)
      if (colId >= 0 && row[colId]) {
        var rowId = String(row[colId]).trim();
        if (rowId === String(orderId).trim()) {
          matchFound = true;
          Logger.log('renameOrder - Found by Id column at row ' + r);
        }
      }

      // Then try matching by ID inside JSON column
      if (!matchFound && colJson >= 0 && row[colJson]) {
        try {
          var jsonData = row[colJson];
          if (typeof jsonData === 'string' && jsonData.trim().startsWith('{')) {
            jsonData = JSON.parse(jsonData);
          }
          if (jsonData && (jsonData.id === orderId || jsonData.createdDate === orderId)) {
            matchFound = true;
            Logger.log('renameOrder - Found by JSON id at row ' + r);
          }
        } catch (e) {
          // JSON parse failed
        }
      }

      if (matchFound) {
        // Update the JSON data with new title
        var jsonData = {};
        if (colJson >= 0 && row[colJson]) {
          try {
            jsonData = typeof row[colJson] === 'string' ? JSON.parse(row[colJson]) : row[colJson];
          } catch (e) {
            jsonData = {};
          }
        }

        jsonData.id = orderId;
        jsonData.title = newTitle;
        jsonData.orderName = newTitle; // Legacy field
        jsonData.lastEdited = new Date().toISOString();

        if (colJson >= 0) {
          ordersSheet.getRange(r + 1, colJson + 1).setValue(JSON.stringify(jsonData));
        }
        if (colUpdatedAt >= 0) {
          ordersSheet.getRange(r + 1, colUpdatedAt + 1).setValue(new Date());
        }

        Logger.log('Renamed order ' + orderId + ' to: ' + newTitle);
        return { success: true, newTitle: newTitle };
      }
    }

    Logger.log('renameOrder - Order not found: ' + orderId);
    return { success: false, error: 'Order not found' };
  } catch (e) {
    Logger.log('Rename order error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ================================================================
// ORDER SONGS (v2.9) - Reference-based song management
// ================================================================

/**
 * Setup OrderSongs sheet with required headers
 * Run once to create the sheet
 */
function setupOrderSongsSheet() {
  var ss = getSpreadsheet_();

  var existingSheet = ss.getSheetByName(CONFIG.ORDER_SONGS_SHEET);
  if (existingSheet) {
    SpreadsheetApp.getUi().alert('✓ OrderSongs sheet already exists!');
    return { success: true, message: 'Sheet already exists' };
  }

  var sheet = ss.insertSheet(CONFIG.ORDER_SONGS_SHEET);

  var headers = ['id', 'orderId', 'songId', 'sortOrder', 'serviceSections', 'customLyrics', 'transposeSteps', 'annotations', 'lastEdited', 'editedBy'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');

  // Set column widths
  sheet.setColumnWidth(1, 180); // id
  sheet.setColumnWidth(2, 180); // orderId
  sheet.setColumnWidth(3, 180); // songId
  sheet.setColumnWidth(4, 80);  // sortOrder
  sheet.setColumnWidth(5, 200); // serviceSections (JSON array)
  sheet.setColumnWidth(6, 400); // customLyrics
  sheet.setColumnWidth(7, 100); // transposeSteps
  sheet.setColumnWidth(8, 300); // annotations (JSON)
  sheet.setColumnWidth(9, 180); // lastEdited
  sheet.setColumnWidth(10, 180); // editedBy

  SpreadsheetApp.getUi().alert('✅ OrderSongs sheet created!\n\nThis sheet stores song references for worship orders with per-order customizations.');
  return { success: true, message: 'Sheet created' };
}

/**
 * Setup OrderChanges sheet for sync/collaboration tracking
 */
function setupOrderChangesSheet() {
  var ss = getSpreadsheet_();

  var existingSheet = ss.getSheetByName(CONFIG.ORDER_CHANGES_SHEET);
  if (existingSheet) {
    SpreadsheetApp.getUi().alert('✓ OrderChanges sheet already exists!');
    return { success: true, message: 'Sheet already exists' };
  }

  var sheet = ss.insertSheet(CONFIG.ORDER_CHANGES_SHEET);

  var headers = ['id', 'orderId', 'changeType', 'entityId', 'changeData', 'timestamp', 'changedBy'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');

  SpreadsheetApp.getUi().alert('✅ OrderChanges sheet created!\n\nThis sheet tracks changes for collaboration sync.');
  return { success: true, message: 'Sheet created' };
}

/**
 * Get service sections list
 */
function getServiceSections() {
  return SERVICE_SECTIONS;
}

/**
 * Get order with all its songs (references merged with master data)
 */
function getOrderWithSongs(orderId) {
  if (!orderId) return { error: 'Order ID required' };

  // Get the order
  var order = loadOrder(orderId);
  if (!order) return { error: 'Order not found' };

  // Get order songs
  var orderSongs = getOrderSongsForOrder_(orderId);

  // Get all master songs for reference lookup
  var allSongs = getSongs();
  var songsMap = {};
  allSongs.forEach(function(s) { songsMap[s.id] = s; });

  // Merge each order song with its master data
  var mergedSongs = orderSongs.map(function(orderSong) {
    var masterSong = songsMap[orderSong.songId] || {};
    return {
      // Order song data
      id: orderSong.id,
      orderId: orderSong.orderId,
      songId: orderSong.songId,
      sortOrder: orderSong.sortOrder,
      serviceSections: orderSong.serviceSections,
      transposeSteps: orderSong.transposeSteps || 0,
      annotations: orderSong.annotations || [],
      lastEdited: orderSong.lastEdited,
      editedBy: orderSong.editedBy,
      hasCustomLyrics: !!orderSong.customLyrics,

      // Master song data (for display)
      title: masterSong.title || 'Unknown Song',
      artist: masterSong.artist || '',
      key: masterSong.key || '',
      theme: masterSong.theme || '',
      style: masterSong.style || '',

      // Lyrics - use custom if set, otherwise master
      lyrics: orderSong.customLyrics || masterSong.lyrics || '',
      masterLyrics: masterSong.lyrics || ''
    };
  });

  return {
    order: order,
    songs: mergedSongs,
    lastSync: new Date().toISOString()
  };
}

/**
 * Internal: Get order songs for a specific order
 */
function getOrderSongsForOrder_(orderId) {
  var sheet;
  try {
    sheet = getSheet_(CONFIG.ORDER_SONGS_SHEET);
  } catch (e) {
    return [];
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id']);
  var colOrderId = findColumn_(idx, ['orderid', 'order_id']);
  var colSongId = findColumn_(idx, ['songid', 'song_id']);
  var colSortOrder = findColumn_(idx, ['sortorder', 'sort_order', 'position']);
  var colServiceSections = findColumn_(idx, ['servicesections', 'service_sections', 'sections']);
  var colCustomLyrics = findColumn_(idx, ['customlyrics', 'custom_lyrics']);
  var colTransposeSteps = findColumn_(idx, ['transposesteps', 'transpose_steps', 'transpose']);
  var colAnnotations = findColumn_(idx, ['annotations']);
  var colLastEdited = findColumn_(idx, ['lastedited', 'last_edited']);
  var colEditedBy = findColumn_(idx, ['editedby', 'edited_by']);

  var orderSongs = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rowOrderId = colOrderId >= 0 ? asString_(row[colOrderId]) : '';

    if (rowOrderId !== orderId) continue;

    // Parse JSON fields
    var serviceSections = [];
    if (colServiceSections >= 0 && row[colServiceSections]) {
      try {
        serviceSections = JSON.parse(row[colServiceSections]);
      } catch (e) {
        serviceSections = [asString_(row[colServiceSections])];
      }
    }

    var annotations = [];
    if (colAnnotations >= 0 && row[colAnnotations]) {
      try {
        annotations = JSON.parse(row[colAnnotations]);
      } catch (e) {
        annotations = [];
      }
    }

    orderSongs.push({
      id: colId >= 0 ? asString_(row[colId]) : 'os_' + r,
      orderId: rowOrderId,
      songId: colSongId >= 0 ? asString_(row[colSongId]) : '',
      sortOrder: colSortOrder >= 0 ? parseInt(row[colSortOrder]) || 0 : 0,
      serviceSections: serviceSections,
      customLyrics: colCustomLyrics >= 0 ? asString_(row[colCustomLyrics]) : '',
      transposeSteps: colTransposeSteps >= 0 ? parseInt(row[colTransposeSteps]) || 0 : 0,
      annotations: annotations,
      lastEdited: colLastEdited >= 0 ? formatDate_(row[colLastEdited]) : '',
      editedBy: colEditedBy >= 0 ? asString_(row[colEditedBy]) : ''
    });
  }

  // Sort by sortOrder
  orderSongs.sort(function(a, b) { return a.sortOrder - b.sortOrder; });

  return orderSongs;
}

/**
 * Add a song to an order (creates a reference, not a copy)
 */
function addSongToOrder(orderId, songId, serviceSections) {
  if (!orderId) return { success: false, error: 'Order ID required' };
  if (!songId) return { success: false, error: 'Song ID required' };

  var sheet;
  try {
    sheet = getSheet_(CONFIG.ORDER_SONGS_SHEET);
  } catch (e) {
    // Create sheet if doesn't exist
    setupOrderSongsSheet();
    sheet = getSheet_(CONFIG.ORDER_SONGS_SHEET);
  }

  // Get existing songs to determine sortOrder
  var existingSongs = getOrderSongsForOrder_(orderId);
  var maxSortOrder = 0;
  existingSongs.forEach(function(s) {
    if (s.sortOrder > maxSortOrder) maxSortOrder = s.sortOrder;
  });

  // Ensure serviceSections is an array
  if (!Array.isArray(serviceSections)) {
    serviceSections = serviceSections ? [serviceSections] : [];
  }

  var newId = 'os_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 6);
  var timestamp = new Date();
  var userEmail = Session.getActiveUser().getEmail() || 'unknown';

  var newRow = [
    newId,
    orderId,
    songId,
    maxSortOrder + 1,
    JSON.stringify(serviceSections),
    '', // customLyrics - empty means use master
    0,  // transposeSteps
    '[]', // annotations - empty array
    timestamp,
    userEmail
  ];

  sheet.appendRow(newRow);

  // Log change
  logOrderChange_(orderId, 'song_added', newId, { songId: songId, serviceSections: serviceSections });

  return { success: true, id: newId, sortOrder: maxSortOrder + 1 };
}

/**
 * Remove a song from an order
 */
function removeSongFromOrder(orderSongId) {
  if (!orderSongId) return { success: false, error: 'Order song ID required' };

  var sheet;
  try {
    sheet = getSheet_(CONFIG.ORDER_SONGS_SHEET);
  } catch (e) {
    return { success: false, error: 'OrderSongs sheet not found' };
  }

  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);
  var colId = findColumn_(idx, ['id']);
  var colOrderId = findColumn_(idx, ['orderid', 'order_id']);

  if (colId < 0) return { success: false, error: 'ID column not found' };

  var rowIndex = -1;
  var orderId = '';
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colId]).trim() === String(orderSongId).trim()) {
      rowIndex = r + 1;
      orderId = colOrderId >= 0 ? String(data[r][colOrderId]).trim() : '';
      break;
    }
  }

  if (rowIndex < 0) return { success: false, error: 'Order song not found' };

  sheet.deleteRow(rowIndex);

  // Log change
  if (orderId) {
    logOrderChange_(orderId, 'song_removed', orderSongId, {});
  }

  return { success: true, deletedId: orderSongId };
}

/**
 * Update an order song (customizations, section assignment, etc.)
 */
function updateOrderSong(orderSongId, updates) {
  if (!orderSongId) return { success: false, error: 'Order song ID required' };

  var sheet;
  try {
    sheet = getSheet_(CONFIG.ORDER_SONGS_SHEET);
  } catch (e) {
    return { success: false, error: 'OrderSongs sheet not found' };
  }

  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id']);
  var colOrderId = findColumn_(idx, ['orderid', 'order_id']);
  var colSortOrder = findColumn_(idx, ['sortorder', 'sort_order', 'position']);
  var colServiceSections = findColumn_(idx, ['servicesections', 'service_sections', 'sections']);
  var colCustomLyrics = findColumn_(idx, ['customlyrics', 'custom_lyrics']);
  var colTransposeSteps = findColumn_(idx, ['transposesteps', 'transpose_steps', 'transpose']);
  var colAnnotations = findColumn_(idx, ['annotations']);
  var colLastEdited = findColumn_(idx, ['lastedited', 'last_edited']);
  var colEditedBy = findColumn_(idx, ['editedby', 'edited_by']);

  if (colId < 0) return { success: false, error: 'ID column not found' };

  var rowIndex = -1;
  var orderId = '';
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colId]).trim() === String(orderSongId).trim()) {
      rowIndex = r + 1;
      orderId = colOrderId >= 0 ? String(data[r][colOrderId]).trim() : '';
      break;
    }
  }

  if (rowIndex < 0) return { success: false, error: 'Order song not found' };

  var changeType = 'song_updated';

  // Update fields
  if (updates.sortOrder !== undefined && colSortOrder >= 0) {
    sheet.getRange(rowIndex, colSortOrder + 1).setValue(updates.sortOrder);
  }

  if (updates.serviceSections !== undefined && colServiceSections >= 0) {
    var sections = Array.isArray(updates.serviceSections) ? updates.serviceSections : [updates.serviceSections];
    sheet.getRange(rowIndex, colServiceSections + 1).setValue(JSON.stringify(sections));
    changeType = 'sections_changed';
  }

  if (updates.customLyrics !== undefined && colCustomLyrics >= 0) {
    sheet.getRange(rowIndex, colCustomLyrics + 1).setValue(updates.customLyrics || '');
    changeType = updates.customLyrics ? 'lyrics_customized' : 'lyrics_reverted';
  }

  if (updates.transposeSteps !== undefined && colTransposeSteps >= 0) {
    sheet.getRange(rowIndex, colTransposeSteps + 1).setValue(parseInt(updates.transposeSteps) || 0);
    changeType = 'transposed';
  }

  if (updates.annotations !== undefined && colAnnotations >= 0) {
    var annotations = Array.isArray(updates.annotations) ? updates.annotations : [];
    sheet.getRange(rowIndex, colAnnotations + 1).setValue(JSON.stringify(annotations));
    changeType = 'annotated';
  }

  // Update timestamp and editor
  var timestamp = new Date();
  var userEmail = Session.getActiveUser().getEmail() || 'unknown';

  if (colLastEdited >= 0) {
    sheet.getRange(rowIndex, colLastEdited + 1).setValue(timestamp);
  }
  if (colEditedBy >= 0) {
    sheet.getRange(rowIndex, colEditedBy + 1).setValue(userEmail);
  }

  // Log change
  if (orderId) {
    logOrderChange_(orderId, changeType, orderSongId, updates);
  }

  return { success: true, id: orderSongId, lastEdited: timestamp.toISOString() };
}

/**
 * Reorder songs in an order
 */
function reorderOrderSongs(orderId, songIds) {
  if (!orderId) return { success: false, error: 'Order ID required' };
  if (!Array.isArray(songIds)) return { success: false, error: 'Song IDs array required' };

  var sheet;
  try {
    sheet = getSheet_(CONFIG.ORDER_SONGS_SHEET);
  } catch (e) {
    return { success: false, error: 'OrderSongs sheet not found' };
  }

  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id']);
  var colOrderId = findColumn_(idx, ['orderid', 'order_id']);
  var colSortOrder = findColumn_(idx, ['sortorder', 'sort_order', 'position']);

  if (colId < 0 || colSortOrder < 0) return { success: false, error: 'Required columns not found' };

  // Update sort order for each song
  songIds.forEach(function(songId, newOrder) {
    for (var r = 1; r < data.length; r++) {
      var rowOrderId = colOrderId >= 0 ? String(data[r][colOrderId]).trim() : '';
      var rowId = String(data[r][colId]).trim();

      if (rowOrderId === orderId && rowId === songId) {
        sheet.getRange(r + 1, colSortOrder + 1).setValue(newOrder + 1);
        break;
      }
    }
  });

  // Log change
  logOrderChange_(orderId, 'songs_reordered', orderId, { order: songIds });

  return { success: true };
}

/**
 * Get recent changes for an order since a given timestamp (for sync/polling)
 */
function getOrderChanges(orderId, sinceTimestamp) {
  var sheet;
  try {
    sheet = getSheet_(CONFIG.ORDER_CHANGES_SHEET);
  } catch (e) {
    return [];
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colOrderId = findColumn_(idx, ['orderid', 'order_id']);
  var colChangeType = findColumn_(idx, ['changetype', 'change_type', 'type']);
  var colEntityId = findColumn_(idx, ['entityid', 'entity_id']);
  var colChangeData = findColumn_(idx, ['changedata', 'change_data', 'data']);
  var colTimestamp = findColumn_(idx, ['timestamp']);
  var colChangedBy = findColumn_(idx, ['changedby', 'changed_by']);

  var sinceDate = sinceTimestamp ? new Date(sinceTimestamp) : new Date(0);

  var changes = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rowOrderId = colOrderId >= 0 ? asString_(row[colOrderId]) : '';

    if (rowOrderId !== orderId) continue;

    var timestamp = colTimestamp >= 0 ? row[colTimestamp] : null;
    if (timestamp instanceof Date && timestamp <= sinceDate) continue;

    var changeData = {};
    if (colChangeData >= 0 && row[colChangeData]) {
      try {
        changeData = JSON.parse(row[colChangeData]);
      } catch (e) {}
    }

    changes.push({
      changeType: colChangeType >= 0 ? asString_(row[colChangeType]) : '',
      entityId: colEntityId >= 0 ? asString_(row[colEntityId]) : '',
      changeData: changeData,
      timestamp: timestamp ? (timestamp instanceof Date ? timestamp.toISOString() : String(timestamp)) : '',
      changedBy: colChangedBy >= 0 ? asString_(row[colChangedBy]) : ''
    });
  }

  // Sort by timestamp ascending
  changes.sort(function(a, b) {
    return (a.timestamp || '').localeCompare(b.timestamp || '');
  });

  return changes;
}

/**
 * Internal: Log a change to the OrderChanges sheet
 */
function logOrderChange_(orderId, changeType, entityId, changeData) {
  try {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(CONFIG.ORDER_CHANGES_SHEET);

    if (!sheet) {
      // Create sheet if doesn't exist (silently)
      sheet = ss.insertSheet(CONFIG.ORDER_CHANGES_SHEET);
      sheet.getRange(1, 1, 1, 7).setValues([['id', 'orderId', 'changeType', 'entityId', 'changeData', 'timestamp', 'changedBy']]);
      sheet.getRange(1, 1, 1, 7).setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
    }

    var changeId = 'oc_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 4);
    var timestamp = new Date();
    var userEmail = Session.getActiveUser().getEmail() || 'unknown';

    sheet.appendRow([
      changeId,
      orderId,
      changeType,
      entityId,
      JSON.stringify(changeData || {}),
      timestamp,
      userEmail
    ]);

  } catch (e) {
    Logger.log('Error logging order change: ' + e.toString());
  }
}

/**
 * Save complete order data (order + songs)
 */
function saveOrderFull(orderData) {
  if (!orderData) return { success: false, error: 'Order data required' };

  // Save basic order info
  var orderId = orderData.id || ('order_' + new Date().getTime());

  // Ensure Orders sheet exists and save order
  var ordersSheet;
  try {
    ordersSheet = getSheet_(CONFIG.ORDERS_SHEET);
  } catch (e) {
    var ss = getSpreadsheet_();
    ordersSheet = ss.insertSheet(CONFIG.ORDERS_SHEET);
    ordersSheet.appendRow(['id', 'title', 'type', 'serviceDate', 'createdDate', 'lastEdited']);
  }

  var data = ordersSheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id']);
  var colTitle = findColumn_(idx, ['title', 'name']);
  var colType = findColumn_(idx, ['type', 'ordertype']);
  var colServiceDate = findColumn_(idx, ['servicedate', 'service_date', 'date']);
  var colCreatedDate = findColumn_(idx, ['createddate', 'created_date', 'created']);
  var colLastEdited = findColumn_(idx, ['lastedited', 'last_edited']);

  // Set defaults
  if (colId < 0) colId = 0;
  if (colTitle < 0) colTitle = 1;
  if (colType < 0) colType = 2;
  if (colServiceDate < 0) colServiceDate = 3;
  if (colCreatedDate < 0) colCreatedDate = 4;
  if (colLastEdited < 0) colLastEdited = 5;

  var rowIndex = -1;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colId]).trim() === String(orderId).trim()) {
      rowIndex = r + 1;
      break;
    }
  }

  var timestamp = new Date();

  if (rowIndex > 0) {
    // Update existing
    ordersSheet.getRange(rowIndex, colTitle + 1).setValue(orderData.title || '');
    ordersSheet.getRange(rowIndex, colType + 1).setValue(orderData.type || 'traditional');
    ordersSheet.getRange(rowIndex, colServiceDate + 1).setValue(orderData.serviceDate || '');
    ordersSheet.getRange(rowIndex, colLastEdited + 1).setValue(timestamp);
  } else {
    // Create new
    var newRow = [];
    for (var i = 0; i < Math.max(header.length, 6); i++) newRow.push('');
    newRow[colId] = orderId;
    newRow[colTitle] = orderData.title || 'Untitled Order';
    newRow[colType] = orderData.type || 'traditional';
    newRow[colServiceDate] = orderData.serviceDate || '';
    newRow[colCreatedDate] = timestamp;
    newRow[colLastEdited] = timestamp;
    ordersSheet.appendRow(newRow);
  }

  // Save songs if provided
  if (orderData.songs && Array.isArray(orderData.songs)) {
    // Clear existing songs for this order
    try {
      var songsSheet = getSheet_(CONFIG.ORDER_SONGS_SHEET);
      var songsData = songsSheet.getDataRange().getValues();
      var songsHeader = songsData[0];
      var songsIdx = buildHeaderIndex_(songsHeader);
      var colSongsOrderId = findColumn_(songsIdx, ['orderid', 'order_id']);

      // Find and delete existing rows (in reverse order)
      var rowsToDelete = [];
      for (var sr = 1; sr < songsData.length; sr++) {
        if (colSongsOrderId >= 0 && String(songsData[sr][colSongsOrderId]).trim() === orderId) {
          rowsToDelete.push(sr + 1);
        }
      }
      rowsToDelete.reverse().forEach(function(row) {
        songsSheet.deleteRow(row);
      });

      // Add new songs
      orderData.songs.forEach(function(song, idx) {
        addSongToOrder(orderId, song.songId, song.serviceSections || []);

        // Update with customizations if any
        if (song.customLyrics || song.transposeSteps || song.annotations) {
          // Get the newly created order song
          var orderSongs = getOrderSongsForOrder_(orderId);
          var lastSong = orderSongs[orderSongs.length - 1];
          if (lastSong) {
            updateOrderSong(lastSong.id, {
              customLyrics: song.customLyrics || '',
              transposeSteps: song.transposeSteps || 0,
              annotations: song.annotations || []
            });
          }
        }
      });
    } catch (e) {
      Logger.log('Error saving order songs: ' + e.toString());
    }
  }

  return { success: true, id: orderId, lastEdited: timestamp.toISOString() };
}

// ================================================================
// ORDER ITEMS v3.0 - Unified item storage for complete order persistence
// ================================================================

/**
 * Setup OrderItems sheet with required headers
 * Run once to create the sheet
 */
function setupOrderItemsSheet() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.ORDER_ITEMS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.ORDER_ITEMS_SHEET);
  }

  var headers = [
    'id',              // Unique item ID
    'orderId',         // Reference to Orders.id
    'itemType',        // 'song', 'liturgy', 'content', 'slide'
    'sectionId',       // Service section ID
    'sortOrder',       // Position within section
    'sourceId',        // Reference to master (songId or liturgyId)
    'title',           // Display title
    'content',         // JSON: full content data
    'customizations',  // JSON: customLyrics, transposeSteps, annotations, etc.
    'backgrounds',     // JSON: slide backgrounds
    'slides',          // JSON: array of slide content
    'createdDate',
    'lastEdited',
    'editedBy'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);

  return { success: true, message: 'OrderItems sheet created with ' + headers.length + ' columns' };
}

/**
 * Save complete order with all items (songs, liturgy, content boxes)
 * This is the main save function for v3.0 - single source of truth
 */
function saveOrderComplete(orderData) {
  if (!orderData) return { success: false, error: 'Order data required' };

  var timestamp = new Date();
  var orderId = orderData.id || ('order_' + timestamp.getTime());
  var userEmail = Session.getActiveUser().getEmail() || 'anonymous';

  // 1. Save/update order metadata in Orders sheet
  var ordersSheet = ensureSheet_(CONFIG.ORDERS_SHEET, ['id', 'title', 'type', 'serviceDate', 'template', 'createdDate', 'lastEdited', 'createdBy', 'lastEditedBy']);
  var orderRow = findOrCreateRow_(ordersSheet, orderId, {
    id: orderId,
    title: orderData.title || 'Untitled Order',
    type: orderData.type || 'traditional',
    serviceDate: orderData.serviceDate || '',
    template: JSON.stringify(orderData.template || {}),
    createdDate: orderData.createdDate || timestamp,
    lastEdited: timestamp,
    createdBy: orderData.createdBy || userEmail,
    lastEditedBy: userEmail
  });

  // 2. Clear existing items for this order
  var itemsSheet = ensureSheet_(CONFIG.ORDER_ITEMS_SHEET, ['id', 'orderId', 'itemType', 'sectionId', 'sortOrder', 'sourceId', 'title', 'content', 'customizations', 'backgrounds', 'slides', 'createdDate', 'lastEdited', 'editedBy']);
  clearOrderItems_(itemsSheet, orderId);

  // 3. Save all items
  var items = orderData.items || [];
  items.forEach(function(item, idx) {
    var itemId = item.id || ('item_' + orderId + '_' + idx + '_' + timestamp.getTime());
    var row = [
      itemId,
      orderId,
      item.itemType || 'content',
      item.sectionId || '',
      item.sortOrder !== undefined ? item.sortOrder : idx,
      item.sourceId || '',
      item.title || '',
      JSON.stringify(item.content || {}),
      JSON.stringify(item.customizations || {}),
      JSON.stringify(item.backgrounds || {}),
      JSON.stringify(item.slides || []),
      item.createdDate || timestamp,
      timestamp,
      userEmail
    ];
    itemsSheet.appendRow(row);
  });

  // 4. Log the change
  logOrderChange_(orderId, orderData.id ? 'order_updated' : 'order_created', {
    itemCount: items.length,
    timestamp: timestamp.toISOString()
  });

  return {
    success: true,
    id: orderId,
    lastEdited: timestamp.toISOString(),
    itemCount: items.length
  };
}

/**
 * Get or create an order for a service date (atomic - prevents duplicates)
 * Returns { existing: true/false, order: {...} }
 */
function getOrCreateOrder(orderData) {
  if (!orderData || !orderData.serviceDate) {
    return { success: false, error: 'serviceDate required' };
  }

  var targetDate = String(orderData.serviceDate).trim().toLowerCase();

  // Check if an order already exists for this service date
  var ordersSheet;
  try {
    ordersSheet = getSheet_(CONFIG.ORDERS_SHEET);
  } catch (e) {
    ordersSheet = null;
  }

  if (ordersSheet) {
    var data = ordersSheet.getDataRange().getValues();
    if (data.length >= 2) {
      var header = data[0];
      var idx = buildHeaderIndex_(header);
      var colId = findColumn_(idx, ['id']);
      var colTitle = findColumn_(idx, ['title', 'order title', 'name']);
      var colDate = findColumn_(idx, ['servicedate', 'service_date', 'date', 'service date']);

      for (var r = 1; r < data.length; r++) {
        var row = data[r];
        var rowDate = colDate >= 0 ? asString_(row[colDate]).trim().toLowerCase() : '';
        if (rowDate === targetDate) {
          // Found existing order
          var existingId = colId >= 0 ? String(row[colId]).trim() : '';
          var existingTitle = colTitle >= 0 ? String(row[colTitle]).trim() : '';
          Logger.log('getOrCreateOrder: Found existing order ' + existingId + ' for date ' + orderData.serviceDate);
          return {
            success: true,
            existing: true,
            id: existingId,
            title: existingTitle,
            serviceDate: orderData.serviceDate
          };
        }
      }
    }
  }

  // No existing order found — create one
  Logger.log('getOrCreateOrder: Creating new order for date ' + orderData.serviceDate);
  var result = saveOrderComplete(orderData);
  if (result && result.success) {
    return {
      success: true,
      existing: false,
      id: result.id,
      title: orderData.title || 'Untitled Order',
      serviceDate: orderData.serviceDate,
      lastEdited: result.lastEdited
    };
  }
  return { success: false, error: 'Failed to create order' };
}

/**
 * Get complete order with all items
 * Returns fully reconstructed order ready for frontend use
 * Supports both legacy format (JSON column) and new format
 */
function getOrderComplete(orderId) {
  if (!orderId) return { error: 'Order ID required' };

  // 1. Get order metadata
  var ordersSheet;
  try {
    ordersSheet = getSheet_(CONFIG.ORDERS_SHEET);
  } catch (e) {
    return { error: 'Orders sheet not found' };
  }

  var ordersData = ordersSheet.getDataRange().getValues();
  var ordersHeader = ordersData[0];
  var ordersIdx = buildHeaderIndex_(ordersHeader);

  // Check for legacy JSON column
  var colJson = findColumn_(ordersIdx, ['json', 'data', 'orderdata']);
  var colDate = findColumn_(ordersIdx, ['date', 'servicedate', 'service_date']);
  var colUpdatedAt = findColumn_(ordersIdx, ['updatedat', 'updated_at', 'lastedited', 'last_edited']);
  var colType = findColumn_(ordersIdx, ['type', 'ordertype']);
  var colId = findColumn_(ordersIdx, ['id', 'orderid', 'order_id']);

  var order = null;
  var legacyData = null;

  for (var r = 1; r < ordersData.length; r++) {
    var row = ordersData[r];
    var matchFound = false;

    // Try to match by ID column first
    if (colId >= 0) {
      var rowId = String(row[colId] || '').trim();
      if (rowId === String(orderId).trim()) {
        matchFound = true;
      }
    }

    // Also try matching by legacy identifiers (createdDate stored in JSON)
    if (!matchFound && colJson >= 0 && row[colJson]) {
      try {
        var jsonData = row[colJson];
        if (typeof jsonData === 'string' && jsonData.trim().startsWith('{')) {
          jsonData = JSON.parse(jsonData);
        }
        if (jsonData && (jsonData.id === orderId || jsonData.createdDate === orderId)) {
          matchFound = true;
          legacyData = jsonData;
        }
      } catch (e) {
        // JSON parse failed, continue
      }
    }

    if (matchFound) {
      // ALWAYS try to parse JSON data if available, regardless of how we found the order
      if (!legacyData && colJson >= 0 && row[colJson]) {
        try {
          var jsonStr = row[colJson];
          if (typeof jsonStr === 'string' && jsonStr.trim().startsWith('{')) {
            legacyData = JSON.parse(jsonStr);
            Logger.log('getOrderComplete - Parsed JSON data for order found by ID column');
          }
        } catch (e) {
          Logger.log('getOrderComplete - Failed to parse JSON for row: ' + e.toString());
        }
      }

      if (legacyData) {
        // JSON format - extract from JSON (has items)
        order = {
          id: legacyData.id || legacyData.createdDate || orderId,
          title: legacyData.title || legacyData.orderName || 'Untitled Order',
          type: legacyData.type || (colType >= 0 ? String(row[colType] || '') : '') || 'traditional',
          serviceDate: legacyData.serviceDate || (colDate >= 0 ? formatDate_(row[colDate]) : ''),
          template: legacyData.template || {},
          createdDate: legacyData.createdDate || '',
          lastEdited: colUpdatedAt >= 0 ? row[colUpdatedAt] : (legacyData.lastEdited || ''),
          createdBy: legacyData.createdBy || '',
          lastEditedBy: '',
          fromLegacy: true
        };
        Logger.log('getOrderComplete - Built order from JSON data');
      } else {
        // Column-based format (no JSON data)
        order = {
          id: colId >= 0 ? String(row[colId] || '') : orderId,
          title: row[findColumn_(ordersIdx, ['title', 'name'])] || '',
          type: row[findColumn_(ordersIdx, ['type'])] || 'traditional',
          serviceDate: formatDate_(row[findColumn_(ordersIdx, ['servicedate', 'service_date', 'date'])]),
          template: safeParseJSON_(row[findColumn_(ordersIdx, ['template'])], {}),
          createdDate: row[findColumn_(ordersIdx, ['createddate', 'created_date'])] || '',
          lastEdited: row[findColumn_(ordersIdx, ['lastedited', 'last_edited'])] || '',
          createdBy: row[findColumn_(ordersIdx, ['createdby', 'created_by'])] || '',
          lastEditedBy: row[findColumn_(ordersIdx, ['lasteditedby', 'last_edited_by'])] || ''
        };
        Logger.log('getOrderComplete - Built order from columns (no JSON data)');
      }
      break;
    }
  }

  if (!order) return { error: 'Order not found' };

  // Extract items from JSON data if available
  if (legacyData) {
    Logger.log('getOrderComplete - Extracting items from JSON, items count: ' + (legacyData.items ? legacyData.items.length : 0));
    var items = [];

    // Check if we have the new items array format (v3.0+)
    if (legacyData.items && Array.isArray(legacyData.items)) {
      items = legacyData.items;
      Logger.log('getOrderComplete - Found ' + items.length + ' items in JSON data');
    }
    // Fall back to extracting songs from legacy format
    else if (legacyData.songs && Array.isArray(legacyData.songs)) {
      legacyData.songs.forEach(function(song, idx) {
        items.push({
          id: song.id || ('song_' + idx),
          orderId: order.id,
          itemType: 'song',
          sectionId: (song.serviceSections && song.serviceSections[0]) || '',
          sortOrder: idx,
          sourceId: song.songId || '',
          title: song.title || '',
          content: { artist: song.artist || '' },
          customizations: {
            customLyrics: song.customLyrics || '',
            transposeSteps: song.transposeSteps || 0,
            annotations: song.annotations || [],
            serviceSections: song.serviceSections || []
          },
          backgrounds: {},
          slides: [],
          masterData: {
            title: song.title || '',
            artist: song.artist || '',
            lyrics: song.lyrics || song.masterLyrics || ''
          }
        });
      });
    }

    Logger.log('getOrderComplete - Returning order with ' + items.length + ' items from JSON');
    return {
      order: order,
      items: items,
      sections: legacyData.sections || {},
      backgrounds: legacyData.backgrounds || {},
      fromLegacy: true,
      lastSync: new Date().toISOString()
    };
  }

  // 2. No JSON data - try to get items from OrderItems sheet
  var items = [];
  try {
    var itemsSheet = getSheet_(CONFIG.ORDER_ITEMS_SHEET);
    var itemsData = itemsSheet.getDataRange().getValues();
    var itemsHeader = itemsData[0];
    var itemsIdx = buildHeaderIndex_(itemsHeader);

    for (var ir = 1; ir < itemsData.length; ir++) {
      var itemOrderId = String(itemsData[ir][findColumn_(itemsIdx, ['orderid', 'order_id'])] || '').trim();
      if (itemOrderId === String(orderId).trim()) {
        items.push({
          id: itemsData[ir][findColumn_(itemsIdx, ['id'])] || '',
          orderId: itemOrderId,
          itemType: itemsData[ir][findColumn_(itemsIdx, ['itemtype', 'item_type'])] || 'content',
          sectionId: itemsData[ir][findColumn_(itemsIdx, ['sectionid', 'section_id'])] || '',
          sortOrder: parseInt(itemsData[ir][findColumn_(itemsIdx, ['sortorder', 'sort_order'])] || 0, 10),
          sourceId: itemsData[ir][findColumn_(itemsIdx, ['sourceid', 'source_id'])] || '',
          title: itemsData[ir][findColumn_(itemsIdx, ['title'])] || '',
          content: safeParseJSON_(itemsData[ir][findColumn_(itemsIdx, ['content'])], {}),
          customizations: safeParseJSON_(itemsData[ir][findColumn_(itemsIdx, ['customizations'])], {}),
          backgrounds: safeParseJSON_(itemsData[ir][findColumn_(itemsIdx, ['backgrounds'])], {}),
          slides: safeParseJSON_(itemsData[ir][findColumn_(itemsIdx, ['slides'])], []),
          createdDate: itemsData[ir][findColumn_(itemsIdx, ['createddate', 'created_date'])] || '',
          lastEdited: itemsData[ir][findColumn_(itemsIdx, ['lastedited', 'last_edited'])] || '',
          editedBy: itemsData[ir][findColumn_(itemsIdx, ['editedby', 'edited_by'])] || ''
        });
      }
    }
  } catch (e) {
    Logger.log('OrderItems sheet not found, trying legacy OrderSongs: ' + e.toString());
    // Fallback to legacy OrderSongs for backward compatibility
    items = getLegacyOrderItems_(orderId);
  }

  // Sort items by sortOrder
  items.sort(function(a, b) { return a.sortOrder - b.sortOrder; });

  // 3. Merge song items with master song data for display
  var allSongs = getSongs();
  var songsMap = {};
  allSongs.forEach(function(s) { songsMap[s.id] = s; });

  items.forEach(function(item) {
    if (item.itemType === 'song' && item.sourceId && songsMap[item.sourceId]) {
      var master = songsMap[item.sourceId];
      item.masterData = {
        title: master.title,
        artist: master.artist,
        key: master.key,
        lyrics: master.lyrics,
        youtube: master.youtube,
        attachments: master.attachments
      };
    }
  });

  // 4. Get liturgy master data if needed
  // (Liturgy items store their content directly, but we can enhance later)

  return {
    order: order,
    items: items,
    lastSync: new Date().toISOString()
  };
}

/**
 * Debug function to check Orders sheet status
 */
function debugOrdersSheet() {
  var result = {
    sheetsFound: [],
    ordersSheetExists: false,
    ordersSheetHeaders: [],
    ordersCount: 0,
    sampleOrders: [],
    errors: []
  };

  try {
    var ss = getSpreadsheet_();
    var sheets = ss.getSheets();
    result.sheetsFound = sheets.map(function(s) { return s.getName(); });

    var ordersSheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
    if (ordersSheet) {
      result.ordersSheetExists = true;
      var data = ordersSheet.getDataRange().getValues();
      result.ordersSheetHeaders = data[0] || [];
      result.ordersCount = Math.max(0, data.length - 1);

      // Get sample of first 3 orders
      for (var i = 1; i < Math.min(4, data.length); i++) {
        result.sampleOrders.push({
          row: i,
          data: data[i]
        });
      }
    } else {
      result.errors.push('Orders sheet not found. Expected sheet name: ' + CONFIG.ORDERS_SHEET);
    }
  } catch (e) {
    result.errors.push('Error: ' + e.toString());
  }

  return result;
}

/**
 * RESTRUCTURE ORDERS SHEET - Run this once to set up proper column structure
 * This will migrate existing data to the new format
 */
function restructureOrdersSheet() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);

  if (!sheet) {
    // Create new sheet with proper headers
    sheet = ss.insertSheet(CONFIG.ORDERS_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['Id', 'Data', 'UpdatedAt', 'Type']]);
    sheet.setFrozenRows(1);
    Logger.log('Created new Orders sheet with headers: Id, Data, UpdatedAt, Type');
    return { success: true, message: 'Created new Orders sheet', migratedCount: 0 };
  }

  // Read existing data
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var headerIdx = buildHeaderIndex_(headers);

  Logger.log('Current headers: ' + JSON.stringify(headers));

  // Find existing columns
  var colJson = findColumn_(headerIdx, ['json', 'data', 'orderdata']);
  var colDate = findColumn_(headerIdx, ['date', 'servicedate']);
  var colUpdatedAt = findColumn_(headerIdx, ['updatedat', 'updated_at', 'lastedited']);
  var colType = findColumn_(headerIdx, ['type', 'ordertype']);
  var colId = findColumn_(headerIdx, ['id', 'orderid']);

  Logger.log('Column indices - Id: ' + colId + ', Json: ' + colJson + ', Date: ' + colDate + ', UpdatedAt: ' + colUpdatedAt + ', Type: ' + colType);

  // Extract existing orders
  var existingOrders = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var orderData = null;
    var orderId = null;

    // Try to get data from JSON column
    if (colJson >= 0 && row[colJson]) {
      try {
        var jsonStr = row[colJson];
        if (typeof jsonStr === 'string' && jsonStr.trim().startsWith('{')) {
          orderData = JSON.parse(jsonStr);
          orderId = orderData.id || orderData.createdDate;
        }
      } catch (e) {
        Logger.log('Failed to parse JSON in row ' + r + ': ' + e);
      }
    }

    // Get ID from ID column if available
    if (!orderId && colId >= 0 && row[colId]) {
      orderId = String(row[colId]);
    }

    if (orderId || orderData) {
      existingOrders.push({
        id: orderId || ('order_migrated_' + r),
        data: orderData || {},
        updatedAt: colUpdatedAt >= 0 ? row[colUpdatedAt] : new Date(),
        type: colType >= 0 ? row[colType] : (orderData && orderData.type) || 'traditional'
      });
    }
  }

  Logger.log('Found ' + existingOrders.length + ' orders to migrate');

  // Clear sheet and set new headers
  sheet.clear();
  var newHeaders = ['Id', 'Data', 'UpdatedAt', 'Type'];
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  sheet.getRange(1, 1, 1, newHeaders.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Re-insert orders with new structure
  existingOrders.forEach(function(order, idx) {
    var jsonData = order.data;
    jsonData.id = order.id; // Ensure ID is in the JSON

    var newRow = [
      order.id,
      JSON.stringify(jsonData),
      order.updatedAt || new Date(),
      order.type || 'traditional'
    ];
    sheet.appendRow(newRow);
  });

  Logger.log('Migration complete. Migrated ' + existingOrders.length + ' orders.');

  return {
    success: true,
    message: 'Restructured Orders sheet',
    migratedCount: existingOrders.length,
    newHeaders: newHeaders
  };
}

/**
 * Test order operations - call this to verify save/delete/rename work
 */
function testOrderOperations() {
  var results = {
    tests: [],
    allPassed: true
  };

  // Test 1: Create a test order
  var testOrder = {
    id: 'test_order_' + Date.now(),
    title: 'Test Order ' + new Date().toLocaleString(),
    type: 'traditional',
    serviceDate: '2026-02-07',
    items: [
      { itemType: 'content', sectionId: 'test', content: { text: 'Test content' } }
    ]
  };

  var saveResult = updateOrderInSheet(testOrder);
  results.tests.push({
    name: 'Save new order',
    passed: saveResult.success,
    details: saveResult
  });
  if (!saveResult.success) results.allPassed = false;

  // Test 2: Rename the order
  var renameResult = renameOrder(testOrder.id, 'Renamed Test Order');
  results.tests.push({
    name: 'Rename order',
    passed: renameResult.success,
    details: renameResult
  });
  if (!renameResult.success) results.allPassed = false;

  // Test 3: Verify the order exists in list
  var ordersList = getOrdersList();
  var foundOrder = ordersList.find(function(o) { return o.id === testOrder.id; });
  results.tests.push({
    name: 'Order appears in list',
    passed: !!foundOrder,
    details: foundOrder || 'Not found'
  });
  if (!foundOrder) results.allPassed = false;

  // Test 4: Delete the test order
  var deleteResult = deleteOrder(testOrder.id);
  results.tests.push({
    name: 'Delete order',
    passed: deleteResult.success,
    details: deleteResult
  });
  if (!deleteResult.success) results.allPassed = false;

  // Test 5: Verify deletion
  var ordersListAfter = getOrdersList();
  var foundAfterDelete = ordersListAfter.find(function(o) { return o.id === testOrder.id; });
  results.tests.push({
    name: 'Order removed from list',
    passed: !foundAfterDelete,
    details: foundAfterDelete ? 'Still exists!' : 'Successfully removed'
  });
  if (foundAfterDelete) results.allPassed = false;

  Logger.log('Test results: ' + JSON.stringify(results, null, 2));
  return results;
}

/**
 * Test getOrdersList - run this to see what orders are returned
 */
function testGetOrdersList() {
  var orders = getOrdersList();
  Logger.log('Orders returned: ' + orders.length);
  Logger.log(JSON.stringify(orders, null, 2));
  return orders;
}

/**
 * Debug order content - check what items are stored for an order
 */
function debugOrderContent(orderId) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Orders');
  var data = sheet.getDataRange().getValues();

  Logger.log('Looking for orderId: ' + orderId);

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var jsonCell = row[1]; // Column B - Data

    if (jsonCell && typeof jsonCell === 'string') {
      try {
        var parsed = JSON.parse(jsonCell);
        if (parsed.id === orderId || parsed.createdDate === orderId) {
          Logger.log('Found order at row ' + (r+1));
          Logger.log('Title: ' + parsed.title);
          Logger.log('Items count: ' + (parsed.items ? parsed.items.length : 0));
          Logger.log('Items: ' + JSON.stringify(parsed.items, null, 2));
          Logger.log('Sections: ' + JSON.stringify(parsed.sections));
          Logger.log('Backgrounds: ' + JSON.stringify(parsed.backgrounds));
          return {
            found: true,
            title: parsed.title,
            itemsCount: parsed.items ? parsed.items.length : 0,
            items: parsed.items
          };
        }
      } catch (e) {
        // Parse failed
      }
    }
  }

  Logger.log('Order not found');
  return { found: false };
}

/**
 * List all orders with their item counts
 */
function listOrdersWithItems() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Orders');
  var data = sheet.getDataRange().getValues();

  var results = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var jsonCell = row[1]; // Column B - Data

    if (jsonCell && typeof jsonCell === 'string' && jsonCell.trim().startsWith('{')) {
      try {
        var parsed = JSON.parse(jsonCell);
        results.push({
          id: parsed.id,
          title: parsed.title,
          itemsCount: parsed.items ? parsed.items.length : 0,
          hasItems: !!(parsed.items && parsed.items.length > 0)
        });
      } catch (e) {
        results.push({
          id: 'parse_error_row_' + r,
          title: 'Parse Error',
          error: e.toString()
        });
      }
    }
  }

  Logger.log('Orders with items:');
  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

/**
 * Simple direct test - bypasses getOrdersList to check raw parsing
 */
function simpleOrdersTest() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Orders');
  var data = sheet.getDataRange().getValues();

  Logger.log('Headers: ' + JSON.stringify(data[0]));
  Logger.log('Row count: ' + data.length);

  var orders = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var jsonCell = row[1]; // Column B - Data

    Logger.log('Row ' + (r+1) + ' - Column B type: ' + typeof jsonCell);
    Logger.log('Row ' + (r+1) + ' - Column B value (first 200 chars): ' + String(jsonCell).substring(0, 200));

    if (jsonCell && typeof jsonCell === 'string') {
      try {
        var parsed = JSON.parse(jsonCell);
        orders.push({
          id: parsed.id,
          title: parsed.title,
          type: parsed.type
        });
        Logger.log('Row ' + (r+1) + ' - Parsed successfully: ' + parsed.title);
      } catch (e) {
        Logger.log('Row ' + (r+1) + ' - Parse error: ' + e.toString());
      }
    }
  }

  Logger.log('Total orders parsed: ' + orders.length);
  Logger.log('Orders: ' + JSON.stringify(orders));
  return orders;
}

/**
 * Quick debug - returns raw sheet data
 * Run this from Apps Script Editor and check Execution Log
 */
function debugOrdersRaw() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);

  if (!sheet) {
    return { error: 'Orders sheet not found' };
  }

  var data = sheet.getDataRange().getValues();
  var result = {
    rowCount: data.length,
    headers: data[0],
    rows: []
  };

  for (var r = 1; r < Math.min(data.length, 5); r++) {
    var row = data[r];
    var dataCell = row[1]; // Column B (Data)
    result.rows.push({
      rowNum: r + 1,
      id: row[0],
      dataType: typeof dataCell,
      dataLength: dataCell ? String(dataCell).length : 0,
      dataPreview: dataCell ? String(dataCell).substring(0, 100) : '(empty)',
      updatedAt: row[2],
      type: row[3]
    });
  }

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * CHECK ORDER DATA - Call from frontend to see what's actually stored
 * Usage: google.script.run.withSuccessHandler(console.log).checkOrderData('order-id')
 */
function checkOrderData(orderId) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);

  if (!sheet) {
    return { error: 'Orders sheet not found' };
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find column indices
  var colId = -1, colData = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c]).toLowerCase().trim();
    if (h === 'id') colId = c;
    if (h === 'data' || h === 'json') colData = c;
  }

  var result = {
    headers: headers,
    colId: colId,
    colData: colData,
    orderFound: false,
    rawDataCell: null,
    parsedData: null,
    itemsCount: 0
  };

  // Find the order
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rowId = colId >= 0 ? String(row[colId]).trim() : '';

    if (rowId === String(orderId).trim()) {
      result.orderFound = true;
      result.rowIndex = r + 1;

      if (colData >= 0) {
        result.rawDataCell = row[colData];
        result.rawDataType = typeof row[colData];
        result.rawDataLength = row[colData] ? String(row[colData]).length : 0;

        // Try to parse
        if (row[colData] && typeof row[colData] === 'string') {
          try {
            var parsed = JSON.parse(row[colData]);
            result.parsedData = {
              id: parsed.id,
              title: parsed.title,
              itemsCount: parsed.items ? parsed.items.length : 0,
              items: parsed.items
            };
            result.itemsCount = parsed.items ? parsed.items.length : 0;
          } catch (e) {
            result.parseError = e.toString();
          }
        }
      } else {
        result.error = 'Data column not found in sheet!';
      }
      break;
    }
  }

  Logger.log('checkOrderData result: ' + JSON.stringify(result, null, 2));
  return result;
}

/**
 * TEST getOrderComplete - Run this to see exactly what getOrderComplete returns
 */
function testGetOrderComplete() {
  Logger.log('=== Testing getOrderComplete ===');
  var orderId = '2026-02-07T14:11:45.150Z';
  Logger.log('Order ID: ' + orderId);

  var result = getOrderComplete(orderId);

  Logger.log('Result keys: ' + Object.keys(result).join(', '));
  Logger.log('Order found: ' + (result.order ? 'YES - ' + result.order.title : 'NO'));
  Logger.log('Error: ' + (result.error || 'none'));
  Logger.log('Items: ' + (result.items ? result.items.length + ' items' : 'NO ITEMS'));

  if (result.items && result.items.length > 0) {
    Logger.log('First item title: ' + result.items[0].title);
    Logger.log('First item type: ' + result.items[0].itemType);
  }

  Logger.log('Full result: ' + JSON.stringify(result, null, 2));
  return result;
}

/**
 * Get order with items - LIGHTWEIGHT version for frontend
 * Strips large data (lyrics) to avoid google.script.run size limits
 */
function getOrderCompleteLite(orderId) {
  Logger.log('getOrderCompleteLite called for: ' + orderId);

  var result = getOrderComplete(orderId);

  if (result && result.items) {
    // Strip lyrics to reduce payload size - frontend will fetch from song library
    result.items = result.items.map(function(item) {
      return {
        id: item.id,
        itemType: item.itemType,
        sectionId: item.sectionId,
        sortOrder: item.sortOrder,
        sourceId: item.sourceId,
        title: item.title,
        content: item.content,
        customizations: item.customizations,
        slides: item.slides
        // Intentionally omitting lyrics and masterLyrics
      };
    });
  }

  Logger.log('getOrderCompleteLite returning ' + (result.items ? result.items.length : 0) + ' items');
  return result;
}

/**
 * TEST ITEM PERSISTENCE - Comprehensive test for save/load with items
 * Run this from Apps Script Editor to verify items are saved and loaded correctly
 */
function testItemPersistence() {
  var results = { steps: [], success: false };

  // Step 1: Create a test order with items
  var testId = 'test_items_' + Date.now();
  var testItems = [
    {
      id: 'song1',
      itemType: 'song',
      sectionId: 'wo-section-2',
      sortOrder: 0,
      sourceId: 'song_12345',
      title: 'Test Song 1',
      lyrics: '[Verse 1]\nThis is test lyrics\nLine two',
      slides: [
        { index: 0, content: 'This is test lyrics\nLine two', background: '' }
      ]
    },
    {
      id: 'song2',
      itemType: 'song',
      sectionId: 'wo-section-3',
      sortOrder: 1,
      sourceId: 'song_67890',
      title: 'Test Song 2',
      lyrics: '[Chorus]\nAnother test song',
      slides: []
    }
  ];

  var testOrder = {
    id: testId,
    title: 'Test Order for Item Persistence',
    type: 'traditional',
    items: testItems
  };

  // Save the order
  Logger.log('STEP 1: Saving order with ' + testItems.length + ' items');
  var saveResult = updateOrderInSheet(testOrder);
  results.steps.push({ step: 'Save', result: saveResult });

  if (!saveResult.success) {
    results.steps.push({ step: 'FAILED', error: 'Save failed: ' + JSON.stringify(saveResult) });
    Logger.log('TEST FAILED at Save: ' + JSON.stringify(saveResult));
    return results;
  }

  // Load the order back
  Logger.log('STEP 2: Loading order to verify items');
  var loadResult = getOrderComplete(testId);
  results.steps.push({
    step: 'Load',
    orderId: testId,
    orderFound: !!loadResult.order,
    itemsCount: loadResult.items ? loadResult.items.length : 0,
    items: loadResult.items
  });

  if (!loadResult.order) {
    results.steps.push({ step: 'FAILED', error: 'Order not found after save' });
    Logger.log('TEST FAILED: Order not found');
    return results;
  }

  // Verify items
  var loadedItems = loadResult.items || [];
  if (loadedItems.length !== testItems.length) {
    results.steps.push({
      step: 'FAILED',
      error: 'Item count mismatch. Expected: ' + testItems.length + ', Got: ' + loadedItems.length
    });
    Logger.log('TEST FAILED: Expected ' + testItems.length + ' items, got ' + loadedItems.length);
  } else {
    Logger.log('TEST PASSED: Items persisted correctly!');
    results.success = true;
    results.steps.push({
      step: 'Verify',
      message: 'Items count matches: ' + loadedItems.length,
      firstItem: loadedItems[0]
    });
  }

  // Cleanup: Delete the test order
  Logger.log('STEP 3: Cleaning up test order');
  var deleteResult = deleteOrder(testId);
  results.steps.push({ step: 'Cleanup', result: deleteResult });

  Logger.log('Test Results: ' + JSON.stringify(results, null, 2));
  return results;
}

/**
 * Get list of all orders (for order list display)
 * Supports both legacy (Data JSON) and V2 (separate columns) formats
 */
function getOrdersList() {
  Logger.log('getOrdersList - START');
  var orders = [];

  try {
    Logger.log('getOrdersList - Opening spreadsheet: ' + CONFIG.SPREADSHEET_ID);
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

    Logger.log('getOrdersList - Getting Orders sheet');
    var sheet = ss.getSheetByName('Orders');

    if (!sheet) {
      Logger.log('getOrdersList - Orders sheet not found, returning empty array');
      return [];
    }

    Logger.log('getOrdersList - Getting data range');
    var data = sheet.getDataRange().getValues();
    Logger.log('getOrdersList - Row count: ' + data.length);

    if (data.length < 2) {
      Logger.log('getOrdersList - No data rows, returning empty array');
      return [];
    }

    var headers = data[0];
    Logger.log('getOrdersList - Headers: ' + JSON.stringify(headers));

    // Find all column indices
    var colId = -1, colData = -1, colUpdatedAt = -1, colType = -1, colTitle = -1;
    var colServiceDate = -1, colCreatedDate = -1, colCreatedBy = -1, colSongOrderItems = -1;
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c]).toLowerCase().trim();
      if (h === 'id') colId = c;
      if (h === 'data' || h === 'json') colData = c;
      if (h === 'updatedat' || h === 'updated_at' || h === 'lastedited') colUpdatedAt = c;
      if (h === 'type') colType = c;
      if (h === 'title') colTitle = c;
      if (h === 'servicedate' || h === 'service_date') colServiceDate = c;
      if (h === 'createddate' || h === 'created_date') colCreatedDate = c;
      if (h === 'createdby' || h === 'created_by') colCreatedBy = c;
      if (h === 'songorderitems' || h === 'song_order_items') colSongOrderItems = c;
    }

    Logger.log('getOrdersList - Columns: Id=' + colId + ', Data=' + colData + ', Title=' + colTitle + ', SongOrderItems=' + colSongOrderItems);

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var jsonCell = colData >= 0 ? row[colData] : null;
      var orderObj = null;

      // First try: Parse from Data JSON column (legacy format)
      if (jsonCell && typeof jsonCell === 'string' && jsonCell.trim().startsWith('{')) {
        try {
          var parsed = JSON.parse(jsonCell);
          orderObj = {
            id: String(parsed.id || parsed.createdDate || (colId >= 0 ? row[colId] : '') || ('order_' + r)),
            title: String(parsed.title || parsed.orderName || 'Untitled Order'),
            type: String(parsed.type || (colType >= 0 ? row[colType] : '') || 'traditional'),
            serviceDate: asString_(parsed.serviceDate || (colServiceDate >= 0 ? row[colServiceDate] : '') || ''),
            createdDate: String(parsed.createdDate || ''),
            lastEdited: String(colUpdatedAt >= 0 && row[colUpdatedAt] ? row[colUpdatedAt] : (parsed.lastEdited || '')),
            createdBy: String(parsed.createdBy || '')
          };
          Logger.log('getOrdersList - Row ' + r + ' from Data JSON: ' + orderObj.title);
        } catch (e) {
          Logger.log('getOrdersList - Parse error row ' + r + ': ' + e.toString());
        }
      }

      // Second try: Read from V2 columns if no Data JSON but has ID or Title
      if (!orderObj) {
        var hasId = colId >= 0 && row[colId] && String(row[colId]).trim().length > 0;
        var hasTitle = colTitle >= 0 && row[colTitle] && String(row[colTitle]).trim().length > 0;

        if (hasId || hasTitle) {
          orderObj = {
            id: String(colId >= 0 && row[colId] ? row[colId] : ('order_' + r)),
            title: String(colTitle >= 0 && row[colTitle] ? row[colTitle] : 'Untitled Order'),
            type: String(colType >= 0 && row[colType] ? row[colType] : 'traditional'),
            serviceDate: colServiceDate >= 0 && row[colServiceDate] ? asString_(row[colServiceDate]) : '',
            createdDate: String(colCreatedDate >= 0 && row[colCreatedDate] ? row[colCreatedDate] : ''),
            lastEdited: String(colUpdatedAt >= 0 && row[colUpdatedAt] ? row[colUpdatedAt] : ''),
            createdBy: String(colCreatedBy >= 0 && row[colCreatedBy] ? row[colCreatedBy] : '')
          };
          Logger.log('getOrdersList - Row ' + r + ' from V2 columns: ' + orderObj.title);
        }
      }

      if (orderObj) {
        orders.push(orderObj);
      }
    }

    Logger.log('getOrdersList - Total orders before sort: ' + orders.length);

    // Sort by lastEdited descending
    if (orders.length > 1) {
      orders.sort(function(a, b) {
        var dateA = new Date(a.lastEdited || a.createdDate || 0);
        var dateB = new Date(b.lastEdited || b.createdDate || 0);
        return dateB - dateA;
      });
    }

    Logger.log('getOrdersList - Returning ' + orders.length + ' orders');
    return orders;

  } catch (e) {
    Logger.log('getOrdersList - FATAL ERROR: ' + e.toString());
    Logger.log('getOrdersList - Stack: ' + e.stack);
    return [];
  }
}

// Helper: Ensure sheet exists with headers
function ensureSheet_(sheetName, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    // Check if headers match expected order; if not, rearrange columns
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      // Empty sheet — just write headers
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else {
      var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var existingLower = existingHeaders.map(function(h) { return String(h).toLowerCase().trim(); });
      var expectedLower = headers.map(function(h) { return h.toLowerCase(); });

      // Check if headers need reordering or new columns added
      var needsRebuild = (existingHeaders.length !== headers.length);
      if (!needsRebuild) {
        for (var i = 0; i < headers.length; i++) {
          if (existingLower[i] !== expectedLower[i]) { needsRebuild = true; break; }
        }
      }

      if (needsRebuild) {
        // Build old column index: headerName → column index
        var oldIdx = {};
        for (var c = 0; c < existingHeaders.length; c++) {
          var key = String(existingHeaders[c]).toLowerCase().trim();
          if (key) oldIdx[key] = c;
        }

        // Rearrange existing data rows to match new header order
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          var allData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
          var newData = allData.map(function(row) {
            return headers.map(function(h) {
              var colIdx = oldIdx[h.toLowerCase()];
              return (colIdx !== undefined) ? row[colIdx] : '';
            });
          });
          // Clear and rewrite with correct column order
          sheet.getRange(1, 1, lastRow, Math.max(lastCol, headers.length)).clearContent();
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.getRange(2, 1, newData.length, headers.length).setValues(newData);
        } else {
          // No data rows, just rewrite headers
          sheet.getRange(1, 1, 1, Math.max(lastCol, headers.length)).clearContent();
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        }
        Logger.log('Rebuilt headers for ' + sheetName + ': ' + headers.join(', '));
      }
    }
  }

  return sheet;
}

// Helper: Find or create row for an entity
function findOrCreateRow_(sheet, entityId, data) {
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  var header = values[0];
  var idx = buildHeaderIndex_(header);
  var colId = findColumn_(idx, ['id']);

  var rowIndex = -1;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][colId]).trim() === String(entityId).trim()) {
      rowIndex = r + 1;
      break;
    }
  }

  if (rowIndex > 0) {
    // Update existing row
    for (var key in data) {
      var col = findColumn_(idx, [key.toLowerCase()]);
      if (col >= 0) {
        sheet.getRange(rowIndex, col + 1).setValue(data[key]);
      }
    }
  } else {
    // Create new row
    var newRow = [];
    for (var i = 0; i < header.length; i++) {
      var headerName = String(header[i]).toLowerCase().replace(/[_\s]/g, '');
      var value = '';
      for (var k in data) {
        if (k.toLowerCase().replace(/[_\s]/g, '') === headerName) {
          value = data[k];
          break;
        }
      }
      newRow.push(value);
    }
    sheet.appendRow(newRow);
    rowIndex = sheet.getLastRow();
  }

  return rowIndex;
}

// Helper: Clear all items for an order
function clearOrderItems_(sheet, orderId) {
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);
  var colOrderId = findColumn_(idx, ['orderid', 'order_id']);

  var rowsToDelete = [];
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colOrderId]).trim() === String(orderId).trim()) {
      rowsToDelete.push(r + 1);
    }
  }

  // Delete in reverse order
  rowsToDelete.reverse().forEach(function(row) {
    sheet.deleteRow(row);
  });
}

// Helper: Get legacy order items from OrderSongs (backward compatibility)
function getLegacyOrderItems_(orderId) {
  var items = [];
  try {
    var songs = getOrderSongsForOrder_(orderId);
    songs.forEach(function(song, idx) {
      items.push({
        id: song.id,
        orderId: orderId,
        itemType: 'song',
        sectionId: '',
        sortOrder: song.sortOrder || idx,
        sourceId: song.songId,
        title: song.title || '',
        content: {},
        customizations: {
          customLyrics: song.customLyrics || '',
          transposeSteps: song.transposeSteps || 0,
          annotations: song.annotations || [],
          serviceSections: song.serviceSections || []
        },
        backgrounds: {},
        slides: []
      });
    });
  } catch (e) {
    Logger.log('Legacy order items fallback error: ' + e.toString());
  }
  return items;
}

// Helper: Safe JSON parse
function safeParseJSON_(str, defaultValue) {
  if (!str) return defaultValue;
  try {
    return JSON.parse(str);
  } catch (e) {
    return defaultValue;
  }
}

// Helper: Log order change for sync tracking
function logOrderChange_(orderId, changeType, changeData) {
  try {
    var sheet = ensureSheet_(CONFIG.ORDER_CHANGES_SHEET, ['id', 'orderId', 'changeType', 'changeData', 'timestamp', 'changedBy']);
    var changeId = 'change_' + new Date().getTime();
    sheet.appendRow([
      changeId,
      orderId,
      changeType,
      JSON.stringify(changeData || {}),
      new Date(),
      Session.getActiveUser().getEmail() || 'anonymous'
    ]);
  } catch (e) {
    Logger.log('Error logging order change: ' + e.toString());
  }
}

// ================================================================
// GET ROSTER UPDATES (v2.8 - Returns recent changes for sidebar)
// ================================================================
function getRosterUpdates() {
  try {
    // First try the dedicated RosterChanges sheet
    var changesSheet = getSpreadsheet_().getSheetByName(CONFIG.ROSTER_CHANGES_SHEET);
    
    if (!changesSheet) {
      Logger.log('RosterChanges sheet not found - returning empty array (frontend will show mock data)');
      return [];
    }
    
    var data = changesSheet.getDataRange().getValues();
    if (data.length < 2) return [];
    
    var header = data[0];
    var idx = buildHeaderIndex_(header);
    
    var colDuty = findColumn_(idx, ['duty', 'role', 'rolename']);
    var colRoleId = findColumn_(idx, ['roleid', 'role_id', 'role id']);
    var colServiceDate = findColumn_(idx, ['servicedate', 'service date', 'date']);
    var colOldValue = findColumn_(idx, ['oldvalue', 'old value', 'old_value', 'previous']);
    var colNewValue = findColumn_(idx, ['newvalue', 'new value', 'new_value', 'value']);
    var colTimestamp = findColumn_(idx, ['timestamp', 'updated', 'lastedited']);
    var colPrevTimestamp = findColumn_(idx, ['prevtimestamp', 'prev timestamp', 'prev_timestamp']);
    
    // Set defaults if not found
    if (colDuty < 0) colDuty = 0;
    if (colRoleId < 0) colRoleId = 1;
    if (colServiceDate < 0) colServiceDate = 2;
    if (colOldValue < 0) colOldValue = 3;
    if (colNewValue < 0) colNewValue = 4;
    if (colTimestamp < 0) colTimestamp = 5;
    if (colPrevTimestamp < 0) colPrevTimestamp = 6;
    
    var updates = [];
    
    // Get last 50 rows, reverse order (newest first)
    var startRow = Math.max(1, data.length - 50);
    for (var i = data.length - 1; i >= startRow; i--) {
      var row = data[i];
      
      updates.push({
        duty: String(row[colDuty] || 'Unknown').trim(),
        roleId: String(row[colRoleId] || '').trim(),
        serviceDate: String(row[colServiceDate] || '').trim(),
        oldValue: String(row[colOldValue] || '').trim(),
        newValue: String(row[colNewValue] || 'TBD').trim(),
        timestamp: row[colTimestamp] ? (row[colTimestamp] instanceof Date ? row[colTimestamp].toISOString() : String(row[colTimestamp])) : new Date().toISOString(),
        prevTimestamp: row[colPrevTimestamp] ? (row[colPrevTimestamp] instanceof Date ? row[colPrevTimestamp].toISOString() : String(row[colPrevTimestamp])) : null
      });
    }
    
    return updates;
    
  } catch (error) {
    Logger.log('Error in getRosterUpdates: ' + error.toString());
    return []; // Return empty, frontend will show mock data
  }
}

// ================================================================
// GET ROSTER HISTORY (v2.8 - For navigation arrows)
// ================================================================
function getRosterHistory(roleId, serviceDate) {
  // First try RosterHistory sheet (dedicated history log)
  var historySheet;
  try {
    historySheet = getSpreadsheet_().getSheetByName(CONFIG.ROSTER_HISTORY_SHEET);
  } catch (e) {
    historySheet = null;
  }
  
  if (historySheet) {
    return getRosterHistoryFromSheet_(historySheet, roleId, serviceDate);
  }
  
  // Fallback: try RosterChanges sheet
  try {
    var changesSheet = getSpreadsheet_().getSheetByName(CONFIG.ROSTER_CHANGES_SHEET);
    if (changesSheet) {
      return getRosterHistoryFromSheet_(changesSheet, roleId, serviceDate);
    }
  } catch (e) {}
  
  // Last fallback: try main Roster sheet
  try {
    var rosterSheet = getSpreadsheet_().getSheetByName(CONFIG.ROSTER_SHEET);
    if (rosterSheet) {
      return getRosterHistoryFromSheet_(rosterSheet, roleId, serviceDate);
    }
  } catch (e) {}
  
  return [];
}

// Helper function to get history from any sheet
function getRosterHistoryFromSheet_(sheet, roleId, serviceDate) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colRole = findColumn_(idx, ['role', 'roleid', 'role_id', 'duty']);
  var colDate = findColumn_(idx, ['date', 'sunday', 'service date', 'servicedate']);
  var colValue = findColumn_(idx, ['value', 'name', 'assigned', 'person', 'newvalue', 'new value']);
  var colTimestamp = findColumn_(idx, ['lastedited', 'last edited', 'timestamp', 'modified', 'updatedat', 'updated']);
  var colOldValue = findColumn_(idx, ['oldvalue', 'old value', 'previous', 'prevvalue']);

  if (colRole < 0) colRole = 0;
  if (colDate < 0) colDate = 1;
  if (colValue < 0) colValue = 2;
  if (colTimestamp < 0) colTimestamp = 3;

  var entries = [];
  var targetRole = String(roleId).trim().toLowerCase();
  var targetDate = String(serviceDate).trim().toLowerCase().replace(/\s+/g, '');

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rowRole = String(row[colRole] || '').trim().toLowerCase();
    var rowDateRaw = row[colDate];
    var rowDate = '';
    
    // Handle date formatting
    if (rowDateRaw instanceof Date) {
      var months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      rowDate = months[rowDateRaw.getMonth()] + rowDateRaw.getDate();
    } else {
      rowDate = String(rowDateRaw || '').trim().toLowerCase().replace(/\s+/g, '');
    }
    
    if (rowRole === targetRole && rowDate === targetDate) {
      var value = String(row[colValue] || '').trim();
      var timestamp = '';
      if (colTimestamp >= 0 && colTimestamp < row.length && row[colTimestamp]) {
        if (row[colTimestamp] instanceof Date) {
          timestamp = row[colTimestamp].toISOString();
        } else {
          timestamp = String(row[colTimestamp]);
        }
      }
      
      var oldValue = '';
      if (colOldValue >= 0 && colOldValue < row.length) {
        oldValue = String(row[colOldValue] || '').trim();
      }
      
      entries.push({
        value: value,
        oldValue: oldValue,
        timestamp: timestamp
      });
    }
  }

  // Sort by timestamp descending (newest first) and return top 10
  entries.sort(function(a, b) {
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });

  return entries.slice(0, 10);
}

// ================================================================
// GET ROSTER DATA (load saved roster entries)
// ================================================================
function getRosterData(month, year) {
  var sheet;
  try {
    sheet = getSheet_(CONFIG.ROSTER_SHEET);
  } catch (e) {
    Logger.log('Roster sheet not found');
    return [];
  }

  var data = sheet.getDataRange().getValues();
  Logger.log('Roster sheet has ' + data.length + ' rows');
  
  if (data.length < 2) return [];

  var header = data[0];
  var idx = buildHeaderIndex_(header);
  Logger.log('Header index: ' + JSON.stringify(idx));

  var colRole = findColumn_(idx, ['role', 'roleid', 'role_id', 'duty']);
  var colDate = findColumn_(idx, ['date', 'sunday', 'service date']);
  var colValue = findColumn_(idx, ['value', 'name', 'assigned', 'person']);
  var colMonth = findColumn_(idx, ['month']);
  var colYear = findColumn_(idx, ['year']);
  var colTimestamp = findColumn_(idx, ['lastedited', 'last edited', 'timestamp', 'modified']);

  // Default column positions if not found
  if (colRole < 0) colRole = 0;
  if (colDate < 0) colDate = 1;
  if (colValue < 0) colValue = 2;
  if (colMonth < 0) colMonth = 3;
  if (colYear < 0) colYear = 4;
  if (colTimestamp < 0) colTimestamp = 5;

  Logger.log('Looking for month=' + month + ', year=' + year);

  // Use a map to deduplicate: keep the latest entry per role+date combo
  var entryMap = {};
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rowMonth = parseInt(row[colMonth]);
    var rowYear = parseInt(row[colYear]);

    // Filter by month and year if provided
    if (month !== undefined && month !== null && year !== undefined && year !== null) {
      if (isNaN(rowMonth) || isNaN(rowYear)) continue;
      if (rowMonth !== month || rowYear !== year) continue;
    }

    var roleId = String(row[colRole] || '').trim();
    var value = String(row[colValue] || '').trim();

    // Treat "TBD" as empty
    if (value.toUpperCase() === 'TBD') value = '';

    // Handle the date field - it might be a Date object or a string
    var dateRaw = row[colDate];
    var dateStr = '';

    if (dateRaw instanceof Date) {
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      dateStr = months[dateRaw.getMonth()] + ' ' + dateRaw.getDate();
    } else {
      dateStr = String(dateRaw || '').trim();
    }

    if (!roleId || !dateStr) continue;

    var ts = colTimestamp < row.length ? String(row[colTimestamp] || '') : '';
    var dedupeKey = roleId.toLowerCase() + '__' + dateStr.toLowerCase();

    // Keep the entry with the latest timestamp (or last row if no timestamps)
    var existing = entryMap[dedupeKey];
    if (!existing || !existing.timestamp || (ts && ts > existing.timestamp)) {
      entryMap[dedupeKey] = {
        roleId: roleId,
        date: dateStr,
        value: value,
        month: rowMonth,
        year: rowYear,
        timestamp: ts
      };
    }
  }

  var entries = [];
  for (var key in entryMap) {
    entries.push(entryMap[key]);
  }

  Logger.log('Returning ' + entries.length + ' deduplicated entries for month ' + month + ', year ' + year);
  return entries;
}

// ================================================================
// GET LITURGICAL DAY FOR A SERVICE DATE
// ================================================================
function getLiturgicalDay(serviceDate) {
  if (!serviceDate) return { success: true, value: '' };
  var months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  var parts = String(serviceDate).trim().match(/([A-Za-z]+)\s*(\d+)/);
  if (!parts) return { success: true, value: '' };
  var monthIdx = months[parts[1].toLowerCase().substring(0, 3)];
  if (monthIdx === undefined || monthIdx === null) return { success: true, value: '' };
  var year = new Date().getFullYear();

  var entries = getRosterData(monthIdx, year);
  var normDate = function(d) { return String(d).trim().toLowerCase().replace(/\s+/g, ' '); };
  var target = normDate(serviceDate);

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (/^liturgical$/i.test(String(e.roleId || '').trim()) && normDate(e.date) === target) {
      var val = String(e.value || '').trim();
      try {
        var parsed = JSON.parse(val);
        if (parsed && parsed.day) return { success: true, value: parsed.day };
      } catch (err) {}
      return { success: true, value: val };
    }
  }
  return { success: true, value: '' };
}

// ================================================================
// SAVE ROSTER EDITS
// ================================================================
function saveRosterEdits(editsArray) {
  if (!editsArray || !editsArray.length) return { success: true, updated: 0 };

  var sheet;
  try {
    sheet = getSheet_(CONFIG.ROSTER_SHEET);
  } catch (e) {
    // Create sheet if it doesn't exist
    var ss = getSpreadsheet_();
    sheet = ss.insertSheet(CONFIG.ROSTER_SHEET);
    sheet.appendRow(['Role', 'Date', 'Value', 'Month', 'Year', 'LastEdited']);
  }

  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colRole = findColumn_(idx, ['role', 'roleid', 'role_id', 'duty']);
  var colDate = findColumn_(idx, ['date', 'sunday', 'service date']);
  var colValue = findColumn_(idx, ['value', 'name', 'assigned', 'person']);
  var colMonth = findColumn_(idx, ['month']);
  var colYear = findColumn_(idx, ['year']);
  var colTimestamp = findColumn_(idx, ['lastedited', 'last edited', 'timestamp', 'modified']);

  if (colRole < 0) colRole = 0;
  if (colDate < 0) colDate = 1;
  if (colValue < 0) colValue = 2;
  if (colMonth < 0) colMonth = 3;
  if (colYear < 0) colYear = 4;
  if (colTimestamp < 0) colTimestamp = 5;

  var updated = 0;
  var historyEntries = [];
  
  editsArray.forEach(function(edit) {
    var found = false;
    var editRoleId = String(edit.roleId).trim().toLowerCase();
    var editDate = String(edit.date).trim().toLowerCase();
    var editMonth = parseInt(edit.month);
    var editYear = parseInt(edit.year);
    var oldValue = '';
    var editTimestamp = edit.timestamp || new Date().toISOString();

    // Treat "TBD" as empty on save
    var saveValue = edit.value;
    if (String(saveValue).toUpperCase() === 'TBD') saveValue = '';

    Logger.log('Saving: role=' + editRoleId + ', date=' + editDate + ', month=' + editMonth + ', year=' + editYear + ', value=' + saveValue);

    // Update ALL matching rows (fixes duplicate row bug)
    for (var r = 1; r < data.length; r++) {
      var rowRole = String(data[r][colRole]).trim().toLowerCase();
      var rowDate = String(data[r][colDate]).trim().toLowerCase();
      var rowMonth = parseInt(data[r][colMonth]);
      var rowYear = parseInt(data[r][colYear]);

      if (rowRole === editRoleId && rowDate === editDate && rowMonth === editMonth && rowYear === editYear) {
        if (!found) {
          oldValue = String(data[r][colValue] || '').trim();
          // Update first match with new value
          Logger.log('Updating row ' + (r + 1) + ', old value: ' + oldValue);
          sheet.getRange(r + 1, colValue + 1).setValue(saveValue);
          sheet.getRange(r + 1, colTimestamp + 1).setValue(editTimestamp);
          updated++;
          found = true;
        } else {
          // Delete duplicate rows by clearing them (mark for cleanup)
          Logger.log('Clearing duplicate row ' + (r + 1));
          sheet.getRange(r + 1, colValue + 1).setValue(saveValue);
          sheet.getRange(r + 1, colTimestamp + 1).setValue(editTimestamp);
        }
      }
    }

    // Add new row if not found
    if (!found) {
      Logger.log('Adding new row');
      var newRow = [];
      for (var i = 0; i < Math.max(header.length, 6); i++) newRow.push('');
      newRow[colRole] = edit.roleId;
      newRow[colDate] = edit.date;
      newRow[colValue] = saveValue;
      newRow[colMonth] = edit.month;
      newRow[colYear] = edit.year;
      newRow[colTimestamp] = editTimestamp;
      sheet.appendRow(newRow);
      updated++;
    }

    // Log to history if value changed
    if (saveValue !== oldValue && oldValue.toUpperCase() !== 'TBD') {
      historyEntries.push({
        roleId: edit.roleId,
        date: edit.date,
        newValue: saveValue,
        oldValue: oldValue
      });
    }
  });
  
  // Log all changes to history sheet
  if (historyEntries.length > 0) {
    logRosterChanges_(historyEntries);
  }

  return { success: true, updated: updated };
}

// ================================================================
// SETUP ROSTER CHANGES SHEET (v2.8 - Run once)
// ================================================================
function setupRosterChangesSheet() {
  var ss = getSpreadsheet_();
  
  var existingSheet = ss.getSheetByName(CONFIG.ROSTER_CHANGES_SHEET);
  if (existingSheet) {
    SpreadsheetApp.getUi().alert('✓ RosterChanges sheet already exists!');
    return;
  }
  
  var sheet = ss.insertSheet(CONFIG.ROSTER_CHANGES_SHEET);
  
  var headers = ['Duty', 'RoleID', 'ServiceDate', 'OldValue', 'NewValue', 'Timestamp', 'PrevTimestamp', 'ChangedBy'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  
  var sampleData = [
    ['Preacher', 'preacher', 'Jan 18', 'Rev Benedict', 'Pastor Ashley', new Date(), new Date(Date.now() - 14*24*60*60*1000), Session.getActiveUser().getEmail()],
    ['Usher 1', 'usher1', 'Jan 25', 'John', 'Mary', new Date(Date.now() - 1*60*60*1000), new Date(Date.now() - 7*24*60*60*1000), Session.getActiveUser().getEmail()],
    ['Reader', 'reader', 'Jan 11', 'Sarah', 'David', new Date(Date.now() - 3*60*60*1000), new Date(Date.now() - 10*24*60*60*1000), Session.getActiveUser().getEmail()],
    ['Music Leader', 'musicleader', 'Feb 1', '', 'James', new Date(Date.now() - 5*60*60*1000), null, Session.getActiveUser().getEmail()]
  ];
  
  sheet.getRange(2, 1, sampleData.length, sampleData[0].length).setValues(sampleData);
  
  SpreadsheetApp.getUi().alert('✅ RosterChanges sheet created!\n\nRefresh your web app to see updates in sidebar.');
}

// ================================================================
// LOG ROSTER CHANGE (v2.8 - Call when editing)
// ================================================================
function logRosterChange(duty, roleId, serviceDate, oldValue, newValue) {
  try {
    var ss = getSpreadsheet_();
    var changesSheet = ss.getSheetByName(CONFIG.ROSTER_CHANGES_SHEET);
    
    if (!changesSheet) {
      Logger.log('RosterChanges sheet not found. Run setupRosterChangesSheet() first.');
      return { success: false, error: 'Changes sheet not found' };
    }
    
    var data = changesSheet.getDataRange().getValues();
    var prevTimestamp = null;
    
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][1] === roleId && data[i][2] === serviceDate) {
        prevTimestamp = data[i][5];
        break;
      }
    }
    
    changesSheet.appendRow([
      duty,
      roleId,
      serviceDate,
      oldValue,
      newValue,
      new Date(),
      prevTimestamp,
      Session.getActiveUser().getEmail()
    ]);
    
    return { success: true };
    
  } catch (error) {
    Logger.log('Error logging change: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// Helper to log multiple changes
function logRosterChanges_(entries) {
  var ss = getSpreadsheet_();
  var now = new Date();
  var userEmail = Session.getActiveUser().getEmail() || 'unknown';

  // Map roleId to readable duty names
  var dutyNames = {
    'preacher': 'Preacher', 'liturgist': 'Liturgist',
    'usher1': 'Usher 1', 'usher2': 'Usher 2',
    'reader1': 'Reader 1', 'reader2': 'Reader 2',
    'reading1': '1st Reading', 'psalm': 'Psalm', 'reading2': '2nd Reading', 'gospel': 'Gospel',
    'communion1': 'Communion 1', 'communion2': 'Communion 2',
    'altar1': 'Altar Guild 1', 'altar2': 'Altar Guild 2',
    'pianist': 'Pianist', 'guitarist': 'Guitarist', 'bassist': 'Bassist', 'drummer': 'Drummer',
    'singer1': 'Singer 1', 'singer2': 'Singer 2', 'singer3': 'Singer 3', 'singer4': 'Singer 4',
    'lcd': 'LCD Operator', 'streaming': 'Live Streaming', 'pa': 'PA System',
    'musicleader': 'Music Leader',
    'ssteacher1': 'SS Teacher 1', 'ssteacher2': 'SS Teacher 2', 'ssteacher3': 'SS Teacher 3'
  };

  // 1) Log to RosterHistory sheet
  var historySheet = ss.getSheetByName(CONFIG.ROSTER_HISTORY_SHEET);
  if (!historySheet) {
    historySheet = ss.insertSheet(CONFIG.ROSTER_HISTORY_SHEET);
    historySheet.getRange(1, 1, 1, 5).setValues([['Role', 'Date', 'Value', 'OldValue', 'Timestamp']]);
    historySheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  }

  var historyRows = entries.map(function(entry) {
    return [entry.roleId, entry.date, entry.newValue, entry.oldValue, now];
  });

  if (historyRows.length > 0) {
    var lastRow = historySheet.getLastRow();
    historySheet.getRange(lastRow + 1, 1, historyRows.length, 5).setValues(historyRows);
  }

  // 2) Also log to RosterChanges sheet (for sidebar updates)
  var changesSheet = ss.getSheetByName(CONFIG.ROSTER_CHANGES_SHEET);
  if (!changesSheet) {
    // Create the sheet if it doesn't exist
    changesSheet = ss.insertSheet(CONFIG.ROSTER_CHANGES_SHEET);
    var headers = ['Duty', 'RoleID', 'ServiceDate', 'OldValue', 'NewValue', 'Timestamp', 'PrevTimestamp', 'ChangedBy'];
    changesSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    changesSheet.getRange(1, 1, 1, headers.length).setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
  }

  // Get existing data to find previous timestamps
  var changesData = changesSheet.getDataRange().getValues();

  entries.forEach(function(entry) {
    var dutyName = dutyNames[entry.roleId] || entry.roleId;
    var prevTimestamp = null;

    // Find previous timestamp for this role+date
    for (var i = changesData.length - 1; i >= 1; i--) {
      if (changesData[i][1] === entry.roleId && changesData[i][2] === entry.date) {
        prevTimestamp = changesData[i][5];
        break;
      }
    }

    changesSheet.appendRow([
      dutyName,
      entry.roleId,
      entry.date,
      entry.oldValue,
      entry.newValue,
      now,
      prevTimestamp,
      userEmail
    ]);
  });
}

// ================================================================
// CLEANUP ROSTER DUPLICATES
// ================================================================
function cleanupRosterDuplicates() {
  var sheet;
  try {
    sheet = getSheet_(CONFIG.ROSTER_SHEET);
  } catch (e) {
    Logger.log('Roster sheet not found');
    return { success: false, error: 'Sheet not found' };
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, removed: 0 };

  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colRole = findColumn_(idx, ['role', 'roleid', 'role_id', 'duty']);
  var colDate = findColumn_(idx, ['date', 'sunday', 'service date']);
  var colMonth = findColumn_(idx, ['month']);
  var colYear = findColumn_(idx, ['year']);
  var colTimestamp = findColumn_(idx, ['lastedited', 'last edited', 'timestamp', 'modified']);

  if (colRole < 0) colRole = 0;
  if (colDate < 0) colDate = 1;
  if (colMonth < 0) colMonth = 3;
  if (colYear < 0) colYear = 4;
  if (colTimestamp < 0) colTimestamp = 5;

  var uniqueMap = {};
  var rowsToDelete = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var role = String(row[colRole]).trim().toLowerCase();
    var date = String(row[colDate]).trim().toLowerCase();
    var month = String(row[colMonth]).trim();
    var year = String(row[colYear]).trim();
    var timestamp = row[colTimestamp] || '';

    var key = role + '|' + date + '|' + month + '|' + year;

    if (uniqueMap[key]) {
      var existingTimestamp = uniqueMap[key].timestamp || '';
      if (timestamp > existingTimestamp) {
        rowsToDelete.push(uniqueMap[key].row);
        uniqueMap[key] = { row: r, timestamp: timestamp };
      } else {
        rowsToDelete.push(r);
      }
    } else {
      uniqueMap[key] = { row: r, timestamp: timestamp };
    }
  }

  rowsToDelete.sort(function(a, b) { return b - a; });

  Logger.log('Found ' + rowsToDelete.length + ' duplicate rows to delete');

  rowsToDelete.forEach(function(rowIndex) {
    sheet.deleteRow(rowIndex + 1);
  });

  return { success: true, removed: rowsToDelete.length };
}

// ================================================================
// IMPORT LYRICS FROM WEB URL (v1.0)
// Scrapes lyrics/chord sites and extracts clean content
// ================================================================
function importLyricsFromUrl(url) {
  if (!url) return { lyrics: '', error: 'No URL provided' };

  try {
    Logger.log('Importing from URL: ' + url);

    var options = {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      return { lyrics: '', error: 'Could not access URL (HTTP ' + responseCode + ')' };
    }

    var html = response.getContentText();

    // Extract text content, stripping HTML tags
    var text = extractTextFromHtml(html);

    if (!text || text.trim().length < 20) {
      return { lyrics: '', error: 'Could not extract meaningful content from this page.' };
    }

    // Smart filter and format the extracted lyrics
    var lyrics = smartFilterLyrics(text);

    if (!lyrics || lyrics.trim().length < 10) {
      return { lyrics: '', error: 'No lyrics content found on this page.' };
    }

    return { lyrics: lyrics };

  } catch (e) {
    Logger.log('Import error: ' + e.toString());
    return { lyrics: '', error: 'Import failed: ' + e.toString() };
  }
}

// ================================================================
// EXTRACT TEXT FROM HTML
// ================================================================
function extractTextFromHtml(html) {
  if (!html) return '';

  // Remove script, style, nav, footer, header, aside elements
  html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  html = html.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  html = html.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  html = html.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  html = html.replace(/<header[\s\S]*?<\/header>/gi, ' ');
  html = html.replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
  html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  html = html.replace(/<!--[\s\S]*?-->/gi, ' ');

  // Look for common lyrics containers
  var lyricsContainerPatterns = [
    /<div[^>]*class="[^"]*lyrics[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*chord[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*song[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    /<article[^>]*>([\s\S]*?)<\/article>/gi
  ];

  var bestContent = '';
  for (var i = 0; i < lyricsContainerPatterns.length; i++) {
    var matches = html.match(lyricsContainerPatterns[i]);
    if (matches) {
      for (var j = 0; j < matches.length; j++) {
        var content = matches[j].replace(/<[^>]+>/g, '\n');
        if (content.length > bestContent.length) {
          bestContent = content;
        }
      }
    }
  }

  // If no specific container found, use body content
  if (!bestContent || bestContent.length < 100) {
    var bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      bestContent = bodyMatch[1];
    } else {
      bestContent = html;
    }
  }

  // Convert common HTML elements to line breaks
  bestContent = bestContent.replace(/<br\s*\/?>/gi, '\n');
  bestContent = bestContent.replace(/<\/p>/gi, '\n\n');
  bestContent = bestContent.replace(/<\/div>/gi, '\n');
  bestContent = bestContent.replace(/<\/li>/gi, '\n');
  bestContent = bestContent.replace(/<\/tr>/gi, '\n');

  // Remove all remaining HTML tags
  bestContent = bestContent.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  bestContent = bestContent.replace(/&nbsp;/gi, ' ');
  bestContent = bestContent.replace(/&amp;/gi, '&');
  bestContent = bestContent.replace(/&lt;/gi, '<');
  bestContent = bestContent.replace(/&gt;/gi, '>');
  bestContent = bestContent.replace(/&quot;/gi, '"');
  bestContent = bestContent.replace(/&#39;/gi, "'");
  bestContent = bestContent.replace(/&#x27;/gi, "'");
  bestContent = bestContent.replace(/&#(\d+);/g, function(match, dec) {
    return String.fromCharCode(dec);
  });

  return bestContent;
}

// ================================================================
// SMART FILTER LYRICS - Remove junk, keep only lyrics content
// ================================================================
function smartFilterLyrics(text) {
  if (!text) return '';

  var lines = text.split('\n');
  var filtered = [];
  var skipPatterns = [
    /^\s*$/,
    /copyright|©|\(c\)|all rights reserved/i,
    /^\s*\d+\s*views?\s*$/i,
    /^\s*share\s*$/i,
    /^\s*print\s*$/i,
    /^\s*download\s*$/i,
    /^\s*edit\s*$/i,
    /^\s*report\s*$/i,
    /^\s*subscribe/i,
    /^\s*sign up/i,
    /^\s*log ?in/i,
    /^\s*create account/i,
    /facebook|twitter|instagram|youtube|pinterest|tiktok/i,
    /^\s*advertisement/i,
    /^\s*sponsored/i,
    /^\s*related\s*(songs?|articles?|posts?)/i,
    /^\s*comments?\s*\(\d+\)/i,
    /^\s*leave a (comment|reply)/i,
    /^\s*cookie|privacy policy|terms of (use|service)/i,
    /^\s*\[\s*\]/,
    /^\s*menu\s*$/i,
    /^\s*home\s*$/i,
    /^\s*search\s*$/i,
    /^\s*contact(\s+us)?\s*$/i,
    /^\s*about(\s+us)?\s*$/i,
    /^\s*\d+\s*$/
  ];

  var inLyricsSection = false;
  var consecutiveGoodLines = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();

    // Skip empty or very short lines at the beginning
    if (!inLyricsSection && trimmed.length < 2) continue;

    // Check skip patterns
    var shouldSkip = false;
    for (var j = 0; j < skipPatterns.length; j++) {
      if (skipPatterns[j].test(trimmed)) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) {
      consecutiveGoodLines = 0;
      continue;
    }

    // Check if this looks like lyrics (section header, chord line, or text line)
    var isSectionHeader = /^(\[)?(verse|chorus|bridge|pre-?chorus|intro|outro|ending|tag|coda|interlude|hook|vamp|refrain|instrumental)(\s*\d*)?(\])?:?\s*$/i.test(trimmed);
    var isChordLine = /^[\sA-G#bmdimaug7sus249\/\(\)\-\|:]+$/.test(trimmed) && /[A-G]/.test(trimmed) && trimmed.length < 80;
    var isLyricLine = trimmed.length > 3 && trimmed.length < 200 && !/^[^a-zA-Z]*$/.test(trimmed);

    if (isSectionHeader || isChordLine || isLyricLine) {
      if (!inLyricsSection && consecutiveGoodLines >= 1) {
        inLyricsSection = true;
      }
      consecutiveGoodLines++;
      filtered.push(line);
    } else {
      if (inLyricsSection && consecutiveGoodLines > 3 && trimmed === '') {
        filtered.push('');
      }
      consecutiveGoodLines = 0;
    }
  }

  // Use the formatting function
  return formatExtractedLyrics(filtered.join('\n'));
}

// ================================================================
// PROCESS UPLOADED FILE (Base64 -> Text extraction)
// Uses DriveApp for simpler permissions
// ================================================================
function processUploadedFile(base64Data, mimeType, fileName) {
  if (!base64Data) return { lyrics: '', error: 'No file data provided' };

  try {
    Logger.log('Processing uploaded file: ' + fileName + ' (' + mimeType + ')');

    // Decode base64 to blob
    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, mimeType, fileName);

    var lyrics = '';

    // Handle different file types
    if (mimeType === 'text/plain') {
      // Plain text - just read it directly
      lyrics = blob.getDataAsString();

    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // Word .docx - parse XML directly (no Drive API needed)
      lyrics = extractTextFromDocx(blob);

    } else if (mimeType === 'application/msword') {
      // Old .doc format - try to extract what we can
      lyrics = blob.getDataAsString();
      // Clean up binary artifacts
      lyrics = lyrics.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]/g, ' ');

    } else if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
      // PDF or Image - need OCR via Drive
      lyrics = extractWithOCR(blob, mimeType);

    } else {
      return { lyrics: '', error: 'Unsupported file type: ' + mimeType };
    }

    if (!lyrics || !lyrics.trim()) {
      return { lyrics: '', error: 'No text could be extracted from this file.' };
    }

    // Format the extracted text
    lyrics = formatExtractedLyrics(lyrics);

    return { lyrics: lyrics };

  } catch (e) {
    Logger.log('File processing error: ' + e.toString());
    return { lyrics: '', error: 'Processing failed: ' + e.toString() };
  }
}

// ================================================================
// EXTRACT TEXT FROM DOCX (Word documents)
// Parses the XML inside the .docx ZIP file - no Drive API needed
// ================================================================
function extractTextFromDocx(blob) {
  try {
    // .docx is a ZIP file containing XML
    var unzipped = Utilities.unzip(blob);
    var text = '';

    for (var i = 0; i < unzipped.length; i++) {
      var file = unzipped[i];
      var name = file.getName();

      // Main document content is in word/document.xml
      if (name === 'word/document.xml' || name.indexOf('word/document') === 0) {
        var xml = file.getDataAsString();

        // Extract text from <w:t> tags (Word text elements)
        var textMatches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        if (textMatches) {
          var paragraph = '';
          for (var j = 0; j < textMatches.length; j++) {
            var match = textMatches[j].replace(/<[^>]+>/g, '');
            paragraph += match;
          }
          text += paragraph;
        }

        // Handle paragraph breaks
        text = xml.replace(/<w:p[^>]*>/g, '\n').replace(/<[^>]+>/g, '');
        // Clean up extra whitespace but preserve line structure
        text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
      }
    }

    return text.trim();
  } catch (e) {
    Logger.log('DOCX extraction error: ' + e.toString());
    throw new Error('Could not parse Word document: ' + e.message);
  }
}

// ================================================================
// EXTRACT WITH OCR (PDF/Images via Google Drive)
// ================================================================
function extractWithOCR(blob, mimeType) {
  var tempFile = null;
  var tempDocId = null;

  try {
    // First, upload the file to Drive using DriveApp (simpler permissions)
    var folder = DriveApp.getRootFolder();
    tempFile = folder.createFile(blob);
    tempFile.setName('_temp_ocr_' + new Date().getTime());
    var fileId = tempFile.getId();

    Logger.log('Uploaded temp file: ' + fileId);

    // Now try to use Advanced Drive Service to copy with OCR
    try {
      var copyResource = {
        title: '_temp_ocr_doc_' + new Date().getTime(),
        mimeType: 'application/vnd.google-apps.document'
      };

      var copiedFile = Drive.Files.copy(copyResource, fileId, { ocr: true, ocrLanguage: 'en' });
      tempDocId = copiedFile.id;

      var doc = DocumentApp.openById(tempDocId);
      var text = doc.getBody().getText();

      return text;

    } catch (driveError) {
      Logger.log('Drive.Files.copy failed: ' + driveError.toString());

      // Fallback: Try direct conversion for PDFs
      if (mimeType === 'application/pdf') {
        try {
          // Some PDFs can be opened directly if they have text layers
          var pdfText = blob.getDataAsString();
          // Extract readable text (very basic)
          var readable = pdfText.match(/\(([^)]+)\)/g);
          if (readable && readable.length > 10) {
            return readable.map(function(s) { return s.slice(1, -1); }).join(' ');
          }
        } catch (e) {}
      }

      throw new Error('OCR failed. Please ensure the Drive API is properly authorized, or try copying text manually.');
    }

  } finally {
    // Clean up temp files
    try {
      if (tempDocId) {
        DriveApp.getFileById(tempDocId).setTrashed(true);
      }
      if (tempFile) {
        tempFile.setTrashed(true);
      }
    } catch (e) {
      Logger.log('Cleanup error: ' + e.toString());
    }
  }
}

// ================================================================
// SCAN DOCUMENT FOR LYRICS (v3.0 - Improved permissions handling)
// ================================================================
// Fetch the full plain text of a Google Doc for display as selectable text in the Songbook
function getDocAsText(docUrl) {
  if (!docUrl) return { error: 'No URL provided' };
  try {
    var idMatch = docUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) return { error: 'Not a Google Docs URL' };
    var doc  = DocumentApp.openById(idMatch[1]);
    var text = doc.getBody().getText();
    return { success: true, text: text, title: doc.getName() };
  } catch(e) {
    return { error: 'Could not load document: ' + e.toString() };
  }
}

function scanDocumentForLyrics(url) {
  if (!url) return { lyrics: '', error: 'No URL provided' };

  try {
    var fileIdMatch = url.match(/[-\w]{25,}/);
    if (!fileIdMatch) {
      return { lyrics: '', error: 'Could not extract file ID from URL' };
    }

    var fileId = fileIdMatch[0];
    var file;

    try {
      file = DriveApp.getFileById(fileId);
    } catch (e) {
      return { lyrics: '', error: 'Could not access file. Make sure it is shared with "Anyone with the link" or the script has permission.' };
    }

    var mimeType = file.getMimeType();
    var lyrics = '';

    Logger.log('Scanning: ' + file.getName() + ' (' + mimeType + ')');

    if (mimeType === 'application/vnd.google-apps.document') {
      // Google Doc - open directly
      try {
        var doc = DocumentApp.openById(fileId);
        lyrics = doc.getBody().getText();
      } catch (e) {
        return { lyrics: '', error: 'Could not open Google Doc: ' + e.toString() };
      }

    } else if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
      // PDF or Image - use OCR helper
      try {
        var blob = file.getBlob();
        lyrics = extractWithOCR(blob, mimeType);
      } catch (e) {
        var typeLabel = mimeType === 'application/pdf' ? 'PDF' : 'Image';
        return { lyrics: '', error: typeLabel + ' extraction failed: ' + e.message };
      }

    } else if (mimeType === 'text/plain') {
      // Plain text
      try {
        lyrics = file.getBlob().getDataAsString();
      } catch (e) {
        return { lyrics: '', error: 'Could not read text file' };
      }

    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // Word .docx
      try {
        var blob = file.getBlob();
        lyrics = extractTextFromDocx(blob);
      } catch (e) {
        return { lyrics: '', error: 'Could not parse Word document: ' + e.message };
      }

    } else {
      return { lyrics: '', error: 'Unsupported file type: ' + mimeType };
    }

    if (!lyrics || !lyrics.trim()) {
      return { lyrics: '', error: 'No text could be extracted from this file.' };
    }

    // Clean up and format the extracted text
    lyrics = formatExtractedLyrics(lyrics);

    Logger.log('Extracted ' + lyrics.length + ' characters');

    return { lyrics: lyrics };

  } catch (e) {
    Logger.log('Scan error: ' + e.toString());
    return { lyrics: '', error: 'Scan failed: ' + e.toString() };
  }
}

// ================================================================
// GET FILE INFO FROM URL
// ================================================================
function getFileInfoFromUrl(url) {
  if (!url) return { name: 'Unknown', type: 'FILE' };
  
  try {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      var videoId = '';
      if (url.includes('v=')) {
        videoId = url.split('v=')[1].split('&')[0];
      } else if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1].split('?')[0];
      }
      
      if (videoId) {
        try {
          var response = UrlFetchApp.fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId + '&format=json', {muteHttpExceptions: true});
          if (response.getResponseCode() === 200) {
            var data = JSON.parse(response.getContentText());
            return { name: data.title || 'YouTube Video', type: 'YOUTUBE', id: videoId };
          }
        } catch (e) {}
        return { name: 'YouTube Video', type: 'YOUTUBE', id: videoId };
      }
      return { name: 'YouTube Video', type: 'YOUTUBE' };
    }
    
    var fileIdMatch = url.match(/[-\w]{25,}/);
    if (!fileIdMatch) {
      return { name: 'External Link', type: 'LINK' };
    }
    
    var fileId = fileIdMatch[0];
    var file = DriveApp.getFileById(fileId);
    var mimeType = file.getMimeType();
    var name = file.getName();
    
    var type = 'FILE';
    if (mimeType === 'application/vnd.google-apps.document') type = 'GDOC';
    else if (mimeType === 'application/vnd.google-apps.spreadsheet') type = 'GSHEET';
    else if (mimeType === 'application/vnd.google-apps.presentation') type = 'GSLIDE';
    else if (mimeType === 'application/pdf') type = 'PDF';
    else if (mimeType.startsWith('image/')) type = 'IMAGE';
    else if (mimeType.startsWith('audio/')) type = 'AUDIO';
    else if (mimeType.startsWith('video/')) type = 'VIDEO';
    
    return { name: name, type: type, mimeType: mimeType, id: fileId };
    
  } catch (e) {
    return { name: 'Unknown File', type: 'FILE' };
  }
}

// ================================================================
// GET YOUTUBE VIDEO TITLE
// ================================================================
function getYouTubeVideoTitle(url) {
  if (!url) return { title: 'Unknown Video' };
  
  try {
    var videoId = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([^?&]+)/);
    if (!videoId) return { title: 'YouTube Video' };
    
    // Try to fetch the page and extract title
    try {
      var response = UrlFetchApp.fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId[1] + '&format=json');
      var json = JSON.parse(response.getContentText());
      return { title: json.title || 'YouTube Video', id: videoId[1] };
    } catch (e) {
      return { title: 'YouTube Video', id: videoId[1] };
    }
  } catch (e) {
    return { title: 'YouTube Video' };
  }
}

// ================================================================
// FORMAT EXTRACTED LYRICS (Enhanced v2.0)
// Better chord detection, section headers, and positioning
// ================================================================
function formatExtractedLyrics(text) {
  if (!text) return '';

  // Clean up common OCR artifacts and normalize whitespace
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Common chord patterns: A, Am, A7, Am7, Amaj7, Asus4, Aadd9, A/E, F#m, Bb, etc.
  var chordRegex = /^[A-G][#b]?(m|M|maj|min|dim|aug|sus|add|dom)?[0-9]?(\/[A-G][#b]?)?$/;

  // Check if a line is primarily chords
  function isChordLine(line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.length > 100) return false;

    // Split by spaces and check each token
    var tokens = trimmed.split(/\s+/);
    var chordCount = 0;
    var totalTokens = tokens.length;

    for (var t = 0; t < tokens.length; t++) {
      var token = tokens[t].replace(/[()|\-:]/g, '');
      if (!token) continue;
      // Check various chord patterns
      if (/^[A-G][#b]?(m|M|maj|min|dim|aug|sus|add|dom)?[0-9]?(\/[A-G][#b]?)?$/.test(token)) {
        chordCount++;
      } else if (/^[A-G][#b]?(m|M)?[0-9]?(sus|add|maj|dim|aug)?[0-9]?(\/[A-G][#b]?)?$/.test(token)) {
        chordCount++;
      } else if (/^N\.?C\.?$/i.test(token)) {
        // No Chord marker
        chordCount++;
      }
    }

    // If more than 60% of tokens are chords, it's a chord line
    return totalTokens > 0 && (chordCount / totalTokens) >= 0.6 && chordCount >= 1;
  }

  // Detect section header
  function isSectionHeader(line) {
    var trimmed = line.trim();
    // Match: [Verse 1], Verse 1:, VERSE, (Chorus), etc.
    return /^[\[\(]?\s*(verse|chorus|bridge|pre-?chorus|intro|outro|ending|tag|coda|interlude|hook|vamp|refrain|instrumental|solo|break|turnaround)(\s*\d*[a-z]?)?\s*[\]\):.]?\s*$/i.test(trimmed);
  }

  // Format section header consistently
  function formatSectionHeader(line) {
    var trimmed = line.trim().replace(/[\[\]\(\):\.]/g, '').trim();
    var match = trimmed.match(/^(verse|chorus|bridge|pre-?chorus|intro|outro|ending|tag|coda|interlude|hook|vamp|refrain|instrumental|solo|break|turnaround)(\s*\d*[a-z]?)?$/i);
    if (match) {
      var name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      // Normalize pre-chorus
      if (name.toLowerCase() === 'prechorus') name = 'Pre-Chorus';
      var number = match[2] ? match[2].trim() : '';
      return '[' + name + (number ? ' ' + number : '') + ']';
    }
    return '[' + trimmed + ']';
  }

  var lines = text.split('\n');
  var formatted = [];
  var lastWasEmpty = false;
  var lastWasChord = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();

    // Skip multiple consecutive empty lines
    if (!trimmed) {
      if (!lastWasEmpty && formatted.length > 0) {
        formatted.push('');
        lastWasEmpty = true;
      }
      lastWasChord = false;
      continue;
    }
    lastWasEmpty = false;

    // Check for section headers first
    if (isSectionHeader(trimmed)) {
      // Add blank line before section if needed
      if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
        formatted.push('');
      }
      formatted.push(formatSectionHeader(trimmed));
      lastWasChord = false;
      continue;
    }

    // Check if it's a chord line
    if (isChordLine(trimmed)) {
      // Preserve original spacing for chord positioning
      formatted.push(line.replace(/^\s*/, ''));
      lastWasChord = true;
      continue;
    }

    // Regular lyrics line
    formatted.push(trimmed);
    lastWasChord = false;
  }

  // Remove leading/trailing empty lines
  while (formatted.length > 0 && formatted[0] === '') formatted.shift();
  while (formatted.length > 0 && formatted[formatted.length - 1] === '') formatted.pop();

  return formatted.join('\n');
}

// ================================================================
// DASHBOARD DATA (Home Page)
// ================================================================

function getMessages() {
  var sheet;
  try { sheet = getSheet_(CONFIG.MESSAGES_SHEET); } catch (e) { return []; }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id']);
  var colMessage = findColumn_(idx, ['message', 'text', 'content']);
  var colSource = findColumn_(idx, ['source', 'reference', 'attribution']);
  var colActive = findColumn_(idx, ['active', 'enabled']);

  var messages = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (colActive >= 0) {
      var active = row[colActive];
      if (active === false || String(active).toLowerCase() === 'false') continue;
    }
    var message = colMessage >= 0 ? String(row[colMessage] || '').trim() : '';
    if (!message) continue;

    messages.push({
      id: colId >= 0 ? String(row[colId] || ('msg_' + r)) : 'msg_' + r,
      message: message,
      source: colSource >= 0 ? String(row[colSource] || '').trim() : ''
    });
  }
  return messages;
}

function getAnnouncements() {
  var sheet;
  try { sheet = getSheet_(CONFIG.ANNOUNCEMENTS_SHEET); } catch (e) { return []; }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var idx = buildHeaderIndex_(header);

  var colId = findColumn_(idx, ['id']);
  var colTitle = findColumn_(idx, ['title', 'heading']);
  var colDesc = findColumn_(idx, ['description', 'body', 'details']);
  var colDate = findColumn_(idx, ['date', 'event date', 'eventdate']);
  var colType = findColumn_(idx, ['type', 'category']);
  var colActive = findColumn_(idx, ['active', 'enabled']);
  var colPriority = findColumn_(idx, ['priority', 'order']);

  var announcements = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (colActive >= 0) {
      var active = row[colActive];
      if (active === false || String(active).toLowerCase() === 'false') continue;
    }
    var title = colTitle >= 0 ? String(row[colTitle] || '').trim() : '';
    if (!title) continue;

    var dateVal = colDate >= 0 ? row[colDate] : '';
    var dateStr = '';
    if (dateVal instanceof Date) {
      dateStr = dateVal.toISOString();
    } else if (dateVal) {
      dateStr = String(dateVal).trim();
    }

    announcements.push({
      id: colId >= 0 ? String(row[colId] || ('ann_' + r)) : 'ann_' + r,
      title: title,
      description: colDesc >= 0 ? String(row[colDesc] || '').trim() : '',
      date: dateStr,
      type: colType >= 0 ? String(row[colType] || 'general').trim().toLowerCase() : 'general',
      priority: colPriority >= 0 ? (parseInt(row[colPriority]) || 5) : 5
    });
  }

  announcements.sort(function(a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.date && b.date) return new Date(a.date) - new Date(b.date);
    return 0;
  });

  return announcements;
}

function getDashboardData() {
  var now = new Date();
  var currentMonth = now.getMonth();
  var currentYear = now.getFullYear();
  var nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  var nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;

  var result = {
    messages: [],
    announcements: [],
    rosterCurrent: [],
    rosterNext: [],
    currentMonth: currentMonth,
    currentYear: currentYear,
    nextMonth: nextMonth,
    nextYear: nextYear
  };

  try { result.messages = getMessages(); } catch (e) { Logger.log('Dashboard messages error: ' + e); }
  try { result.announcements = getAnnouncements(); } catch (e) { Logger.log('Dashboard announcements error: ' + e); }
  try { result.rosterCurrent = getRosterData(currentMonth, currentYear); } catch (e) { Logger.log('Dashboard roster current error: ' + e); }
  try { result.rosterNext = getRosterData(nextMonth, nextYear); } catch (e) { Logger.log('Dashboard roster next error: ' + e); }

  return result;
}

// ================================================================
// GET APP NOTIFICATIONS (Phase 3 — unified notification feed)
// ================================================================
function getAppNotifications() {
  var result = [];
  var now = new Date();
  var sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // 1. Recent roster changes (last 7 days)
  try {
    var updates = getRosterUpdates();
    updates.forEach(function(u) {
      if (!u.timestamp) return;
      var ts = new Date(u.timestamp);
      if (isNaN(ts) || (now - ts) > sevenDaysMs) return;
      result.push({
        id: 'roster__' + (u.roleId || '') + '__' + String(u.serviceDate || '').replace(/\s/g,'_') + '__' + ts.getTime(),
        type: 'roster',
        title: (u.duty || u.roleId || 'Roster Change'),
        body: (u.serviceDate || '') + (u.oldValue && u.newValue ? ' • ' + u.oldValue + ' → ' + u.newValue : (u.newValue ? ' • ' + u.newValue : '')),
        timestamp: u.timestamp
      });
    });
  } catch(e) { Logger.log('getAppNotifications roster: ' + e); }

  // 2. Active announcements
  try {
    var announcements = getAnnouncements();
    announcements.forEach(function(a) {
      result.push({
        id: 'ann__' + String(a.id || a.title || '').replace(/\s+/g,'_').slice(0, 40),
        type: 'announcement',
        title: a.title || 'Announcement',
        body: a.description || '',
        timestamp: a.date || new Date().toISOString(),
        priority: a.priority || 5
      });
    });
  } catch(e) { Logger.log('getAppNotifications ann: ' + e); }

  // Sort: announcements first (by priority), then roster changes newest first
  result.sort(function(a, b) {
    if (a.type === 'announcement' && b.type !== 'announcement') return -1;
    if (a.type !== 'announcement' && b.type === 'announcement') return 1;
    if (a.type === 'announcement') return (a.priority || 5) - (b.priority || 5);
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  return result.slice(0, 30);
}

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet not found: ' + name);
  }
  return sheet;
}

function buildHeaderIndex_(headerRow) {
  var idx = {};
  for (var c = 0; c < headerRow.length; c++) {
    var key = String(headerRow[c]).toLowerCase().trim();
    if (key) idx[key] = c;
  }
  return idx;
}

function findColumn_(idx, possibleNames) {
  for (var i = 0; i < possibleNames.length; i++) {
    var name = possibleNames[i].toLowerCase();
    if (idx.hasOwnProperty(name)) return idx[name];
  }
  return -1;
}

function asString_(val) {
  if (val == null) return '';
  if (val instanceof Date) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[val.getMonth()] + ' ' + val.getDate();
  }
  return String(val).trim();
}

function formatDate_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toISOString();
  }
  try {
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch (e) {}
  return String(val).trim();
}

// ================================================================
// TEST FUNCTIONS
// ================================================================

function testGetSongs() {
  var songs = getSongs();
  Logger.log('Found ' + songs.length + ' songs');
  if (songs.length > 0) {
    Logger.log('First song: ' + JSON.stringify(songs[0]));
  }
  return songs;
}

function testGetRosterData() {
  var month = new Date().getMonth();
  var year = new Date().getFullYear();
  
  Logger.log('Testing getRosterData for month=' + month + ', year=' + year);
  
  var entries = getRosterData(month, year);
  Logger.log('Found ' + entries.length + ' entries');
  
  entries.forEach(function(entry, idx) {
    Logger.log('Entry ' + idx + ': ' + JSON.stringify(entry));
  });
  
  return entries;
}

function testRosterSheet() {
  try {
    var sheet = getSheet_(CONFIG.ROSTER_SHEET);
    var data = sheet.getDataRange().getValues();
    Logger.log('Roster sheet has ' + data.length + ' rows');
    
    for (var i = 0; i < Math.min(data.length, 10); i++) {
      Logger.log('Row ' + i + ': ' + JSON.stringify(data[i]));
    }
    
    return data;
  } catch (e) {
    Logger.log('Error: ' + e.message);
    return null;
  }
}

function testRosterUpdates() {
  var updates = getRosterUpdates();
  Logger.log('Found ' + updates.length + ' updates');
  updates.forEach(function(u, i) {
    Logger.log(i + ': ' + u.duty + ' on ' + u.serviceDate + ' - ' + u.oldValue + ' → ' + u.newValue);
  });
  return updates;
}

// ================================================================
// ORDER SONGS TEST FUNCTIONS (v2.9)
// ================================================================

function testOrderSongsSetup() {
  Logger.log('Setting up OrderSongs sheet...');
  var result = setupOrderSongsSheet();
  Logger.log('Result: ' + JSON.stringify(result));
  return result;
}

function testOrderChangesSetup() {
  Logger.log('Setting up OrderChanges sheet...');
  var result = setupOrderChangesSheet();
  Logger.log('Result: ' + JSON.stringify(result));
  return result;
}

function testGetServiceSections() {
  var sections = getServiceSections();
  Logger.log('Service sections: ' + JSON.stringify(sections));
  return sections;
}

function testAddSongToOrder() {
  // Create a test order first
  var orderId = 'test_order_' + new Date().getTime();

  // Get first song from Songs sheet
  var songs = getSongs();
  if (songs.length === 0) {
    Logger.log('No songs found to test with');
    return { error: 'No songs found' };
  }

  var songId = songs[0].id;
  Logger.log('Adding song ' + songId + ' to order ' + orderId);

  var result = addSongToOrder(orderId, songId, ['preparation', 'offering']);
  Logger.log('Result: ' + JSON.stringify(result));
  return result;
}

function testGetOrderWithSongs() {
  // Get any existing orders
  var orders = getOrders();
  if (orders.length === 0) {
    Logger.log('No orders found');
    return { error: 'No orders found' };
  }

  var orderId = orders[0].id;
  Logger.log('Getting order with songs for: ' + orderId);

  var result = getOrderWithSongs(orderId);
  Logger.log('Result: ' + JSON.stringify(result));
  return result;
}

// ================================================================
// UPLOAD FILE TO GOOGLE DRIVE
// ================================================================
function uploadFileToDrive(base64Data, fileName, mimeType) {
  try {
    var folder = getDriveFolder_('drive_folder_media', 'Media');

    // Decode base64 and create file
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    var file = folder.createFile(blob);

    // Set sharing to anyone with the link can view
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();

    // Determine type
    var type = 'FILE';
    if (mimeType.indexOf('audio/') === 0) type = 'AUDIO';
    else if (mimeType.indexOf('video/') === 0) type = 'VIDEO';
    else if (mimeType.indexOf('image/') === 0) type = 'IMAGE';
    else if (mimeType === 'application/pdf') type = 'PDF';

    return {
      success: true,
      url: getDriveEmbedUrl_(fileId),
      name: fileName,
      type: type,
      fileId: fileId,
      mimeType: mimeType
    };
  } catch (e) {
    Logger.log('Upload error: ' + e.toString());
    throw new Error('Failed to upload file: ' + e.message);
  }
}

// ================================================================
// ORDER PERSISTENCE V2 - Lightweight storage (no lyrics)
// Works with existing sheet structure: Id, Data, UpdatedAt, Type
// Solves google.script.run size limit by NOT storing lyrics in JSON
// ================================================================

/**
 * Save order using V2 lightweight format
 * Uses existing Data column but stores items WITHOUT lyrics
 */
function saveOrderV2(orderData) {
  if (!orderData) return { success: false, error: 'Order data required' };

  Logger.log('saveOrderV2 - START');
  Logger.log('saveOrderV2 - Order title: ' + orderData.title);
  Logger.log('saveOrderV2 - Items count: ' + (orderData.items ? orderData.items.length : 0));

  try {
    var sheet = getSheet_(CONFIG.ORDERS_SHEET);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idx = buildHeaderIndex_(headers);

    // Find columns - works with existing structure: Id, Data, UpdatedAt, Type
    var colId = findColumn_(idx, ['id']);
    var colData = findColumn_(idx, ['data', 'json']);
    var colUpdatedAt = findColumn_(idx, ['updatedat', 'updated_at', 'lastedited']);
    var colType = findColumn_(idx, ['type']);

    Logger.log('saveOrderV2 - Columns: Id=' + colId + ', Data=' + colData + ', UpdatedAt=' + colUpdatedAt + ', Type=' + colType);

    var timestamp = new Date();
    var orderId = orderData.id || ('order_' + timestamp.getTime());

    // Process items - strip lyrics to keep payload small
    var lightItems = [];

    if (orderData.items && Array.isArray(orderData.items)) {
      orderData.items.forEach(function(item) {
        // Create lightweight item (no lyrics, no masterLyrics, no masterData)
        var lightItem = {
          id: item.id,
          itemType: item.itemType,
          sectionId: item.sectionId || '',
          sortOrder: item.sortOrder || 0,
          sourceId: item.sourceId || '',
          title: item.title || '',
          content: item.content || {},
          customizations: item.customizations || {},
          slides: item.slides || [],
          backgrounds: item.backgrounds || {}
          // Intentionally NOT storing: lyrics, masterLyrics, masterData
        };
        lightItems.push(lightItem);
      });
    }

    Logger.log('saveOrderV2 - Light items: ' + lightItems.length);

    // Build lightweight JSON for Data column
    var orderJson = {
      id: orderId,
      title: orderData.title || 'Untitled Order',
      orderName: orderData.title || 'Untitled Order',
      type: orderData.type || 'traditional',
      serviceDate: orderData.serviceDate || '',
      template: orderData.template || {},
      createdDate: orderData.createdDate || timestamp.toISOString(),
      lastEdited: timestamp.toISOString(),
      createdBy: orderData.createdBy || '',
      items: lightItems,
      sections: orderData.sections || {},
      backgrounds: orderData.backgrounds || {},
      version: 'v2-lite' // Mark as lightweight format
    };

    var jsonStr = JSON.stringify(orderJson);
    Logger.log('saveOrderV2 - JSON length: ' + jsonStr.length + ' bytes');

    // Find existing row
    var rowToUpdate = -1;
    for (var r = 1; r < data.length; r++) {
      var row = data[r];

      // Match by ID column
      if (colId >= 0 && String(row[colId]).trim() === String(orderId).trim()) {
        rowToUpdate = r + 1;
        break;
      }

      // Also check Data column for ID (legacy matching)
      if (colData >= 0 && row[colData]) {
        try {
          var existingJson = typeof row[colData] === 'string' ? JSON.parse(row[colData]) : row[colData];
          if (existingJson && (existingJson.id === orderId || existingJson.createdDate === orderId)) {
            rowToUpdate = r + 1;
            break;
          }
        } catch (e) {}
      }
    }

    // Find additional columns for V2 format (for display purposes)
    var colTitle = findColumn_(idx, ['title']);
    var colServiceDate = findColumn_(idx, ['servicedate', 'service_date']);
    var colCreatedDate = findColumn_(idx, ['createddate', 'created_date']);
    var colCreatedBy = findColumn_(idx, ['createdby', 'created_by']);

    if (rowToUpdate > 0) {
      // Update existing row
      Logger.log('saveOrderV2 - Updating row ' + rowToUpdate);
      if (colId >= 0) sheet.getRange(rowToUpdate, colId + 1).setValue(orderId);
      if (colData >= 0) sheet.getRange(rowToUpdate, colData + 1).setValue(jsonStr);
      if (colUpdatedAt >= 0) sheet.getRange(rowToUpdate, colUpdatedAt + 1).setValue(timestamp);
      if (colType >= 0) sheet.getRange(rowToUpdate, colType + 1).setValue(orderData.type || 'traditional');
      // Also update display columns
      if (colTitle >= 0) sheet.getRange(rowToUpdate, colTitle + 1).setValue(orderData.title || 'Untitled');
      if (colServiceDate >= 0) sheet.getRange(rowToUpdate, colServiceDate + 1).setValue(orderData.serviceDate || '');
    } else {
      // Create new row - write to all columns
      Logger.log('saveOrderV2 - Creating new row');
      var newRow = [];
      for (var c = 0; c < headers.length; c++) {
        var hLower = String(headers[c]).toLowerCase().trim();
        if (hLower === 'id') newRow[c] = orderId;
        else if (hLower === 'data' || hLower === 'json') newRow[c] = jsonStr;
        else if (hLower === 'updatedat' || hLower === 'updated_at' || hLower === 'lastedited') newRow[c] = timestamp;
        else if (hLower === 'type') newRow[c] = orderData.type || 'traditional';
        else if (hLower === 'title') newRow[c] = orderData.title || 'Untitled';
        else if (hLower === 'servicedate' || hLower === 'service_date') newRow[c] = orderData.serviceDate || '';
        else if (hLower === 'createddate' || hLower === 'created_date') newRow[c] = orderData.createdDate || timestamp.toISOString();
        else if (hLower === 'createdby' || hLower === 'created_by') newRow[c] = orderData.createdBy || '';
        else newRow[c] = '';
      }
      sheet.appendRow(newRow);
    }

    Logger.log('saveOrderV2 - SUCCESS');
    return {
      success: true,
      id: orderId,
      lastEdited: timestamp.toISOString(),
      itemsSaved: lightItems.length
    };

  } catch (e) {
    Logger.log('saveOrderV2 - ERROR: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Load order using V2 format - lightweight, no lyrics
 * Works with existing sheet structure: Id, Data, UpdatedAt, Type
 * Frontend will fetch lyrics separately via getSongLyricsBatch
 */
function getOrderV2(orderId) {
  if (!orderId) return { error: 'Order ID required' };

  Logger.log('getOrderV2 - Loading order: ' + orderId);

  try {
    var sheet = getSheet_(CONFIG.ORDERS_SHEET);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idx = buildHeaderIndex_(headers);

    // Find all columns - both legacy and V2
    var colId = findColumn_(idx, ['id']);
    var colData = findColumn_(idx, ['data', 'json']);
    var colUpdatedAt = findColumn_(idx, ['updatedat', 'updated_at', 'lastedited']);
    var colType = findColumn_(idx, ['type']);
    var colTitle = findColumn_(idx, ['title']);
    var colServiceDate = findColumn_(idx, ['servicedate', 'service_date']);
    var colTemplate = findColumn_(idx, ['template']);
    var colCreatedDate = findColumn_(idx, ['createddate', 'created_date']);
    var colCreatedBy = findColumn_(idx, ['createdby', 'created_by']);
    var colSongOrderItems = findColumn_(idx, ['songorderitems', 'song_order_items']);
    var colServiceItems = findColumn_(idx, ['serviceitems', 'service_items']);
    var colBackgrounds = findColumn_(idx, ['backgrounds']);
    var colSectionStates = findColumn_(idx, ['sectionstates', 'section_states']);

    Logger.log('getOrderV2 - Columns: Id=' + colId + ', Data=' + colData + ', SongOrderItems=' + colSongOrderItems);

    var order = null;
    var items = [];
    var backgrounds = {};
    var sectionStates = {};

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var rowId = colId >= 0 ? String(row[colId]).trim() : '';
      var matchFound = false;
      var jsonData = null;

      // Try to parse Data column (legacy format)
      if (colData >= 0 && row[colData]) {
        try {
          var jsonStr = row[colData];
          if (typeof jsonStr === 'string' && jsonStr.trim().startsWith('{')) {
            jsonData = JSON.parse(jsonStr);
          }
        } catch (e) {
          Logger.log('getOrderV2 - JSON parse error at row ' + r + ': ' + e.toString());
        }
      }

      // Match by ID column
      if (rowId === String(orderId).trim()) {
        matchFound = true;
      }
      // Also match by ID inside JSON
      else if (jsonData && (jsonData.id === orderId || jsonData.createdDate === orderId)) {
        matchFound = true;
      }

      if (matchFound) {
        Logger.log('getOrderV2 - Found order at row ' + r);

        // ALWAYS prefer Data column (JSON) - it has the complete items
        if (jsonData) {
          // Read from Data JSON column (primary format)
          Logger.log('getOrderV2 - Using Data column format');

          order = {
            id: jsonData.id || rowId || orderId,
            title: jsonData.title || jsonData.orderName || (colTitle >= 0 ? String(row[colTitle] || '') : '') || 'Untitled',
            type: jsonData.type || (colType >= 0 ? String(row[colType] || '') : 'traditional'),
            serviceDate: jsonData.serviceDate || (colServiceDate >= 0 ? String(row[colServiceDate] || '') : ''),
            template: jsonData.template || {},
            createdDate: jsonData.createdDate || '',
            lastEdited: jsonData.lastEdited || (colUpdatedAt >= 0 ? String(row[colUpdatedAt] || '') : ''),
            createdBy: jsonData.createdBy || ''
          };

          backgrounds = jsonData.backgrounds || {};
          sectionStates = jsonData.sections || {};

          // Extract items - strip lyrics
          if (jsonData.items && Array.isArray(jsonData.items)) {
            jsonData.items.forEach(function(item) {
              items.push({
                id: item.id,
                itemType: item.itemType,
                sectionId: item.sectionId || '',
                sortOrder: item.sortOrder || 0,
                sourceId: item.sourceId || '',
                title: item.title || '',
                content: item.content || {},
                customizations: item.customizations || {},
                slides: item.slides || [],
                backgrounds: item.backgrounds || {}
              });
            });
          }
          Logger.log('getOrderV2 - Extracted ' + items.length + ' items from Data column');

        } else {
          // Fallback: Read from V2 columns if Data column is empty
          var hasV2Data = colSongOrderItems >= 0 && row[colSongOrderItems] && String(row[colSongOrderItems]).trim().length > 2;

          if (hasV2Data) {
            Logger.log('getOrderV2 - Fallback to V2 columns');

            order = {
              id: rowId || orderId,
              title: colTitle >= 0 ? String(row[colTitle] || 'Untitled') : 'Untitled',
              type: colType >= 0 ? String(row[colType] || 'traditional') : 'traditional',
              serviceDate: colServiceDate >= 0 ? String(row[colServiceDate] || '') : '',
              template: colTemplate >= 0 ? safeParseJSON_(row[colTemplate], {}) : {},
              createdDate: colCreatedDate >= 0 ? String(row[colCreatedDate] || '') : '',
              lastEdited: colUpdatedAt >= 0 ? String(row[colUpdatedAt] || '') : '',
              createdBy: colCreatedBy >= 0 ? String(row[colCreatedBy] || '') : ''
            };

            // Parse SongOrderItems
            var songOrderItems = safeParseJSON_(row[colSongOrderItems], []);
            items = items.concat(songOrderItems);

            // Parse ServiceItems
            var serviceItems = colServiceItems >= 0 ? safeParseJSON_(row[colServiceItems], {}) : {};
            Object.keys(serviceItems).forEach(function(sectionId) {
              var sectionItems = serviceItems[sectionId] || [];
              items = items.concat(sectionItems);
            });

            backgrounds = colBackgrounds >= 0 ? safeParseJSON_(row[colBackgrounds], {}) : {};
            sectionStates = colSectionStates >= 0 ? safeParseJSON_(row[colSectionStates], {}) : {};
            Logger.log('getOrderV2 - Extracted ' + items.length + ' items from V2 columns');

          } else {
            // No data found - just create basic order from columns
            Logger.log('getOrderV2 - No item data found, creating basic order');
            order = {
              id: rowId || orderId,
              title: colTitle >= 0 ? String(row[colTitle] || 'Untitled') : 'Untitled',
              type: colType >= 0 ? String(row[colType] || 'traditional') : 'traditional',
              serviceDate: colServiceDate >= 0 ? String(row[colServiceDate] || '') : '',
              template: {},
              createdDate: colCreatedDate >= 0 ? String(row[colCreatedDate] || '') : '',
              lastEdited: colUpdatedAt >= 0 ? String(row[colUpdatedAt] || '') : '',
              createdBy: ''
            };
          }
        }

        break;
      }
    }

    if (!order) {
      Logger.log('getOrderV2 - Order not found: ' + orderId);
      return { error: 'Order not found' };
    }

    Logger.log('getOrderV2 - Found order: ' + order.title);
    Logger.log('getOrderV2 - Total items: ' + items.length);

    return {
      order: order,
      items: items,
      backgrounds: backgrounds,
      sectionStates: sectionStates
    };

  } catch (e) {
    Logger.log('getOrderV2 - ERROR: ' + e.toString());
    return { error: e.toString() };
  }
}

/**
 * Get lyrics for multiple songs by ID
 * Called by frontend after loading order to fetch lyrics on demand
 */
function getSongLyricsBatch(songIds) {
  if (!songIds || !Array.isArray(songIds) || songIds.length === 0) {
    return {};
  }

  Logger.log('getSongLyricsBatch - Fetching lyrics for ' + songIds.length + ' songs');

  try {
    var sheet = getSheet_(CONFIG.SONGS_SHEET);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idx = buildHeaderIndex_(headers);

    var colId = findColumn_(idx, ['id', 'song id', 'song_id']);
    var colLyrics = findColumn_(idx, ['lyrics']);
    var colTitle = findColumn_(idx, ['title', 'name']);
    var colArtist = findColumn_(idx, ['artist']);
    var colKey = findColumn_(idx, ['key', 'keys']);

    var lyricsMap = {};
    var songIdSet = {};
    songIds.forEach(function(id) { songIdSet[String(id).trim()] = true; });

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var songId = colId >= 0 ? String(row[colId]).trim() : '';

      if (songIdSet[songId]) {
        lyricsMap[songId] = {
          lyrics: colLyrics >= 0 ? String(row[colLyrics] || '') : '',
          title: colTitle >= 0 ? String(row[colTitle] || '') : '',
          artist: colArtist >= 0 ? String(row[colArtist] || '') : '',
          key: colKey >= 0 ? String(row[colKey] || '') : ''
        };
      }
    }

    Logger.log('getSongLyricsBatch - Found ' + Object.keys(lyricsMap).length + ' songs');
    return lyricsMap;

  } catch (e) {
    Logger.log('getSongLyricsBatch - ERROR: ' + e.toString());
    return {};
  }
}

/**
 * Test V2 order persistence
 */
function testOrderV2() {
  var testId = 'test_v2_' + Date.now();

  // Create test order
  var testOrder = {
    id: testId,
    title: 'Test V2 Order',
    type: 'traditional',
    items: [
      { id: 'item1', itemType: 'song', sourceId: 'song_123', title: 'Test Song', sectionId: '', sortOrder: 0 },
      { id: 'item2', itemType: 'song', sourceId: 'song_456', title: 'Another Song', sectionId: 'wo-section-2', sortOrder: 0 }
    ],
    backgrounds: { 'wo-section-2': 'https://example.com/bg.jpg' },
    sections: { 'wo-section-2': { expanded: true } }
  };

  Logger.log('=== TEST V2 ORDER PERSISTENCE ===');

  // Save
  var saveResult = saveOrderV2(testOrder);
  Logger.log('Save result: ' + JSON.stringify(saveResult));

  if (!saveResult.success) {
    Logger.log('FAILED: Save failed');
    return { success: false, error: 'Save failed' };
  }

  // Load
  var loadResult = getOrderV2(testId);
  Logger.log('Load result: ' + JSON.stringify(loadResult));

  if (loadResult.error) {
    Logger.log('FAILED: Load failed');
    return { success: false, error: 'Load failed' };
  }

  // Verify
  var itemsFound = loadResult.items ? loadResult.items.length : 0;
  Logger.log('Items found: ' + itemsFound);

  if (itemsFound !== 2) {
    Logger.log('FAILED: Expected 2 items, got ' + itemsFound);
    return { success: false, error: 'Item count mismatch' };
  }

  Logger.log('=== TEST PASSED ===');
  return { success: true, itemsFound: itemsFound };
}

/**
 * Test loading an existing order - run this to debug load issues
 * Logs detailed info about what getOrderV2 returns
 */
function testLoadExistingOrder() {
  Logger.log('=== TEST LOAD EXISTING ORDER ===');

  // First, list all orders to find one to test
  var orders = getOrdersList();
  Logger.log('Found ' + orders.length + ' orders');

  if (orders.length === 0) {
    Logger.log('No orders found to test');
    return { success: false, error: 'No orders found' };
  }

  // Use the first order for testing
  var testOrderId = orders[0].id;
  Logger.log('Testing with order ID: ' + testOrderId);
  Logger.log('Order title: ' + orders[0].title);

  // Try to load it with getOrderV2
  var result = getOrderV2(testOrderId);

  Logger.log('=== RESULT ===');
  Logger.log('Has error: ' + (result.error ? 'YES - ' + result.error : 'NO'));
  Logger.log('Has order: ' + (result.order ? 'YES' : 'NO'));
  Logger.log('Items count: ' + (result.items ? result.items.length : 0));

  if (result.order) {
    Logger.log('Order title: ' + result.order.title);
    Logger.log('Order type: ' + result.order.type);
  }

  if (result.items && result.items.length > 0) {
    Logger.log('First item: ' + JSON.stringify(result.items[0]));
  }

  // Calculate response size
  var responseJson = JSON.stringify(result);
  Logger.log('Response size: ' + responseJson.length + ' bytes');

  // google.script.run has a ~5MB limit but practical issues start around 1MB
  if (responseJson.length > 500000) {
    Logger.log('WARNING: Response is large (' + Math.round(responseJson.length/1024) + ' KB) - may fail in browser');
  }

  return {
    success: !result.error,
    orderId: testOrderId,
    orderTitle: result.order ? result.order.title : null,
    itemsCount: result.items ? result.items.length : 0,
    responseSize: responseJson.length
  };
}

/**
 * Test loading the OLD format order (with lyrics in JSON)
 * This tests if getOrderV2 properly strips lyrics from legacy orders
 */
function testLoadOldOrder() {
  Logger.log('=== TEST LOAD OLD ORDER ===');

  // The old order ID from your sheet
  var oldOrderId = '2026-02-07T14:10:38.945Z';
  Logger.log('Testing with OLD order ID: ' + oldOrderId);

  // First, dump the raw JSON to see its structure
  var sheet = getSheet_(CONFIG.ORDERS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    var rowId = String(data[r][0]).trim();
    if (rowId === oldOrderId || (data[r][1] && String(data[r][1]).indexOf(oldOrderId) > -1)) {
      var rawJson = data[r][1];
      if (rawJson) {
        try {
          var parsed = JSON.parse(rawJson);
          Logger.log('=== RAW JSON STRUCTURE ===');
          Logger.log('Keys: ' + Object.keys(parsed).join(', '));
          Logger.log('Has items array: ' + (parsed.items ? 'YES (' + parsed.items.length + ')' : 'NO'));
          Logger.log('Has songs array: ' + (parsed.songs ? 'YES (' + parsed.songs.length + ')' : 'NO'));
          if (parsed.items && parsed.items.length > 0) {
            Logger.log('First item keys: ' + Object.keys(parsed.items[0]).join(', '));
          }
          if (parsed.songs && parsed.songs.length > 0) {
            Logger.log('First song keys: ' + Object.keys(parsed.songs[0]).join(', '));
          }
        } catch (e) {
          Logger.log('Failed to parse JSON: ' + e.toString());
        }
      }
      break;
    }
  }

  // Try to load it
  var result = getOrderV2(oldOrderId);

  Logger.log('=== RESULT ===');
  Logger.log('Has error: ' + (result.error ? 'YES - ' + result.error : 'NO'));
  Logger.log('Has order: ' + (result.order ? 'YES' : 'NO'));
  Logger.log('Items count: ' + (result.items ? result.items.length : 0));

  if (result.order) {
    Logger.log('Order title: ' + result.order.title);
  }

  if (result.items && result.items.length > 0) {
    result.items.forEach(function(item, i) {
      Logger.log('Item ' + i + ': ' + item.title + ' (type: ' + item.itemType + ')');
      // Check if lyrics accidentally included
      if (item.lyrics) {
        Logger.log('  WARNING: Item has lyrics! Length: ' + item.lyrics.length);
      }
      if (item.masterLyrics) {
        Logger.log('  WARNING: Item has masterLyrics! Length: ' + item.masterLyrics.length);
      }
    });
  }

  var responseJson = JSON.stringify(result);
  Logger.log('Response size: ' + responseJson.length + ' bytes (' + Math.round(responseJson.length/1024) + ' KB)');

  return {
    success: !result.error,
    orderId: oldOrderId,
    orderTitle: result.order ? result.order.title : null,
    itemsCount: result.items ? result.items.length : 0,
    responseSize: responseJson.length,
    responseSizeKB: Math.round(responseJson.length/1024)
  };
}

/**
 * List ALL orders and show how many items each has
 */
function listAllOrdersWithItemCounts() {
  Logger.log('=== ALL ORDERS WITH ITEM COUNTS ===');

  var sheet = getSheet_(CONFIG.ORDERS_SHEET);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  Logger.log('Headers: ' + headers.join(', '));
  Logger.log('Total rows: ' + (data.length - 1));

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var orderId = String(row[0] || '').trim();
    var jsonCell = row[1];

    Logger.log('--- Row ' + r + ' ---');
    Logger.log('ID column: ' + orderId);

    if (jsonCell) {
      try {
        var parsed = JSON.parse(jsonCell);
        Logger.log('Title: ' + (parsed.title || parsed.orderName || 'Untitled'));
        Logger.log('Items count: ' + (parsed.items ? parsed.items.length : 0));
        Logger.log('Version: ' + (parsed.version || 'legacy'));

        if (parsed.items && parsed.items.length > 0) {
          parsed.items.forEach(function(item, i) {
            Logger.log('  Item ' + i + ': ' + (item.title || 'no title') + ' (type: ' + (item.itemType || 'unknown') + ')');
          });
        }
      } catch (e) {
        Logger.log('JSON parse error: ' + e.toString());
      }
    } else {
      Logger.log('No JSON data in Data column');
      // Check other columns for data
      Logger.log('Checking all columns for this row:');
      for (var c = 0; c < headers.length; c++) {
        var val = row[c];
        if (val && String(val).length > 0) {
          var preview = String(val).substring(0, 100);
          Logger.log('  ' + headers[c] + ': ' + preview + (String(val).length > 100 ? '...' : ''));
        }
      }
    }
  }

  return { success: true };
}

// ================================================================
// SUPABASE ORDER PERSISTENCE (v3.0)
// Orders + OrderItems stored in Supabase PostgreSQL.
// All calls proxied through Apps Script (key never exposed in HTML).
// Set Script Properties: SUPABASE_URL, SUPABASE_KEY
// ================================================================

/**
 * Low-level Supabase REST helper.
 * @param {string} method  GET | POST | PATCH | DELETE
 * @param {string} path    PostgREST path, e.g. "orders?id=eq.abc"
 * @param {Object} [body]  Request body (objects/arrays)
 * @param {Object} [extraHeaders] Additional headers (e.g. Prefer)
 */
function supabaseRequest_(method, path, body, extraHeaders) {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = (props.getProperty('SUPABASE_URL') || '').trim();
  var key     = (props.getProperty('SUPABASE_KEY') || '').trim();

  if (!baseUrl || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in Script Properties.');
  }

  var url = baseUrl + '/rest/v1/' + path;
  var headers = {
    'apikey':        key,
    'Authorization': 'Bearer ' + key,
    'Content-Type':  'application/json',
    'Accept':        'application/json'
  };

  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function(k) { headers[k] = extraHeaders[k]; });
  }

  var options = {
    method:             method.toLowerCase(),
    headers:            headers,
    muteHttpExceptions: true
  };
  if (body !== undefined && body !== null) {
    options.payload = JSON.stringify(body);
  }

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();

  // 204 = No Content (success with no body), 200/201 = OK with body
  if (code >= 400) {
    throw new Error('Supabase ' + method + ' /' + path + ' → HTTP ' + code + ': ' + text);
  }

  return (text && text.trim().length > 0) ? JSON.parse(text) : null;
}

/**
 * Save (create or update) a full order and its items to Supabase.
 * Items should include customizations.masterLyrics for full lyrics storage.
 * Returns { success, id, lastEdited, itemsSaved }
 */
function saveOrderToSupabase(orderData) {
  if (!orderData) return { success: false, error: 'Order data required' };

  try {
    var timestamp = new Date();
    var orderId   = orderData.id || ('order_' + timestamp.getTime());

    Logger.log('saveOrderToSupabase - id: ' + orderId + ', title: ' + orderData.title);

    // 1. Upsert order metadata
    var orderRow = {
      id:           orderId,
      title:        orderData.title || 'Untitled Order',
      type:         orderData.type  || 'traditional',
      service_date: orderData.serviceDate || '',
      template:     orderData.template   || {},
      created_date: orderData.createdDate || timestamp.toISOString(),
      last_edited:  timestamp.toISOString(),
      created_by:   orderData.createdBy  || ''
    };

    supabaseRequest_('POST', 'orders', orderRow, {
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    });

    // 2. Delete existing items (clear-and-reinsert strategy)
    supabaseRequest_('DELETE', 'order_items?order_id=eq.' + encodeURIComponent(orderId));

    // 3. Build and insert all items
    var items = orderData.items || [];
    if (items.length > 0) {
      var rows = items.map(function(item, idx) {
        // Include masterLyrics in customizations for self-contained load (no Sheets fetch)
        var cust = item.customizations || {};
        return {
          id:             item.id || ('item_' + orderId + '_' + idx),
          order_id:       orderId,
          item_type:      item.itemType   || 'content',
          section_id:     item.sectionId  || '',
          sort_order:     item.sortOrder  !== undefined ? item.sortOrder : idx,
          source_id:      item.sourceId   || '',
          title:          item.title      || '',
          content:        item.content    || {},
          customizations: cust,
          slides:         item.slides     || [],
          backgrounds:    item.backgrounds || {},
          last_edited:    timestamp.toISOString()
        };
      });

      supabaseRequest_('POST', 'order_items', rows, {
        'Prefer': 'return=minimal'
      });
    }

    Logger.log('saveOrderToSupabase - SUCCESS: ' + items.length + ' items saved');
    return {
      success:    true,
      id:         orderId,
      lastEdited: timestamp.toISOString(),
      itemsSaved: items.length
    };

  } catch (e) {
    Logger.log('saveOrderToSupabase - ERROR: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Load a single order and all its items from Supabase.
 * Returns { order, items } where items include full lyrics in customizations.
 */
function getOrderFromSupabase(orderId) {
  if (!orderId) return { error: 'Order ID required' };

  try {
    Logger.log('getOrderFromSupabase - id: ' + orderId);

    var orderRows = supabaseRequest_('GET',
      'orders?id=eq.' + encodeURIComponent(orderId) + '&select=*');

    if (!orderRows || orderRows.length === 0) {
      Logger.log('getOrderFromSupabase - Not found in Supabase, trying Sheets fallback');
      return getOrderV2(orderId); // Graceful fallback to old Sheets path
    }

    var o = orderRows[0];
    var order = {
      id:          o.id,
      title:       o.title,
      type:        o.type || 'traditional',
      serviceDate: o.service_date || '',
      template:    o.template    || {},
      createdDate: o.created_date ? new Date(o.created_date).toISOString() : '',
      lastEdited:  o.last_edited  ? new Date(o.last_edited).toISOString()  : '',
      createdBy:   o.created_by  || ''
    };

    var itemRows = supabaseRequest_('GET',
      'order_items?order_id=eq.' + encodeURIComponent(orderId) +
      '&order=sort_order.asc&select=*');

    var items = (itemRows || []).map(function(r) {
      return {
        id:             r.id,
        itemType:       r.item_type,
        sectionId:      r.section_id   || '',
        sortOrder:      r.sort_order   || 0,
        sourceId:       r.source_id    || '',
        title:          r.title        || '',
        content:        r.content      || {},
        customizations: r.customizations || {},
        slides:         r.slides       || [],
        backgrounds:    r.backgrounds  || {}
      };
    });

    Logger.log('getOrderFromSupabase - Found order "' + order.title + '" with ' + items.length + ' items');
    return { order: order, items: items, backgrounds: {}, sectionStates: {} };

  } catch (e) {
    Logger.log('getOrderFromSupabase - ERROR: ' + e.toString());
    return { error: e.toString() };
  }
}

/**
 * Return list of all orders (metadata only, no items) sorted by last_edited desc.
 * Shape matches the existing getOrdersList() return value.
 */
function getOrdersListFromSupabase() {
  try {
    var rows = supabaseRequest_('GET',
      'orders?select=id,title,type,service_date,created_date,last_edited,created_by' +
      '&order=last_edited.desc');

    var orders = (rows || []).map(function(o) {
      return {
        id:          o.id,
        title:       o.title        || 'Untitled Order',
        type:        o.type         || 'traditional',
        serviceDate: o.service_date || '',
        createdDate: o.created_date ? new Date(o.created_date).toISOString() : '',
        lastEdited:  o.last_edited  ? new Date(o.last_edited).toISOString()  : '',
        createdBy:   o.created_by   || ''
      };
    });

    Logger.log('getOrdersListFromSupabase - Returned ' + orders.length + ' orders');
    return orders;

  } catch (e) {
    Logger.log('getOrdersListFromSupabase - ERROR: ' + e.toString() + ' — falling back to Sheets');
    return getOrdersList(); // Fallback to Sheets list on error
  }
}

/**
 * Delete an order from Supabase (cascade removes all its items).
 */
function deleteOrderFromSupabase(orderId) {
  if (!orderId) return { success: false, error: 'Order ID required' };

  try {
    supabaseRequest_('DELETE', 'orders?id=eq.' + encodeURIComponent(orderId));
    Logger.log('deleteOrderFromSupabase - Deleted order: ' + orderId);
    return { success: true };
  } catch (e) {
    Logger.log('deleteOrderFromSupabase - ERROR: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Rename an order in Supabase.
 */
function renameOrderInSupabase(orderId, newTitle) {
  if (!orderId || !newTitle) return { success: false, error: 'orderId and newTitle required' };

  try {
    supabaseRequest_('PATCH',
      'orders?id=eq.' + encodeURIComponent(orderId),
      { title: newTitle, last_edited: new Date().toISOString() });
    Logger.log('renameOrderInSupabase - Renamed ' + orderId + ' → "' + newTitle + '"');
    return { success: true };
  } catch (e) {
    Logger.log('renameOrderInSupabase - ERROR: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * ONE-TIME MIGRATION: copies all orders from Google Sheets into Supabase.
 * Run manually from Apps Script Editor after deploying the Supabase changes.
 * Returns { total, migrated, failed[] }
 */
function migrateOrdersToSupabase() {
  Logger.log('=== MIGRATE ORDERS TO SUPABASE ===');

  var list = getOrdersList();
  Logger.log('Found ' + list.length + ' orders in Sheets');

  var migrated = 0;
  var failed   = [];

  list.forEach(function(meta) {
    try {
      // Fetch full order data from Sheets
      var result = getOrderV2(meta.id);
      if (result.error || !result.order) {
        Logger.log('SKIP ' + meta.id + ': ' + (result.error || 'no order returned'));
        failed.push({ id: meta.id, error: result.error || 'no order' });
        return;
      }

      var items = result.items || [];

      // Enrich song items with masterLyrics from the Songs sheet
      var songSourceIds = [];
      items.forEach(function(item) {
        if (item.itemType === 'song' && item.sourceId &&
            !(item.customizations && item.customizations.masterLyrics)) {
          songSourceIds.push(item.sourceId);
        }
      });

      if (songSourceIds.length > 0) {
        var lyricsMap = getSongLyricsBatch(songSourceIds);
        items.forEach(function(item) {
          if (item.itemType === 'song' && item.sourceId && lyricsMap[item.sourceId]) {
            if (!item.customizations) item.customizations = {};
            item.customizations.masterLyrics = lyricsMap[item.sourceId].lyrics || '';
          }
        });
      }

      var orderPayload = {
        id:          result.order.id,
        title:       result.order.title,
        type:        result.order.type,
        serviceDate: result.order.serviceDate,
        template:    result.order.template || {},
        createdDate: result.order.createdDate,
        createdBy:   result.order.createdBy || '',
        items:       items
      };

      var saveResult = saveOrderToSupabase(orderPayload);
      if (saveResult.success) {
        migrated++;
        Logger.log('Migrated: ' + meta.title + ' (' + items.length + ' items)');
      } else {
        failed.push({ id: meta.id, error: saveResult.error });
        Logger.log('FAILED: ' + meta.title + ' — ' + saveResult.error);
      }

    } catch (e) {
      failed.push({ id: meta.id, error: e.toString() });
      Logger.log('ERROR: ' + meta.id + ' — ' + e.toString());
    }
  });

  var summary = { total: list.length, migrated: migrated, failed: failed };
  Logger.log('=== MIGRATION COMPLETE: ' + migrated + '/' + list.length + ' migrated ===');
  if (failed.length > 0) Logger.log('Failed: ' + JSON.stringify(failed));
  return summary;
}

// ================================================================
// SONG MIGRATION — run once from Apps Script Editor after songs
// table is created in Supabase (Step 0 SQL).
// ================================================================

/**
 * ONE-TIME: Copies all songs from Google Sheets → Supabase songs table.
 * Run from Apps Script Editor. Returns { total, migrated, failed[] }.
 */
function migrateSongsToSupabase() {
  Logger.log('=== MIGRATE SONGS TO SUPABASE ===');

  var songs;
  try {
    songs = getSongs();
  } catch (e) {
    return { total: 0, migrated: 0, failed: [{ error: 'getSongs failed: ' + e.toString() }] };
  }

  var results = { total: songs.length, migrated: 0, failed: [] };

  songs.forEach(function(song) {
    try {
      var row = {
        id:          song.id,
        title:       song.title        || '',
        artist:      song.artist       || '',
        theme:       song.theme        || '',
        key:         song.key          || '',
        tempo:       song.tempo        || '',
        style:       song.style        || song.category || '',
        season:      song.season       || '',
        lyrics:      song.lyrics       || '',
        youtube:     Array.isArray(song.youtube) ? song.youtube : [],
        attachments: Array.isArray(song.attachments) ? song.attachments : [],
        use_count:   song.useCount     || song.use_count || 0,
        last_used:   song.lastUsed     || '',
        date_added:  song.dateAdded    || '',
        last_edited: song.lastEdited   || ''
      };

      supabaseRequest_('POST', 'songs', row, {
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      });
      results.migrated++;
    } catch (e) {
      results.failed.push({ id: song.id, title: song.title, error: e.toString() });
      Logger.log('FAILED song ' + song.id + ': ' + e.toString());
    }
  });

  Logger.log('=== SONGS MIGRATION COMPLETE: ' + results.migrated + '/' + results.total + ' ===');
  if (results.failed.length > 0) Logger.log('Failed: ' + JSON.stringify(results.failed));
  return results;
}

// ----------------------------------------------------------------
// One-time migration: copy all Roster + RosterChanges rows to Supabase
// Run once from Apps Script editor after creating the roster + roster_changes tables
// ----------------------------------------------------------------
function migrateRosterToSupabase() {
  Logger.log('=== MIGRATE ROSTER TO SUPABASE ===');

  // Migrate all years in sheet (no month/year filter → pass undefined)
  var entries;
  try {
    entries = getRosterData(undefined, undefined);
  } catch (e) {
    return { total: 0, migrated: 0, failed: [{ error: 'getRosterData failed: ' + e.toString() }] };
  }

  var results = { total: entries.length, migrated: 0, failed: [] };

  entries.forEach(function(entry) {
    try {
      var row = {
        role_id:    entry.roleId,
        date:       entry.date,
        value:      entry.value || '',
        month:      entry.month,
        year:       entry.year,
        updated_at: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString()
      };
      supabaseRequest_('POST', 'roster', row, {
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      });
      results.migrated++;
    } catch (e) {
      results.failed.push({ roleId: entry.roleId, date: entry.date, error: e.toString() });
      Logger.log('FAILED roster entry ' + entry.roleId + '/' + entry.date + ': ' + e.toString());
    }
  });

  Logger.log('=== ROSTER MIGRATION COMPLETE: ' + results.migrated + '/' + results.total + ' ===');
  if (results.failed.length > 0) Logger.log('Failed: ' + JSON.stringify(results.failed));

  // Also migrate RosterChanges if sheet exists
  var changesResults = { total: 0, migrated: 0, failed: [] };
  try {
    var ss = getSpreadsheet_();
    var changesSheet = ss.getSheetByName('RosterChanges');
    if (changesSheet) {
      var cData = changesSheet.getDataRange().getValues();
      if (cData.length > 1) {
        var cHeader = cData[0];
        var cIdx = buildHeaderIndex_(cHeader);
        changesResults.total = cData.length - 1;
        for (var r = 1; r < cData.length; r++) {
          try {
            var row = cData[r];
            var changeRow = {
              role_id:      String(row[cIdx['roleid'] !== undefined ? cIdx['roleid'] : 0] || ''),
              service_date: String(row[cIdx['servicedate'] !== undefined ? cIdx['servicedate'] : 1] || ''),
              old_value:    String(row[cIdx['oldvalue'] !== undefined ? cIdx['oldvalue'] : 2] || ''),
              new_value:    String(row[cIdx['newvalue'] !== undefined ? cIdx['newvalue'] : 3] || ''),
              month:        parseInt(row[cIdx['month'] !== undefined ? cIdx['month'] : 4]) || 0,
              year:         parseInt(row[cIdx['year'] !== undefined ? cIdx['year'] : 5]) || 0
            };
            supabaseRequest_('POST', 'roster_changes', changeRow, {
              'Prefer': 'return=minimal'
            });
            changesResults.migrated++;
          } catch (e2) {
            changesResults.failed.push({ row: r, error: e2.toString() });
          }
        }
      }
    }
  } catch (e) {
    Logger.log('RosterChanges migration skipped/failed: ' + e.toString());
  }

  Logger.log('=== ROSTER CHANGES MIGRATION: ' + changesResults.migrated + '/' + changesResults.total + ' ===');
  return { roster: results, rosterChanges: changesResults };
}

// ================================================================
// SETTINGS - Generic key-value store in Google Sheets
// Sheet: Settings | Columns: key, value, updatedAt
// ================================================================

function getOrCreateSettingsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SETTINGS_SHEET);
    sheet.appendRow(['key', 'value', 'updatedAt']);
    sheet.getRange('1:1').setFontWeight('bold');
  }
  return sheet;
}

function getSettingValue_(key) {
  var sheet = getOrCreateSettingsSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      try {
        return JSON.parse(data[i][1]);
      } catch(e) {
        return data[i][1];
      }
    }
  }
  return null;
}

function setSettingValue_(key, value) {
  var sheet = getOrCreateSettingsSheet_();
  var data = sheet.getDataRange().getValues();
  var jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
  var now = new Date().toISOString();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(jsonValue);
      sheet.getRange(i + 1, 3).setValue(now);
      return;
    }
  }
  // Key not found, append new row
  sheet.appendRow([key, jsonValue, now]);
}

// ================================================================
// ROSTER NAMES - Cloud storage for dropdown name options
// ================================================================

function getRosterNames() {
  var names = getSettingValue_('lhc_roster_names');
  return names || {
    preacher: [], liturgist: [], usher: [], reader: [],
    communion: [], altar: [], musician: [], singer: [],
    tech: [], general: []
  };
}

function saveRosterNames(namesObj) {
  setSettingValue_('lhc_roster_names', namesObj);
  return { success: true };
}

// ================================================================
// BACKGROUNDS - Cloud storage for projection backgrounds
// Files stored in Google Drive, metadata in Sheets
// Sheet: Backgrounds | Columns: id, name, type, driveFileId, mimeType, size, createdAt
// ================================================================

// Unified Drive folder: single parent "LHC Worship Files" with subfolders
function getOrCreateDriveFolder_(subfolderName) {
  var rootName = CONFIG.DRIVE_ROOT_FOLDER;
  var rootFolders = DriveApp.getFoldersByName(rootName);
  var rootFolder;
  if (rootFolders.hasNext()) {
    rootFolder = rootFolders.next();
  } else {
    rootFolder = DriveApp.createFolder(rootName);
  }
  if (!subfolderName) return rootFolder;

  var subFolders = rootFolder.getFoldersByName(subfolderName);
  if (subFolders.hasNext()) {
    return subFolders.next();
  }
  return rootFolder.createFolder(subfolderName);
}

// Embeddable URL for Drive files (works in img, iframe, video, audio tags)
function getDriveEmbedUrl_(fileId) {
  return 'https://drive.google.com/uc?export=view&id=' + fileId;
}

// Settings-aware folder resolver: checks Settings sheet for user-configured folder ID,
// falls back to default subfolder under "LHC Worship Files"
function getDriveFolder_(settingKey, fallbackSubfolder) {
  var folderId = getSettingValue_(settingKey);
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      Logger.log('Configured folder ' + settingKey + ' not accessible: ' + e);
    }
  }
  return getOrCreateDriveFolder_(fallbackSubfolder);
}

function getOrCreateBgFolder_() {
  return getDriveFolder_('drive_folder_backgrounds', 'Backgrounds');
}

function getOrCreateBackgroundsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.BACKGROUNDS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.BACKGROUNDS_SHEET);
    sheet.appendRow(['id', 'name', 'type', 'driveFileId', 'mimeType', 'size', 'createdAt']);
    sheet.getRange('1:1').setFontWeight('bold');
  }
  return sheet;
}

function saveBackgroundToCloud(bgData) {
  // bgData: { id, name, type, data (base64 dataUrl), mimeType }
  if (!bgData || !bgData.data) {
    return { success: false, error: 'No data provided' };
  }

  var folder = getOrCreateBgFolder_();

  // Parse data URL: "data:image/png;base64,iVBOR..."
  var dataUrl = bgData.data;
  var matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    return { success: false, error: 'Invalid data URL format' };
  }

  var mimeType = matches[1];
  var base64Data = matches[2];
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, bgData.name || bgData.id);

  // Save file to Drive
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var driveFileId = file.getId();
  var size = file.getSize();

  // Save metadata to sheet
  var sheet = getOrCreateBackgroundsSheet_();
  var now = new Date().toISOString();
  sheet.appendRow([
    bgData.id || ('bg_' + Date.now()),
    bgData.name || 'Untitled',
    bgData.type || 'image',
    driveFileId,
    mimeType,
    size,
    now
  ]);

  // Build accessible URL
  var url = 'https://drive.google.com/uc?export=view&id=' + driveFileId;

  return {
    success: true,
    id: bgData.id,
    driveFileId: driveFileId,
    url: url,
    size: size
  };
}

function getCloudBackgrounds() {
  var sheet;
  try {
    sheet = getOrCreateBackgroundsSheet_();
  } catch(e) {
    return [];
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var idx = {};
  header.forEach(function(h, i) { idx[String(h).toLowerCase().trim()] = i; });

  var backgrounds = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var driveFileId = row[idx['drivefileid']] || row[3];
    if (!driveFileId) continue;

    backgrounds.push({
      id: row[idx['id']] || row[0],
      name: row[idx['name']] || row[1],
      type: row[idx['type']] || row[2] || 'image',
      driveFileId: driveFileId,
      mimeType: row[idx['mimetype']] || row[4] || 'image/png',
      size: row[idx['size']] || row[5] || 0,
      url: 'https://drive.google.com/uc?export=view&id=' + driveFileId,
      createdAt: row[idx['createdat']] || row[6] || ''
    });
  }

  return backgrounds;
}

function deleteCloudBackground(bgId) {
  var sheet = getOrCreateBackgroundsSheet_();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === bgId) {
      var driveFileId = data[i][3];

      // Delete from Drive
      if (driveFileId) {
        try {
          DriveApp.getFileById(driveFileId).setTrashed(true);
        } catch(e) {
          Logger.log('Could not delete Drive file: ' + e.toString());
        }
      }

      // Delete row from sheet
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  return { success: false, error: 'Background not found: ' + bgId };
}

// ================================================================
// SECTION BACKGROUND ASSIGNMENTS - stored in Settings
// ================================================================

function getSectionBackgrounds() {
  return getSettingValue_('lhc_section_backgrounds') || {};
}

function saveSectionBackgrounds(assignments) {
  setSettingValue_('lhc_section_backgrounds', assignments);
  return { success: true };
}

// ================================================================
// BIBLE PASSAGE LOOKUP (uses bible-api.com - no API key needed)
// Supports KJV translation (public domain)
// ================================================================

function fetchBiblePassage(reference, translation) {
  // reference format: "John 3:16" or "John 3:16-18" or "Psalm 23"
  // translation: "esv" (default), "kjv", "web"
  translation = translation || 'esv';

  // Check cache first
  var cacheKey = 'bible_' + translation + '_' + reference.replace(/\s+/g, '_');
  var cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  try {
    // ESV uses Crossway's dedicated API (api.esv.org)
    if (translation === 'esv') {
      return fetchEsvPassage_(reference, cacheKey);
    }

    // KJV/WEB use bible-api.com (free, no key)
    var url = 'https://bible-api.com/' + encodeURIComponent(reference) + '?translation=' + translation;
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (response.getResponseCode() !== 200) {
      return { error: 'Could not find passage: ' + reference };
    }

    var data = JSON.parse(response.getContentText());

    var text = '';
    if (data.verses && data.verses.length > 0) {
      text = data.verses.map(function(v) {
        return '[' + v.verse + '] ' + v.text.trim();
      }).join('\n');
    } else {
      text = data.text || '';
    }

    var result = {
      reference: data.reference || reference,
      text: text,
      translation: data.translation_name || translation.toUpperCase(),
      verseCount: data.verses ? data.verses.length : 0
    };

    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600);
    return result;
  } catch(e) {
    return { error: e.toString() };
  }
}

// Fetch from ESV API (api.esv.org) — free for ministry use
function fetchEsvPassage_(reference, cacheKey) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ESV_API_KEY');
  if (!apiKey) {
    return { error: 'ESV API key not configured. Go to Apps Script > Project Settings > Script Properties and add ESV_API_KEY. Get a free key at https://api.esv.org/' };
  }

  var url = 'https://api.esv.org/v3/passage/text/?' +
    'q=' + encodeURIComponent(reference) +
    '&include-headings=false' +
    '&include-footnotes=false' +
    '&include-verse-numbers=true' +
    '&include-short-copyright=false' +
    '&include-passage-references=false';

  var response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Token ' + apiKey },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return { error: 'ESV API error: ' + response.getContentText() };
  }

  var data = JSON.parse(response.getContentText());

  if (!data.passages || data.passages.length === 0) {
    return { error: 'Could not find passage: ' + reference };
  }

  // ESV API returns passage text with inline [verse_num] markers
  // Parse them into our standard format: [1] verse text per line
  var rawText = data.passages[0].trim();
  var lines = [];
  // Split on verse number markers like [1], [2], etc.
  var parts = rawText.split(/\[(\d+)\]\s*/);
  // parts: ["", "1", "verse1 text", "2", "verse2 text", ...]
  var verseCount = 0;
  for (var i = 1; i < parts.length; i += 2) {
    var verseNum = parts[i];
    var verseText = (parts[i + 1] || '').trim().replace(/\s+/g, ' ');
    if (verseText) {
      lines.push('[' + verseNum + '] ' + verseText);
      verseCount++;
    }
  }

  var text = lines.length > 0 ? lines.join('\n') : rawText;

  var result = {
    reference: data.canonical || reference,
    text: text,
    translation: 'English Standard Version (ESV)',
    verseCount: verseCount || lines.length
  };

  CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600);
  return result;
}

// ===================================================================
// LITURGY ITEMS - Cloud Storage (per screenshot 267)
// ===================================================================

var LITURGY_ITEMS_SHEET = 'LiturgyItems';
var LITURGY_FOLDERS_SHEET = 'LiturgyFolders';
var LITURGY_ITEMS_HEADERS = ['id', 'title', 'type', 'content', 'tags', 'folderId', 'sectionAssignment', 'fileName', 'fileUrl', 'fileSize', 'storageProvider', 'storagePath', 'createdDate', 'modifiedDate', 'createdBy'];
var LITURGY_FOLDERS_HEADERS = ['id', 'name', 'categoryType', 'parentId', 'collapsed', 'createdDate'];

function getLiturgyItems() {
  try {
    var sheet = ensureSheet_(LITURGY_ITEMS_SHEET, LITURGY_ITEMS_HEADERS);
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    var header = data[0];
    var idx = buildHeaderIndex_(header);
    var items = [];

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var id = String(row[findColumn_(idx, ['id'])] || '').trim();
      if (!id) continue;

      // Normalize fileUrl: convert old Drive viewer URLs to embeddable format
      var rawFileUrl = String(row[findColumn_(idx, ['fileurl'])] || '') || null;
      if (rawFileUrl) {
        var driveMatch = rawFileUrl.match(/\/file\/d\/([^\/]+)/);
        if (driveMatch && rawFileUrl.indexOf('uc?export=') === -1) {
          rawFileUrl = getDriveEmbedUrl_(driveMatch[1]);
        }
      }

      items.push({
        id: id,
        title: String(row[findColumn_(idx, ['title'])] || ''),
        type: String(row[findColumn_(idx, ['type'])] || 'liturgy'),
        content: String(row[findColumn_(idx, ['content'])] || ''),
        tags: safeParseJSON_(row[findColumn_(idx, ['tags'])], []),
        folderId: String(row[findColumn_(idx, ['folderid'])] || '') || null,
        sectionAssignment: safeParseJSON_(row[findColumn_(idx, ['sectionassignment'])], null),
        fileName: String(row[findColumn_(idx, ['filename'])] || '') || null,
        fileUrl: rawFileUrl,
        fileSize: parseInt(row[findColumn_(idx, ['filesize'])] || 0, 10) || 0,
        storageProvider: String(row[findColumn_(idx, ['storageprovider'])] || '') || null,
        storagePath: String(row[findColumn_(idx, ['storagepath'])] || '') || null,
        created: new Date(row[findColumn_(idx, ['createddate'])] || Date.now()).getTime(),
        modified: new Date(row[findColumn_(idx, ['modifieddate'])] || Date.now()).getTime()
      });
    }

    Logger.log('getLiturgyItems: returning ' + items.length + ' items from ' + (data.length - 1) + ' rows');
    return items;
  } catch (e) {
    Logger.log('getLiturgyItems error: ' + e.toString());
    return [];
  }
}

function saveLiturgyItem(item) {
  if (!item || !item.id) return { success: false, error: 'Item ID required' };

  try {
    var sheet = ensureSheet_(LITURGY_ITEMS_SHEET, LITURGY_ITEMS_HEADERS);
    var userEmail = Session.getActiveUser().getEmail() || 'anonymous';
    var now = new Date();

    var rowData = {
      id: item.id,
      title: item.title || '',
      type: item.type || 'liturgy',
      content: item.content || '',
      tags: JSON.stringify(item.tags || []),
      folderId: item.folderId || '',
      sectionAssignment: JSON.stringify(item.sectionAssignment || null),
      fileName: item.fileName || '',
      fileUrl: item.fileUrl || '',
      fileSize: item.fileSize || 0,
      storageProvider: item.storageProvider || '',
      storagePath: item.storagePath || '',
      createdDate: item.created ? new Date(item.created) : now,
      modifiedDate: now,
      createdBy: userEmail
    };

    findOrCreateRow_(sheet, item.id, rowData);
    return { success: true, id: item.id };
  } catch (e) {
    Logger.log('saveLiturgyItem error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

function deleteLiturgyItem(itemId) {
  if (!itemId) return { success: false, error: 'Item ID required' };

  try {
    var sheet = ensureSheet_(LITURGY_ITEMS_SHEET, LITURGY_ITEMS_HEADERS);
    var data = sheet.getDataRange().getValues();
    var idx = buildHeaderIndex_(data[0]);
    var colId = findColumn_(idx, ['id']);

    for (var r = data.length - 1; r >= 1; r--) {
      if (String(data[r][colId]).trim() === String(itemId).trim()) {
        sheet.deleteRow(r + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'Item not found' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function saveLiturgyItemsBatch(items) {
  if (!items || !Array.isArray(items)) return { success: false, error: 'Items array required' };

  // Guard: never wipe all data with an empty array — that would delete everything
  if (items.length === 0) {
    Logger.log('saveLiturgyItemsBatch: skipping save of empty items array to protect data');
    return { success: true, count: 0, skipped: true };
  }

  try {
    var sheet = ensureSheet_(LITURGY_ITEMS_SHEET, LITURGY_ITEMS_HEADERS);
    var userEmail = Session.getActiveUser().getEmail() || 'anonymous';
    var now = new Date();

    // Always rewrite headers to guarantee correct column order
    sheet.getRange(1, 1, 1, LITURGY_ITEMS_HEADERS.length).setValues([LITURGY_ITEMS_HEADERS]);

    // Clear existing data rows
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, LITURGY_ITEMS_HEADERS.length)).clearContent();
    }

    var rows = items.map(function(item) {
      return [
        item.id || '',
        item.title || '',
        item.type || 'liturgy',
        item.content || '',
        JSON.stringify(item.tags || []),
        item.folderId || '',
        JSON.stringify(item.sectionAssignment || null),
        item.fileName || '',
        item.fileUrl || '',
        item.fileSize || 0,
        item.storageProvider || '',
        item.storagePath || '',
        item.created ? new Date(item.created) : now,
        now,
        userEmail
      ];
    });
    sheet.getRange(2, 1, rows.length, LITURGY_ITEMS_HEADERS.length).setValues(rows);
    Logger.log('saveLiturgyItemsBatch: wrote ' + rows.length + ' items with ' + LITURGY_ITEMS_HEADERS.length + ' columns');

    return { success: true, count: items.length };
  } catch (e) {
    Logger.log('saveLiturgyItemsBatch error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

function getLiturgyFolders() {
  try {
    var sheet = ensureSheet_(LITURGY_FOLDERS_SHEET, LITURGY_FOLDERS_HEADERS);
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { prayer: [], scripture: [], liturgy: [], creed: [], documents: [] };

    var idx = buildHeaderIndex_(data[0]);
    var folders = { prayer: [], scripture: [], liturgy: [], creed: [], documents: [] };

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var id = String(row[findColumn_(idx, ['id'])] || '').trim();
      if (!id) continue;

      var cat = String(row[findColumn_(idx, ['categorytype'])] || 'liturgy');
      if (!folders[cat]) folders[cat] = [];

      folders[cat].push({
        id: id,
        name: String(row[findColumn_(idx, ['name'])] || ''),
        parentId: String(row[findColumn_(idx, ['parentid'])] || '') || null,
        collapsed: String(row[findColumn_(idx, ['collapsed'])] || '') === 'true'
      });
    }

    return folders;
  } catch (e) {
    Logger.log('getLiturgyFolders error: ' + e.toString());
    return { prayer: [], scripture: [], liturgy: [], creed: [], documents: [] };
  }
}

function saveLiturgyFolders(foldersObj) {
  if (!foldersObj) return { success: false, error: 'Folders object required' };

  try {
    var sheet = ensureSheet_(LITURGY_FOLDERS_SHEET, LITURGY_FOLDERS_HEADERS);
    var now = new Date();

    // Clear existing data (keep header)
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }

    // Flatten all categories into rows
    var rows = [];
    var cats = ['prayer', 'scripture', 'liturgy', 'creed', 'documents'];
    cats.forEach(function(cat) {
      var catFolders = foldersObj[cat] || [];
      catFolders.forEach(function(folder) {
        rows.push([
          folder.id || '',
          folder.name || '',
          cat,
          folder.parentId || '',
          folder.collapsed ? 'true' : 'false',
          now
        ]);
      });
    });

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, LITURGY_FOLDERS_HEADERS.length).setValues(rows);
    }

    return { success: true, count: rows.length };
  } catch (e) {
    Logger.log('saveLiturgyFolders error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// Upload file to Google Drive and return URL
function uploadLiturgyFile(fileName, base64Data, mimeType) {
  try {
    var folder = getDriveFolder_('drive_folder_documents', 'Documents');
    Logger.log('uploadLiturgyFile: using folder "' + folder.getName() + '" (id: ' + folder.getId() + ')');

    // Decode base64 data (strip data URL prefix if present)
    var base64Content = base64Data;
    if (base64Data.indexOf(',') !== -1) {
      base64Content = base64Data.split(',')[1];
    }

    if (!base64Content || base64Content.length === 0) {
      return { success: false, error: 'Empty file data received' };
    }

    var decoded = Utilities.base64Decode(base64Content);
    Logger.log('uploadLiturgyFile: decoded ' + decoded.length + ' bytes for "' + fileName + '"');
    var blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', fileName);
    var file = folder.createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(shareErr) {
      Logger.log('Could not set sharing (may be in shared drive): ' + shareErr);
    }

    var fileId = file.getId();
    var embedUrl = getDriveEmbedUrl_(fileId);

    return {
      success: true,
      fileId: fileId,
      fileUrl: embedUrl,
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + fileId,
      viewUrl: embedUrl
    };
  } catch (e) {
    Logger.log('uploadLiturgyFile error: ' + e.toString() + '\nStack: ' + e.stack);
    return { success: false, error: e.toString() };
  }
}

// ── 350 — Export any Drive file (Google Doc/Sheet/Slide or PDF) as base64 PDF ──
// Called from sbGeneratePrint() via google.script.run to fetch all pages of a document.
function getDocumentAsPdf(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    var mimeType = file.getMimeType();
    var blob;
    if (
      mimeType === 'application/vnd.google-apps.document' ||
      mimeType === 'application/vnd.google-apps.spreadsheet' ||
      mimeType === 'application/vnd.google-apps.presentation'
    ) {
      blob = file.getAs('application/pdf');
    } else {
      blob = file.getBlob();
    }
    return {
      success: true,
      base64: Utilities.base64Encode(blob.getBytes()),
      name: file.getName(),
      mimeType: 'application/pdf'
    };
  } catch (e) {
    Logger.log('getDocumentAsPdf error for ' + fileId + ': ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ── Roster Names: shared cloud storage for per-category name suggestions ──
// Sheet structure: two columns — category (string) | names (JSON array)

function getRosterNames() {
  try {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(CONFIG.ROSTER_NAMES_SHEET);
    if (!sheet) return {};
    var data = sheet.getDataRange().getValues();
    var result = {};
    for (var r = 1; r < data.length; r++) {
      var cat = String(data[r][0]).trim();
      var namesRaw = String(data[r][1]).trim();
      if (!cat) continue;
      try { result[cat] = JSON.parse(namesRaw); } catch(e) { result[cat] = []; }
    }
    return result;
  } catch (e) {
    Logger.log('getRosterNames error: ' + e.toString());
    return {};
  }
}

function saveRosterNames(nameOptions) {
  try {
    if (!nameOptions || typeof nameOptions !== 'object') return { success: false, error: 'Invalid input' };
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(CONFIG.ROSTER_NAMES_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.ROSTER_NAMES_SHEET);
      sheet.getRange(1, 1, 1, 2).setValues([['category', 'names']]);
      sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    }
    // Clear existing data rows, keep header
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
    // Write categories
    var rows = [];
    Object.keys(nameOptions).forEach(function(cat) {
      var names = nameOptions[cat];
      if (Array.isArray(names)) rows.push([cat, JSON.stringify(names)]);
    });
    if (rows.length > 0) sheet.getRange(2, 1, rows.length, 2).setValues(rows);
    return { success: true };
  } catch (e) {
    Logger.log('saveRosterNames error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ================================================================
// 662 — FETCH PAGE TEXT: returns plain-text content of any URL (strips HTML)
// Called from frontend via callGAS('getWebPageText', [url])
// ================================================================
function getWebPageText(url) {
  if (!url || !/^https?:\/\//i.test(url)) return { error: 'Invalid URL' };
  try {
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    var code = response.getResponseCode();
    if (code >= 400) return { error: 'HTTP ' + code };
    var html = response.getContentText('UTF-8');
    // Remove scripts, styles, and non-content structural blocks
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '\n');
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<(nav|header|footer|aside|menu)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Convert block-level elements and line-break tags to newlines
    html = html.replace(/<br\s*\/?>/gi, '\n');
    html = html.replace(/<\/?(p|div|h[1-6]|li|tr|td|article|section|blockquote|pre)[^>]*>/gi, '\n');
    // Strip all remaining HTML tags
    html = html.replace(/<[^>]+>/g, '');
    // Decode common HTML entities (including hex like &#x27; &#x2019; from worshiptogether.com)
    html = html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x([0-9a-fA-F]+);/g, function(m, h) { try { return String.fromCharCode(parseInt(h,16)); } catch(e) { return ' '; } })
      .replace(/&#(\d+);/g, function(m, n) { try { return String.fromCharCode(parseInt(n,10)); } catch(e) { return ' '; } })
      // Normalize Unicode special chars that appear in copied text from lyric sites
      .replace(/\u00a0/g, ' ')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\u2013/g, '-')
      .replace(/\u2014/g, '--')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '');
    // Normalize: trim each line, collapse excessive blank lines
    var lines = html.split('\n');
    var out = [];
    var blanks = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) {
        if (blanks < 2) out.push('');
        blanks++;
      } else {
        out.push(l);
        blanks = 0;
      }
    }
    // Trim leading/trailing blank lines
    while (out.length && !out[0]) out.shift();
    while (out.length && !out[out.length-1]) out.pop();
    return { text: out.join('\n') };
  } catch(e) {
    return { error: e.toString() };
  }
}

// ================================================================
// 669 — AUTO SCREENSHOT: captures a full-page screenshot via screenshotone.com
// Free tier: 100 screenshots/month — get key at https://screenshotone.com
// Store key in Apps Script > Project Settings > Script Properties as SCREENSHOT_API_KEY
// Image is uploaded to Supabase storage and a public URL returned.
// ================================================================
function getWebPageScreenshot(url) {
  if (!url || !/^https?:\/\//i.test(url)) return { error: 'Invalid URL' };
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('SCREENSHOT_API_KEY');
  if (!apiKey) return { error: 'NO_KEY' };
  try {
    // ── Step 1: capture via screenshotone.com ──
    // Screenshot the original URL directly. The proxy approach caused screenshotone.com
    // to hit a Google redirect and capture HTML source instead of a rendered page.
    var apiUrl = 'https://api.screenshotone.com/take' +
      '?access_key='            + encodeURIComponent(apiKey) +
      '&url='                   + encodeURIComponent(url) +
      '&full_page=true' +
      '&format=jpg' +
      '&image_quality=80' +
      '&viewport_width=1280' +
      '&viewport_height=900' +
      '&timeout=30' +
      '&delay=3' +
      '&block_ads=true';
    var response = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code !== 200) {
      var rawText = '';
      try { rawText = response.getContentText(); } catch(x) {}
      try {
        var errBody = JSON.parse(rawText);
        return { error: 'HTTP ' + code + ': ' + (errBody.message || errBody.error_code || rawText.substring(0, 300)) };
      } catch(x) {}
      return { error: 'HTTP ' + code + ': ' + rawText.substring(0, 300) };
    }

    // ── Step 2: upload image bytes to Supabase storage ──
    var SUPABASE_URL    = 'https://jypzhumcdifxnazexdcu.supabase.co';
    var SUPABASE_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5cHpodW1jZGlmeG5hemV4ZGN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2OTA0MjQsImV4cCI6MjA4MzI2NjQyNH0.s3QxdQGmmEo44zlwdWsSQjjb1kkFQY2y_dVmNHM5_Sg';
    var SUPABASE_BUCKET = 'Liturgy Files';
    var filePath = 'snapshots/snap_' + new Date().getTime() + '.jpg';
    var uploadUrl   = SUPABASE_URL + '/storage/v1/object/' +
                      encodeURIComponent(SUPABASE_BUCKET) + '/' + filePath;
    var uploadResp = UrlFetchApp.fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type':  'image/jpeg',
        'x-upsert':      'true'
      },
      payload: response.getContent(),
      muteHttpExceptions: true
    });
    var upCode = uploadResp.getResponseCode();
    if (upCode < 200 || upCode >= 300) {
      return { error: 'Upload failed: HTTP ' + upCode };
    }

    // ── Step 3: return public URL ──
    var publicUrl = SUPABASE_URL + '/storage/v1/object/public/' +
                    encodeURIComponent(SUPABASE_BUCKET) + '/' + filePath;
    return { url: publicUrl };
  } catch(e) {
    return { error: e.toString() };
  }
}

// Run this directly in Apps Script editor to diagnose screenshot failures.
// Open Execution Log (View > Executions) after running to see the full output.
function testScreenshot() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('SCREENSHOT_API_KEY');
  Logger.log('API key present: ' + (apiKey ? 'YES (' + apiKey.length + ' chars)' : 'NO'));
  var testUrl = 'https://example.com';
  var base = 'https://api.screenshotone.com/take?access_key=' + encodeURIComponent(apiKey) +
    '&url=' + encodeURIComponent(testUrl) +
    '&format=jpg&image_quality=80&viewport_width=1280&viewport_height=900&timeout=30&delay=1';
  var variants = [
    ['base only', ''],
    ['+ full_page', '&full_page=true'],
    ['+ hide_cookie_banners', '&hide_cookie_banners=true'],
    ['+ block_ads', '&block_ads=true'],
    ['all three', '&full_page=true&hide_cookie_banners=true&block_ads=true']
  ];
  for (var i = 0; i < variants.length; i++) {
    var label = variants[i][0], extra = variants[i][1];
    var resp = UrlFetchApp.fetch(base + extra, { muteHttpExceptions: true });
    var code = resp.getResponseCode();
    if (code !== 200) {
      Logger.log(label + ' → HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
    } else {
      Logger.log(label + ' → OK (' + resp.getContent().length + ' bytes)');
    }
  }
}

// ================================================================
// WEBSITE PROXY — strips X-Frame-Options so sites embed in iframes
// Called via doGet when ?proxy=<encodedUrl> is present.
// ================================================================
function handleWebProxy_(targetUrl) {
  // Validate: only allow plain http/https URLs
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return ContentService
      .createTextOutput('<html><body style="font-family:sans-serif;padding:24px;color:#64748b;"><p>⚠️ Invalid URL.</p></body></html>')
      .setMimeType(ContentService.MimeType.HTML);
  }

  try {
    var response = UrlFetchApp.fetch(targetUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    var statusCode = response.getResponseCode();
    if (statusCode >= 400) {
      return ContentService
        .createTextOutput(
          '<html><body style="font-family:sans-serif;padding:24px;color:#64748b;">' +
          '<p>⚠️ Could not load page (HTTP ' + statusCode + ').</p>' +
          '<p><a href="' + targetUrl + '" target="_blank" style="color:#3b82f6;">Open in new tab ↗</a></p>' +
          '</body></html>'
        )
        .setMimeType(ContentService.MimeType.HTML);
    }

    var html = response.getContentText('UTF-8');

    // Extract the base origin so the injected <base> tag resolves relative URLs
    var originMatch = targetUrl.match(/^(https?:\/\/[^\/]+)/);
    var origin = originMatch ? originMatch[1] : '';
    // For path-relative URLs we need the directory, not just origin
    var dirBase = targetUrl.replace(/[^\/]*$/, '');

    // Inject <base href> so all relative links/images/CSS resolve to the original site
    var baseTag = '<base href="' + origin + '/" target="_blank">';

    // Inject banner-hiding CSS + link-targeting script.
    // This cleans up cookie/consent/popup overlays both for iframe preview
    // and for screenshotone.com when it screenshots the proxy URL.
    var injectStyle =
      '<style>' +
        '/* LHC Proxy — auto-hide cookie/consent/popup overlays */' +
        '[id*="cookie"],[class*="cookie"],' +
        '[id*="consent"],[class*="consent"],' +
        '[id*="gdpr"],[class*="gdpr"],' +
        '[id*="popup"],[class*="popup"],' +
        '[role="dialog"],[role="alertdialog"],' +
        '[id*="overlay"],[class*="overlay"],' +
        '[id*="modal"],[class*="modal"],' +
        '[class*="announcement"],[class*="notification-bar"],' +
        '[class*="promo-bar"],[class*="newsletter"],' +
        '[class*="subscribe"],[class*="banner-notice"],' +
        '#onetrust-consent-sdk,.cc-window,.cookieconsent,' +
        '#CybotCookiebotDialog{' +
          'display:none!important;visibility:hidden!important;' +
          'opacity:0!important;pointer-events:none!important;}' +
        'body{overflow:auto!important;overflow-x:hidden;}' +
      '</style>' +
      '<script>' +
        '(function(){' +
          'document.addEventListener("DOMContentLoaded",function(){' +
            // Make all links open in new tab (prevents navigation away from proxy)
            'document.querySelectorAll("a[href]").forEach(function(a){' +
              'if(!a.target)a.target="_blank";' +
            '});' +
            // Remove any remaining fixed/sticky overlay elements
            'document.querySelectorAll("*").forEach(function(el){' +
              'var s=getComputedStyle(el);' +
              'if((s.position==="fixed"||s.position==="sticky")&&' +
                 's.zIndex>100&&el.getBoundingClientRect().height<200){' +
                'el.style.display="none";' +
              '}' +
            '});' +
          '});' +
        '})();' +
      '<\/script>';

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/(<head[^>]*>)/i, '$1\n' + baseTag + '\n' + injectStyle);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/(<html[^>]*>)/i, '$1\n<head>' + baseTag + injectStyle + '</head>');
    } else {
      html = '<head>' + baseTag + injectStyle + '</head>\n' + html;
    }

    return ContentService.createTextOutput(html).setMimeType(ContentService.MimeType.HTML);

  } catch (err) {
    Logger.log('handleWebProxy_ error: ' + err.toString());
    return ContentService
      .createTextOutput(
        '<html><body style="font-family:sans-serif;padding:24px;color:#64748b;">' +
        '<p>⚠️ Could not load this page.</p>' +
        '<p style="font-size:0.85rem;color:#94a3b8;">' + err.message + '</p>' +
        '<p><a href="' + targetUrl + '" target="_blank" style="color:#3b82f6;">Open in new tab ↗</a></p>' +
        '</body></html>'
      )
      .setMimeType(ContentService.MimeType.HTML);
  }
}

// ================================================================
// PPTX → GOOGLE SLIDES CONVERSION + SLIDE THUMBNAILS
// ================================================================

/**
 * Returns the ordered pageIds (objectIds) for every slide in a presentation.
 * Fast — no image fetching. Used to enable per-slide iframe navigation.
 */
function getSlidePageIds(presentationId) {
  try {
    var presentation = Slides.Presentations.get(presentationId, { fields: 'slides.objectId' });
    if (!presentation || !presentation.slides) {
      return { error: 'No slides found' };
    }
    return {
      success: true,
      pageIds: presentation.slides.map(function(s) { return s.objectId; }),
      count: presentation.slides.length
    };
  } catch (e) {
    Logger.log('getSlidePageIds error: ' + e.toString());
    return { error: e.toString() };
  }
}

/**
 * Downloads a PPTX from Supabase, imports it as Google Slides,
 * makes it readable by anyone, and returns the presentationId + embedUrl.
 */
function convertPptxToGoogleSlides(supabaseUrl, fileName) {
  try {
    var response = UrlFetchApp.fetch(supabaseUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      return { error: 'Could not download file: HTTP ' + response.getResponseCode() };
    }

    var safeName = (fileName || 'Presentation').replace(/\.(pptx?|ppt)$/i, '');
    var blob = response.getBlob().setName(safeName);

    // Insert into Drive and convert to Google Slides in one step
    var file = Drive.Files.insert(
      { title: safeName, mimeType: 'application/vnd.google-apps.presentation' },
      blob
    );

    // Share with anyone (view only, with link)
    Drive.Permissions.insert(
      { role: 'reader', type: 'anyone', withLink: true },
      file.id
    );

    return {
      success: true,
      presentationId: file.id,
      embedUrl: 'https://docs.google.com/presentation/d/' + file.id + '/embed?start=false&loop=false&delayms=3000',
      slideCount: 0  // filled by getSlideImages
    };
  } catch (e) {
    Logger.log('convertPptxToGoogleSlides error: ' + e.toString());
    return { error: e.toString() };
  }
}

/**
 * Returns slide thumbnails as base64 data URLs (no expiry issue).
 * Step 1: fetch all contentUrls in parallel via fetchAll.
 * Step 2: download each image in parallel and encode as base64.
 * Uses MEDIUM size (480×270) for speed; still crisp on a projector.
 */
function getSlideImages(presentationId) {
  try {
    var token = ScriptApp.getOAuthToken();
    var presentation = Slides.Presentations.get(presentationId);
    if (!presentation || !presentation.slides) {
      return { error: 'No slides found in presentation' };
    }

    var slides = presentation.slides;

    // Fetch thumbnail contentUrls in one parallel batch — return URLs directly
    // so the browser loads images without GAS proxying them (avoids 50MB limit).
    var thumbRequests = slides.map(function(slide) {
      return {
        url: 'https://slides.googleapis.com/v1/presentations/' + presentationId +
             '/pages/' + slide.objectId +
             '/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE',
        headers: { 'Authorization': 'Bearer ' + token },
        muteHttpExceptions: true
      };
    });
    var thumbResponses = UrlFetchApp.fetchAll(thumbRequests);

    var thumbnails = [];
    thumbResponses.forEach(function(resp, idx) {
      if (resp.getResponseCode() === 200) {
        try {
          var d = JSON.parse(resp.getContentText());
          if (d.contentUrl) {
            thumbnails.push({ url: d.contentUrl, index: idx, pageId: slides[idx].objectId });
          }
        } catch (e) {}
      }
    });

    if (thumbnails.length === 0) {
      return { error: 'No thumbnails returned from Slides API' };
    }

    thumbnails.sort(function(a, b) { return a.index - b.index; });

    return {
      success: true,
      thumbnails: thumbnails,
      count: thumbnails.length,
      presentationId: presentationId
    };
  } catch (e) {
    Logger.log('getSlideImages error: ' + e.toString());
    return { error: e.toString() };
  }
}
