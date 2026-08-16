'use client';

import { useEffect, useState } from 'react';
import { fetchHighScores } from '@/lib/vocal-hero/supabaseClient';
import type { HighScore } from '@/lib/vocal-hero/types';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];

/**
 * The best scores ever set on a song, one column per voice.
 *
 * The table, the capture on round end, and the fetcher all existed — the
 * fourth audit found the fetcher had no callers, so every finished round has
 * been writing records nobody could see. This is the window.
 *
 * `highlight` marks names from the round just sung, so a singer can see their
 * fresh entry the moment the board appears.
 */
export function HighScoreBoard({ songId, highlight = [], perVoice = 5 }: {
  songId: string;
  highlight?: string[];
  perVoice?: number;
}) {
  const [board, setBoard] = useState<HighScore[][] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setBoard(null);
    setFailed(false);
    void Promise.all([0, 1, 2, 3].map(part => fetchHighScores(songId, part)))
      .then(rows => { if (live) setBoard(rows); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [songId]);

  const marked = new Set(highlight.map(name => name.toLocaleLowerCase()));
  const empty = board !== null && board.every(rows => rows.length === 0);

  return <section className="rounded-2xl border border-white/10 bg-white/[.03] p-4" aria-label="High scores">
    <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-500">🏆 Best ever on this song</p>

    {failed && <p className="mt-3 py-4 text-center text-sm text-slate-500">The high-score board could not be loaded just now.</p>}
    {!failed && board === null && <p className="mt-3 py-4 text-center text-sm text-slate-500">Loading the board…</p>}
    {empty && <p className="mt-3 py-4 text-center text-sm text-slate-500">No scores yet — the first finished round sets them.</p>}

    {!failed && board !== null && !empty && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {board.map((rows, part) => <div key={VOICES[part]} className="rounded-xl border bg-black/20 p-3" style={{ borderColor: `${COLOURS[part]}35` }}>
        <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: COLOURS[part] }}>{VOICES[part]}</p>
        <div className="mt-2 space-y-1">
          {rows.slice(0, perVoice).map((row, rank) => {
            const fresh = marked.has(row.player_name.toLocaleLowerCase());
            return <div key={row.id} className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 text-sm ${fresh ? 'bg-white/[.07]' : ''}`}>
              <span className="w-4 text-xs text-slate-500">{rank + 1}</span>
              <span className={`min-w-0 flex-1 truncate ${fresh ? 'font-bold text-white' : 'text-slate-300'}`}>{row.player_name}</span>
              {fresh && <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: COLOURS[part] }}>you</span>}
              <b className="font-mono text-xs">{row.score.toLocaleString()}</b>
            </div>;
          })}
          {!rows.length && <p className="py-2 text-center text-xs text-slate-600">No {VOICES[part].toLowerCase()} yet</p>}
        </div>
      </div>)}
    </div>}
  </section>;
}
