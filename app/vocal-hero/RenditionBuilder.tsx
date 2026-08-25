'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultCard, type CompiledRendition, type RenditionCard, type RenditionSection } from '@/lib/vocal-hero/rendition';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#ffae42', '#4ca0ff', '#43e2bb'];

/**
 * The rendition as a STAGE inside the song editor, not a form on its own
 * page: the presentation is a filmstrip of pass blocks over the live
 * engraved score of the result. Tap a piece of the song to add a pass, tap
 * a block to shape it (who sings, key, tempo, feel), drag blocks to
 * reorder, and press play — the block that is sounding lights up and fills
 * while the score's cursor sweeps below. The original song is never
 * touched; the result is saved as its own song.
 */
export function RenditionRail({ songTitle, sections, cards, onCardsChange, compiled, getPlayhead, isPlaying, onPlayFrom, onPause, onStop, onLoadIntoEditor, onSaveAsNew, onNotice, saving }: {
  songTitle: string;
  sections: RenditionSection[];
  cards: RenditionCard[];
  onCardsChange: (update: (current: RenditionCard[]) => RenditionCard[]) => void;
  compiled: CompiledRendition;
  getPlayhead: () => number | null;
  isPlaying: boolean;
  onPlayFrom: (time: number) => void;
  onPause: () => void;
  onStop: () => void;
  onLoadIntoEditor: () => void;
  onSaveAsNew: (title: string) => Promise<void>;
  onNotice: (text: string) => void;
  saving: boolean;
}) {
  const setCards = onCardsChange;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState(`${songTitle} — our rendition`);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  const passByCard = useMemo(() => new Map(compiled.passes.map(pass => [pass.cardId, pass])), [compiled.passes]);
  const selectedCard = cards.find(card => card.id === selectedCardId) ?? null;
  const selectedIndex = selectedCard ? cards.indexOf(selectedCard) : -1;
  const sectionOf = (card: RenditionCard) => sections.find(section => section.id === card.sectionId);

  // One animation frame drives every block's "now sounding" state: the block
  // whose pass contains the playhead glows and fills left to right.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const time = getPlayhead();
      for (const [cardId, element] of blockRefs.current) {
        const pass = passByCard.get(cardId);
        const overlay = element.querySelector<HTMLElement>('[data-progress]');
        const sounding = pass && time !== null && isPlaying && time >= pass.start && time < pass.end;
        element.dataset.playing = sounding ? 'true' : 'false';
        if (overlay) overlay.style.width = sounding && pass ? `${((time! - pass.start) / Math.max(.001, pass.end - pass.start)) * 100}%` : '0%';
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [passByCard, getPlayhead, isPlaying]);

  function addCard(sectionId: string, template?: Partial<RenditionCard>) {
    const card = { ...defaultCard(sectionId), ...template };
    setCards(current => [...current, card]);
    setSelectedCardId(card.id);
    setJustAddedId(card.id);
  }
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
  function dropOn(targetId: string) {
    const dragged = dragIdRef.current;
    if (!dragged || dragged === targetId) return;
    setCards(current => {
      const from = current.findIndex(card => card.id === dragged);
      const to = current.findIndex(card => card.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [card] = next.splice(from, 1);
      next.splice(to, 0, card);
      return next;
    });
  }
  function startClassicShape() {
    const shape = [
      { ...defaultCard('whole'), mode: 'unison' as const },
      defaultCard('whole'),
      { ...defaultCard('whole'), transpose: 1, dynamics: 'full' as const },
    ];
    setCards(() => shape);
    setSelectedCardId(shape[0].id);
    setJustAddedId(shape[2].id);
    onNotice('The classic shape: verse 1 everyone on the melody, verse 2 in parts, verse 3 up a step at full voice. Tap any block to change it, press ▶ to hear it.');
  }

  const totalSeconds = Math.max(0, Math.round(compiled.duration - 1));
  const clock = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;

  return <div className="mb-2 rounded-xl border border-cyan-300/20 bg-[#070b1c] text-xs shadow-[0_14px_44px_#0007]">
    <style>{`
      @keyframes vh-pass-pop { 0% { transform: scale(.85); opacity: 0 } 60% { transform: scale(1.04) } 100% { transform: scale(1); opacity: 1 } }
      [data-playing="true"] { border-color: #22d3ee !important; box-shadow: 0 0 26px #22d3ee55, inset 0 0 18px #22d3ee11 !important }
    `}</style>

    <div className="flex flex-wrap items-center gap-2 border-b border-white/[.06] px-3 py-2">
      <span className="text-[9px] font-black uppercase tracking-[.2em] text-cyan-300">1 · Add a pass — tap a piece of the song</span>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {sections.map(section => <button key={section.id} onClick={() => addCard(section.id)}
          title={section.words}
          className="shrink-0 rounded-lg border border-white/12 bg-white/[.04] px-2.5 py-1.5 text-[11px] text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/10">
          ＋ {section.id === 'whole' ? 'The whole verse' : `${section.name} · “${section.words.length > 26 ? section.words.slice(0, 26) + '…' : section.words}”`}
        </button>)}
      </div>
    </div>

    {cards.length === 0 && <div className="grid place-items-center gap-3 px-6 py-8 text-center">
      <p className="max-w-xl text-[13px] leading-relaxed text-slate-300">The song stays exactly as recorded — this stage decides how it is <b className="text-white">performed</b>: how many times the verse is sung, and who sings, in what key, at what tempo, each time through.</p>
      <button onClick={startClassicShape} className="rounded-xl bg-[linear-gradient(120deg,#d946ef,#22d3ee)] px-5 py-2.5 text-sm font-black text-[#08101d] shadow-[0_10px_30px_#d946ef33] transition hover:shadow-[0_10px_40px_#22d3ee44]">▶ Start me off: the classic three-verse shape</button>
      <p className="text-[11px] text-slate-500">Or tap a piece of the song above to add a single pass.</p>
    </div>}

    {cards.length > 0 && <>
      <div className="border-b border-white/[.06] px-3 pb-3 pt-2">
        <p className="mb-1.5 text-[9px] font-black uppercase tracking-[.2em] text-slate-500">2 · Your presentation, sung left to right — drag to reorder, tap to shape</p>
        <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
          {cards.map((card, index) => {
            const section = sectionOf(card);
            const pass = passByCard.get(card.id);
            const weight = pass ? Math.max(1, pass.end - pass.start) : 1;
            const isSelected = card.id === selectedCardId;
            const who = card.mode === 'unison' ? 'Everyone · melody' : VOICES.filter((_, part) => card.voices[part]).map(voice => voice[0]).join(' ') || 'no voices';
            return <div key={card.id} role="button" tabIndex={0} draggable
              ref={element => { if (element) blockRefs.current.set(card.id, element); else blockRefs.current.delete(card.id); }}
              onClick={() => setSelectedCardId(isSelected ? null : card.id)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedCardId(isSelected ? null : card.id); } }}
              onDragStart={() => { dragIdRef.current = card.id; }}
              onDragEnter={() => dropOn(card.id)}
              onDragOver={event => event.preventDefault()}
              onDragEnd={() => { dragIdRef.current = null; }}
              className="relative min-w-44 cursor-pointer select-none overflow-hidden rounded-xl border bg-[#0a0f24] p-2.5 text-left transition-all duration-300"
              style={{
                flexGrow: weight, flexBasis: 0,
                borderColor: isSelected ? '#e879f9' : '#ffffff1c',
                boxShadow: isSelected ? '0 0 24px #e879f944' : undefined,
                animation: card.id === justAddedId ? 'vh-pass-pop .35s ease' : undefined,
              }}>
              <span data-progress className="pointer-events-none absolute inset-y-0 left-0 w-0 bg-[linear-gradient(90deg,#22d3ee22,#22d3ee0a)] transition-none" />
              <div className="flex items-center gap-2">
                <b className="text-base leading-none text-white">{index + 1}</b>
                <b className="truncate text-[11px] text-cyan-100">{section?.name ?? '?'}</b>
                <span className="ml-auto flex shrink-0 gap-1">
                  {card.transpose !== 0 && <i className="rounded bg-amber-300/15 px-1.5 py-0.5 not-italic text-amber-200">{card.transpose > 0 ? `+${card.transpose}` : card.transpose} key</i>}
                  {card.tempoFactor !== 1 && <i className="rounded bg-fuchsia-300/15 px-1.5 py-0.5 not-italic text-fuchsia-200">{Math.round(card.tempoFactor * 100)}%</i>}
                  {card.dynamics !== 'medium' && <i className="rounded bg-white/10 px-1.5 py-0.5 not-italic text-slate-300">{card.dynamics}</i>}
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] text-slate-500">{section?.words}</p>
              <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full border border-white/10" title={who}>
                {card.mode === 'unison'
                  ? <span className="flex-1 bg-[linear-gradient(90deg,#d946ef,#22d3ee)]" />
                  : VOICES.map((voice, part) => <span key={voice} className="flex-1" style={{ background: card.voices[part] ? COLOURS[part] : '#ffffff10' }} />)}
              </div>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[.12em] text-slate-400">{who}</p>
              {pass && <button onClick={event => { event.stopPropagation(); onPlayFrom(Math.max(0, pass.start - .02)); }}
                title={`Hear pass ${index + 1} from its first bar`} aria-label={`Play pass ${index + 1}`}
                className="absolute bottom-1.5 right-1.5 rounded-md border border-white/15 bg-black/40 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:border-cyan-300/50">▶</button>}
            </div>;
          })}
        </div>

        {selectedCard && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-fuchsia-300/25 bg-fuchsia-400/[.05] px-3 py-2">
          <b className="text-[11px] text-fuchsia-100">Pass {selectedIndex + 1} · {sectionOf(selectedCard)?.name}</b>
          <label className="flex items-center gap-1.5"><span className="text-[9px] font-black uppercase tracking-[.14em] text-slate-500">Who sings</span>
            <button onClick={() => patch(selectedCard.id, { mode: selectedCard.mode === 'unison' ? 'satb' : 'unison' })}
              className={`rounded-lg border px-2 py-1 ${selectedCard.mode === 'unison' ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/12 text-slate-300'}`}
              title="Everyone sings the melody together">Unison</button>
            {selectedCard.mode === 'satb' && VOICES.map((voice, part) => <button key={voice}
              onClick={() => patch(selectedCard.id, { voices: selectedCard.voices.map((on, i) => i === part ? !on : on) as RenditionCard['voices'] })}
              className="rounded-lg border px-2 py-1"
              style={{ borderColor: selectedCard.voices[part] ? `${COLOURS[part]}88` : '#ffffff1e', background: selectedCard.voices[part] ? `${COLOURS[part]}1c` : 'transparent', color: selectedCard.voices[part] ? '#fff' : '#64748b' }}
              title={`${voice} ${selectedCard.voices[part] ? 'sings' : 'rests'}`}>{voice[0]}</button>)}
          </label>
          <label className="flex items-center gap-1.5"><span className="text-[9px] font-black uppercase tracking-[.14em] text-slate-500">Key</span>
            <button onClick={() => patch(selectedCard.id, { transpose: Math.max(-6, selectedCard.transpose - 1) })} className="rounded border border-white/12 px-2 py-1">−</button>
            <b className="w-10 text-center text-white">{selectedCard.transpose === 0 ? 'as is' : `${selectedCard.transpose > 0 ? '+' : ''}${selectedCard.transpose}`}</b>
            <button onClick={() => patch(selectedCard.id, { transpose: Math.min(6, selectedCard.transpose + 1) })} className="rounded border border-white/12 px-2 py-1" title="+1 on the last verse is the classic lift">＋</button>
          </label>
          <label className="flex items-center gap-1.5"><span className="text-[9px] font-black uppercase tracking-[.14em] text-slate-500">Tempo</span>
            <select value={selectedCard.tempoFactor} onChange={event => patch(selectedCard.id, { tempoFactor: Math.max(0.5, Math.min(2, Number(event.target.value) || 1)) })} className="rounded-lg border border-white/12 bg-black/25 px-2 py-1 text-white">
              <option value={0.85}>Broader — 85%</option>
              <option value={0.95}>Easing — 95%</option>
              <option value={1}>As written</option>
              <option value={1.1}>Brighter — 110%</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5"><span className="text-[9px] font-black uppercase tracking-[.14em] text-slate-500">Feel</span>
            <select value={selectedCard.dynamics} onChange={event => patch(selectedCard.id, { dynamics: event.target.value as RenditionCard['dynamics'] })} className="rounded-lg border border-white/12 bg-black/25 px-2 py-1 text-white">
              <option value="soft">Soft</option>
              <option value="medium">Steady</option>
              <option value="full">Full</option>
            </select>
          </label>
          <span className="ml-auto flex gap-1.5">
            <button onClick={() => move(selectedCard.id, -1)} disabled={selectedIndex === 0} className="rounded border border-white/10 px-2 py-1 disabled:opacity-30" title="Sing this pass earlier">◀</button>
            <button onClick={() => move(selectedCard.id, 1)} disabled={selectedIndex === cards.length - 1} className="rounded border border-white/10 px-2 py-1 disabled:opacity-30" title="Sing this pass later">▶</button>
            <button onClick={() => { const copy = { ...selectedCard, id: `card-${crypto.randomUUID()}` }; setCards(current => { const next = [...current]; next.splice(selectedIndex + 1, 0, copy); return next; }); setSelectedCardId(copy.id); setJustAddedId(copy.id); }} className="rounded border border-white/10 px-2 py-1" title="Duplicate this pass">⧉</button>
            <button onClick={() => { setCards(current => current.filter(item => item.id !== selectedCard.id)); setSelectedCardId(null); }} className="rounded border border-rose-300/30 px-2 py-1 text-rose-200" title="Remove this pass">✕</button>
          </span>
        </div>}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-[9px] font-black uppercase tracking-[.2em] text-slate-500">3 · Hear it, or keep it</span>
        <span className="flex items-center gap-1.5">
          <button onClick={isPlaying ? onPause : () => onPlayFrom(0)} className={`min-w-14 rounded-lg border px-3 py-1.5 font-bold ${isPlaying ? 'border-amber-300/50 bg-amber-300/10 text-amber-100' : 'border-fuchsia-300/50 bg-fuchsia-500/15 text-fuchsia-100'}`} title={isPlaying ? 'Pause' : 'Play the whole presentation'}>{isPlaying ? '❚❚' : '▶'}</button>
          <button onClick={onStop} className="rounded-lg border border-white/12 px-2.5 py-1.5" title="Stop and return to the start">■</button>
        </span>
        <span className="text-slate-400">{cards.length} pass{cards.length === 1 ? '' : 'es'} · about {clock} · {compiled.notes.length} notes</span>
        <button onClick={onLoadIntoEditor} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-1.5 text-cyan-100"
          title="Puts the compiled presentation into the Score and Grid views for note-level fine-tuning — Undo brings the original arrangement back">Open in note editor</button>
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          <input value={newTitle} onChange={event => setNewTitle(event.target.value)} className="w-64 min-w-0 rounded-lg border border-white/12 bg-black/25 px-3 py-1.5 text-white" aria-label="Title for the saved rendition" />
          <button disabled={saving} onClick={() => { void onSaveAsNew(newTitle.trim() || `${songTitle} — our rendition`).then(() => onNotice(`Saved as “${newTitle}” — it is in the library now, ready to practise and perform. The original stays untouched.`)).catch(cause => onNotice(`Save failed: ${cause instanceof Error ? cause.message : 'unknown error'}`)); }}
            className="shrink-0 rounded-lg bg-[linear-gradient(120deg,#d946ef,#22d3ee)] px-3.5 py-1.5 font-black text-[#08101d] disabled:opacity-40">{saving ? 'Saving…' : 'Save as a new song'}</button>
        </span>
      </div>
    </>}
  </div>;
}
