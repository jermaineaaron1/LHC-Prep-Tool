# LHC Worship Prep - Claude Code Context

## Project Overview

**LHC Worship Prep** is a comprehensive worship preparation web application for Luther House Chapel (a Lutheran church). It helps manage song libraries, worship rosters, and service planning.

- **Version**: 2.8
- **Stack**: Google Apps Script (backend) + HTML/CSS/JavaScript (frontend)
- **Database**: Google Sheets
- **Deployment**: Google Apps Script Web App

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Google Apps Script                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  server.gs  │────│ Google      │────│  Web App (HTML) │  │
│  │  (Backend)  │    │ Sheets DB   │    │  index.html     │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Google Sheets Structure

| Sheet Name | Purpose |
|------------|---------|
| `Songs` | Song library with metadata, lyrics, attachments |
| `Roster` | Monthly duty assignments |
| `RosterChanges` | Change log for roster updates (v2.8) |
| `RosterHistory` | Historical roster entries (v2.8) |
| `Orders` | Worship order templates (future) |

## File Structure

```
/
├── index.html      # Complete frontend (~4000 lines)
│   ├── Part 1-2: Layout, CSS, Sidebar, Main Views
│   ├── Part 3: Modal styles, Add/Edit Song, Lyrics Editor
│   ├── Part 4: Preview modals, Share/Help, Theme multi-select
│   ├── Part 4.5: Context menu, roster history, updates rendering
│   ├── Part 5: Main JS - Song Finder logic, CRUD operations
│   └── Part 6: RosterEngine - roster table, editing, sharing
│
└── server.gs       # Backend API (~900 lines)
    ├── doGet() - Serves web app
    ├── Song CRUD - getSongs, createSong, updateSong, deleteSong
    ├── Roster - getRosterData, saveRosterEdits, getRosterUpdates
    └── Utilities - sheet helpers, date formatting
```

## Main Features

### 1. Song Finder
- Search songs by title (prefix matching)
- Filter by Theme, Key, Style, Tempo, Season
- Multiple YouTube links per song
- Multiple document attachments per song
- Inline lyrics editor with section markers
- Chord transposition in preview
- Song statistics (most used, recent, newest)

### 2. Worship Roster
- Monthly calendar view with service dates
- Editable cells (double-click to edit)
- Role categories: Worship Enablers, Scripture, Communion, Music, Tech
- Liturgical day tracking with altar colors
- Context menu with change history
- WhatsApp sharing per service date
- CSV export

### 3. Worship Orders (Partial)
- Create orders from roster dates
- Template selection
- Full-screen presentation mode (planned)

## Known Issues (Fixed)

### Issue 1: Song Card Display Problems ✅ FIXED (2025-01-17)
**Symptoms**: Songs may not display correctly in the list view
**Root Causes Found**:
- `normalizeSong()` looked for `song.category` but backend returns `style`
- `normalizeSong()` looked for `song.usageCount` but backend returns `useCount`
- `youtube` field returned as array but `renderSongs()` called `.split()` on it
- `attachments` array from backend was not mapped

**Fixes Applied**:
1. Updated `normalizeSong()` (~line 1065) to:
   - Map `song.style || song.category` to `category`
   - Map `song.useCount || song.usageCount` to `useCount`
   - Handle `youtube` as array (convert string to array if needed)
   - Map `attachments` array from backend
2. Updated `renderSongs()` (~line 1207) to:
   - Use array `.filter()` instead of `.split()` for youtube links
   - Use `song.attachments` array instead of splitting `lyricsUrl`

### Issue 2: Roster Updates Not Loading in Sidebar ✅ FIXED (2025-01-17)
**Symptoms**: "Loading updates..." shows indefinitely or shows mock data
**Root Causes Found**:
- `renderRosterUpdates()` function was called but never defined
- HTML elements `songStatsSection`, `rosterUpdatesSection`, `songStatsContainer`, `rosterUpdatesContainer` were missing

**Fixes Applied**:
1. Added `window.renderRosterUpdates()` function (~line 1098) that:
   - Renders updates with duty, date, and change visualization
   - Shows relative timestamps (e.g., "2h ago")
   - Adds `data-role` and `data-date` attributes for highlighting
2. Added HTML sidebar sections (lines 9-46):
   - `songStatsSection` with stat tabs (Most Used, Recent, Newest)
   - `rosterUpdatesSection` with updates container
   - Supporting CSS for styling and animations
3. Added helper functions: `getTimeAgo()`, `escapeUpdateHtml()`

**Note**: For real roster updates to appear, the `RosterChanges` sheet must exist. Run `setupRosterChangesSheet()` in Apps Script Editor to create it.

## Key Functions Reference

### Frontend (index.html)

```javascript
// View Management
setActiveView(viewId)              // Switch between views
renderSongs(hideEmptyState)        // Render song list
renderSongStats()                  // Render sidebar statistics

// Song Operations
openEditSongModal(songId)          // Open edit modal
saveEditSong()                     // Save edited song
saveNewSong()                      // Create new song
deleteSong()                       // Delete song

// Roster
RosterEngine.init()                // Initialize roster view
RosterEngine.render()              // Render roster table
RosterEngine.editCell(td)          // Edit a cell
RosterEngine.saveChanges()         // Save to backend

// Utilities
callGAS(functionName, args)        // Call backend function
showToast(message, type)           // Show notification
showLoader(visible)                // Show/hide loading indicator
```

### Backend (server.gs)

```javascript
// Songs
getSongs()                         // Get all songs
createSong(song)                   // Create new song
updateSong(song)                   // Update existing song
deleteSong(songId)                 // Delete song
updateSongLyrics(songId, lyrics)   // Update lyrics only

// Roster
getRosterData(month, year)         // Get roster for month
saveRosterEdits(editsArray)        // Save roster changes
getRosterUpdates()                 // Get recent changes for sidebar
getRosterHistory(roleId, date)     // Get cell history

// Utilities
getSheet_(name)                    // Get sheet by name
buildHeaderIndex_(headerRow)       // Map headers to indices
findColumn_(idx, possibleNames)    // Find column with fallbacks
```

## Data Structures

### Song Object
```javascript
{
  id: "song_1234567890",
  title: "Amazing Grace",
  artist: "John Newton",
  theme: "Grace, Salvation",           // Comma-separated
  key: "G",
  tempo: "Slow",
  category: "Traditional Hymn",        // Note: backend uses 'style'
  season: "All Seasons",
  youtube: ["https://youtube.com/..."], // Array of URLs
  attachments: [{url, name, type}],    // Array of objects
  lyricsUrl: "https://...",            // Legacy: first attachment URL
  lyrics: "[Verse 1]\nAmazing grace...",
  useCount: 5,
  lastUsed: "2025-01-15T...",
  dateAdded: "2024-06-01T...",
  lastEdited: "2025-01-10T..."
}
```

### Roster Edit Object
```javascript
{
  roleId: "preacher",
  date: "Jan 18",
  value: "Pastor Ashley",
  month: 0,                            // 0-indexed
  year: 2025,
  timestamp: "2025-01-17T..."
}
```

### Roster Update Object
```javascript
{
  duty: "Preacher",
  roleId: "preacher",
  serviceDate: "Jan 18",
  oldValue: "Rev Benedict",
  newValue: "Pastor Ashley",
  timestamp: "2025-01-17T...",
  prevTimestamp: "2025-01-03T..."
}
```

## CSS Design System

```css
/* Brand Colors */
--brand: #4a6da7;
--brand-2: #6b9ac4;
--ink: #1f2933;
--paper: #f4f5fb;
--accent: #f2e4c7;

/* Roster Theme */
--roster-teal: #14b8a6;
--roster-teal-dark: #0d9488;
--roster-teal-light: #2dd4bf;

/* Fonts */
font-family: "Lato" (body)
font-family: "Cinzel" (headings)
font-family: "Playfair Display" (accent)
font-family: "Poppins" (UI elements)
```

## Development Workflow

### Testing Backend Functions
In Google Apps Script Editor:
```javascript
// Test song retrieval
testGetSongs()

// Test roster data
testGetRosterData()
testRosterUpdates()

// Setup required sheets
setupRosterChangesSheet()
```

### Debugging Frontend
1. Open web app URL
2. Open browser DevTools (F12)
3. Check Console for errors
4. Check Network tab for failed requests
5. Use `console.log()` in JavaScript

### Making Changes

1. **Backend changes**: Edit `server.gs` in Apps Script Editor, save, refresh web app
2. **Frontend changes**: Edit `index.html` (named "Index" in Apps Script), save, refresh web app
3. **After major changes**: May need to redeploy web app

## Future Development Plans

1. **Fix Current Issues**
   - Song card display problems
   - Roster updates loading

2. **Enhance Rosters Page**
   - Better change tracking UI
   - Bulk editing
   - Print-friendly view

3. **Enhance Songs Page**
   - Batch import from spreadsheet
   - SongSelect integration
   - Key/chord detection from lyrics

4. **Worship Orders**
   - Full Canva-designed template integration
   - Expandable liturgical sections
   - Full-screen presentation mode for projection
   - Song queue management

5. **Migration Plans**
   - Move from Apps Script to standalone web app
   - Add authentication/admin controls
   - Public website with restricted editing

## Common Gotchas

1. **Field name mismatch**: Backend returns `style`, frontend expects `category` - `normalizeSong()` should handle this but verify mapping

2. **Date handling**: Dates come from Sheets as Date objects, need formatting to "Mon D" strings

3. **Sheet column order**: Code uses flexible column detection (`findColumn_`) but assumes certain columns exist

4. **JSON in cells**: Multiple attachments/YouTube URLs stored as JSON strings in cells

5. **CORS/Auth**: Web app must be deployed as "Execute as me, Anyone can access" for public use

6. **Apps Script limits**: 6-minute execution time, 50MB response size

## Quick Commands for Claude Code

```bash
# View the files
cat index.html
cat server.gs

# Search for specific functions
grep -n "renderSongs" index.html
grep -n "getRosterUpdates" server.gs

# Find TODO comments
grep -n "TODO" index.html server.gs
```

## Contact & Resources

- **Google Apps Script Dashboard**: https://script.google.com
- **Spreadsheet**: Link to your Google Sheet (add here)
- **Web App URL**: Your deployed web app URL (add here)
