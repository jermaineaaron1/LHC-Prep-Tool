'use client';

import { useMemo, useState } from 'react';
import type { SongNote, TimedLyricSection } from '@/lib/vocal-hero/types';
import { compileRendition, defaultCard, deriveSections, describeCard, type RenditionCard } from '@/lib/vocal-hero/rendition';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];

/**
 * The simple face of the arrangement editor: a choir presentation built as a
 * stack of cards, each card one pass through a section of the song with its
 * own voices, key, tempo and dynamics. The classic three-verse shape — unison,
 * then parts, then everything up a step — is three cards and four taps.
 *
 * Nothing here edits notes. The cards COMPILE into notes, either applied into
 * the note editor (playable, undoable) or saved as a new song beside the
 * original, so the transcription that came off the sheet is never at risk.
 */
export function RenditionBuilder({ songTitle, notes, timedLyrics, cards, onCardsChange, onApply, onSaveAsNew, onOpenNotes, onClose, saving }: {
  songTitle: string;
  notes: SongNote[];
  timedLyrics: TimedLyricSection[];
  /** Lives in the parent so a trip to the note editor and back keeps the
   *  stack of passes — the hear/tweak/hear loop must not reset it. */
  cards: RenditionCard[];
  onCardsChange: (update: (current: RenditionCard[]) => RenditionCard[]) => void;
  onApply: (compiled: { notes: SongNote[]; timedLyrics: TimedLyricSection[] }, summary: string) => void;
  onSaveAsNew: (compiled: { notes: SongNote[]; timedLyrics: TimedLyricSection[]; duration: number }, title: string) => Promise<void>;
  onOpenNotes: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const sections = useMemo(() => deriveSections(notes, timedLyrics), [notes, timedLyrics]);
  const setCards = onCardsChange;
  const [newTitle, setNewTitle] = useState(`${songTitle} — our rendition`);
  const [notice, setNotice] = useState<string | null>(null);
  const compiled = useMemo(() => compileRendition(notes, timedLyrics, sections, cards), [notes, timedLyrics, sections, cards]);
  const sectionOf = (card: RenditionCard) => sections.find(section => section.id === card.sectionId);

  function patch(id: string, changes: Partial<RenditionCard>) {
    setCards(current => current.map(card => card.id === id ? { ...card, ...changes } : card));
  }
  function move(id: string, delta: number) {
    setCards(current => {
      const index = current.findIndex(card => card.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [card] = next.splice(index, 1);
      next.splice(target, 0, card);
      return next;
    });
  }

  const summary = cards.map(card => describeCard(card, sectionOf(card))).join('  →  ');

  return <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
    <header className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black uppercase tracking-[.22em] text-cyan-300">Our rendition</p>
        <h1 className="truncate text-xl font-black sm:text-2xl">{songTitle}</h1>
      </div>
      <button onClick={onOpenNotes} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200" title="The full note-level editor, for detail work">Note editor</button>
      <button onClick={onClose} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200">Close</button>
    </header>

    <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-400">The song itself is one recorded verse, and it stays exactly as it is. This screen decides how that verse is <b className="text-slate-200">performed</b>: how many times it is sung, and who sings, in what key, at what tempo, each time through. Stack the passes top to bottom, then hear the result or save it as its own song — the original is never touched.</p>

    {notice && <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{notice}</div>}

    <p className="mt-4 text-[10px] font-black uppercase tracking-[.2em] text-slate-500">1 · Tap a piece of the song to add a pass</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {sections.map(section => <button key={section.id} onClick={() => { setCards(current => [...current, defaultCard(section.id)]); setNotice(null); }}
        className="max-w-full rounded-xl border border-white/12 bg-white/[.04] px-3 py-2 text-left hover:bg-white/[.08]">
        <b className="block max-w-64 truncate text-xs text-cyan-200">＋ {section.id === 'whole' ? 'The whole verse' : `“${section.words}”`}</b>
        <span className="block text-[10px] text-slate-500">{section.id === 'whole' ? section.words : section.name}</span>
      </button>)}
    </div>

    {cards.length > 0 && <p className="mt-4 text-[10px] font-black uppercase tracking-[.2em] text-slate-500">2 · Your presentation, sung top to bottom</p>}
    <div className="mt-2 space-y-2">
      {!cards.length && <div className="vh-panel grid place-items-center px-6 py-10 text-center">
        <p className="text-sm text-slate-300">Nothing here yet — this is where your presentation takes shape.</p>
        <button onClick={() => { setCards(() => [
          { ...defaultCard('whole'), mode: 'unison' as const },
          defaultCard('whole'),
          { ...defaultCard('whole'), transpose: 1, dynamics: 'full' as const },
        ]); setNotice('The classic shape: verse 1 everyone on the melody, verse 2 in parts, verse 3 up a step at full voice. Change anything — or remove cards and build your own.'); }}
          className="vh-primary-button mt-4">▶ Start me off: the classic three-verse shape</button>
        <p className="mt-3 text-xs text-slate-500">Or tap any piece of the song above to add a single pass.</p>
      </div>}
      {cards.map((card, index) => {
        const section = sectionOf(card);
        return <article key={card.id} className="vh-panel p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-white">{index + 1}. {section?.name ?? '?'}</b>
            <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{section?.words}</span>
            <button onClick={() => move(card.id, -1)} disabled={index === 0} className="rounded border border-white/10 px-2 py-1 text-xs disabled:opacity-30" aria-label="Move up">↑</button>
            <button onClick={() => move(card.id, 1)} disabled={index === cards.length - 1} className="rounded border border-white/10 px-2 py-1 text-xs disabled:opacity-30" aria-label="Move down">↓</button>
            <button onClick={() => setCards(current => { const copy = { ...card, id: `card-${crypto.randomUUID()}` }; const next = [...current]; next.splice(index + 1, 0, copy); return next; })} className="rounded border border-white/10 px-2 py-1 text-xs" title="Duplicate this pass">⧉</button>
            <button onClick={() => setCards(current => current.filter(item => item.id !== card.id))} className="rounded border border-rose-300/30 px-2 py-1 text-xs text-rose-200" aria-label="Remove">✕</button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Who sings
              <span className="mt-1 flex flex-wrap gap-1">
                <button onClick={() => patch(card.id, { mode: card.mode === 'unison' ? 'satb' : 'unison' })}
                  className={`rounded-lg border px-2 py-1 text-xs ${card.mode === 'unison' ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/12 text-slate-300'}`}
                  title="Everyone sings the melody together">Unison</button>
                {card.mode === 'satb' && VOICES.map((voice, part) => <button key={voice} onClick={() => patch(card.id, { voices: card.voices.map((on, i) => i === part ? !on : on) as RenditionCard['voices'] })}
                  className="rounded-lg border px-2 py-1 text-xs"
                  style={{ borderColor: card.voices[part] ? `${COLOURS[part]}88` : '#ffffff1e', background: card.voices[part] ? `${COLOURS[part]}1c` : 'transparent', color: card.voices[part] ? '#fff' : '#64748b' }}
                  title={`${voice} ${card.voices[part] ? 'sings' : 'rests'}`}>{voice[0]}</button>)}
              </span>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Key
              <span className="mt-1 flex items-center gap-2">
                <button onClick={() => patch(card.id, { transpose: Math.max(-6, card.transpose - 1) })} className="rounded border border-white/12 px-2 py-1 text-sm">−</button>
                <b className="w-14 text-center text-sm text-white">{card.transpose === 0 ? 'as is' : `${card.transpose > 0 ? '+' : ''}${card.transpose}`}</b>
                <button onClick={() => patch(card.id, { transpose: Math.min(6, card.transpose + 1) })} className="rounded border border-white/12 px-2 py-1 text-sm" title="+1 on the last verse is the classic lift">＋</button>
              </span>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Tempo
              <select value={card.tempoFactor} onChange={event => patch(card.id, { tempoFactor: Math.max(0.5, Math.min(2, Number(event.target.value) || 1)) })} className="mt-1 block w-full rounded-lg border border-white/12 bg-black/25 px-2 py-1.5 text-sm text-white">
                <option value={0.85}>Broader — 85%</option>
                <option value={0.95}>Easing — 95%</option>
                <option value={1}>As written</option>
                <option value={1.1}>Brighter — 110%</option>
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Feel
              <select value={card.dynamics} onChange={event => patch(card.id, { dynamics: event.target.value as RenditionCard['dynamics'] })} className="mt-1 block w-full rounded-lg border border-white/12 bg-black/25 px-2 py-1.5 text-sm text-white">
                <option value="soft">Soft</option>
                <option value="medium">Steady</option>
                <option value="full">Full</option>
              </select>
            </label>
          </div>
        </article>;
      })}
    </div>

    {cards.length > 0 && <footer className="mt-5 space-y-3">
      <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-500">3 · Hear it, or keep it</p>
      <p className="text-xs text-slate-400">{cards.length} pass{cards.length === 1 ? '' : 'es'} · about {Math.floor(compiled.duration / 60)}:{String(compiled.duration % 60).padStart(2, '0')} of singing · {compiled.notes.length} notes</p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { onApply({ notes: compiled.notes, timedLyrics: compiled.timedLyrics }, summary); }}
          className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100"
          title="Puts the compiled rendition into the note editor to hear and fine-tune — undo brings the original back">Hear &amp; fine-tune in the note editor</button>
        <input value={newTitle} onChange={event => setNewTitle(event.target.value)} className="min-w-56 flex-1 rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-sm text-white" aria-label="Title for the saved rendition" />
        <button disabled={saving} onClick={() => { void onSaveAsNew(compiled, newTitle.trim() || `${songTitle} — our rendition`).then(() => setNotice(`Saved as “${newTitle}” — it is in the library now, ready to practise and perform. The original stays untouched.`)).catch(cause => setNotice(`Save failed: ${cause instanceof Error ? cause.message : 'unknown error'}`)); }}
          className="vh-primary-button px-4 py-2 text-sm disabled:opacity-40">{saving ? 'Saving…' : 'Save as a new song'}</button>
      </div>
    </footer>}
  </div>;
}
