'use client';

import { useMemo, useState } from 'react';
import type { Song, SongNote } from '@/lib/vocal-hero/types';
import { playableNotes } from '@/lib/vocal-hero/songData';

const PARTS = ['Shared guide', 'Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#f6c65b', '#ee86b5', '#f3a953', '#72aafb', '#6bd3a5'];

type EditableSong = Pick<Song, 'id' | 'title' | 'notes'>;

export function ArrangementEditor({ song, onClose, onSave }: {
  song: Song;
  onClose: () => void;
  onSave: (values: EditableSong) => Promise<void>;
}) {
  const [title, setTitle] = useState(song.title);
  const [notes, setNotes] = useState<SongNote[]>(() => playableNotes(song));
  const [saving, setSaving] = useState(false);
  const sorted = useMemo(() => [...notes].sort((a, b) => a.start - b.start || a.part - b.part || a.midi - b.midi), [notes]);

  function update(id: string, values: Partial<SongNote>) {
    setNotes(current => current.map(note => note.id === id ? { ...note, ...values } : note));
  }
  function addNote() {
    const latest = notes.reduce((end, note) => Math.max(end, note.end), 0);
    setNotes(current => [...current, { id: `note-${crypto.randomUUID()}`, part: -1, midi: 60, start: Math.round(latest * 10) / 10, end: Math.round((latest + 1) * 10) / 10, lyric: 'New lyric', velocity: 100 }]);
  }
  async function save() {
    setSaving(true);
    try {
      await onSave({ id: song.id, title: title.trim() || song.title, notes: sorted.map(note => ({ ...note, start: Math.max(0, note.start), end: Math.max(note.start + .1, note.end) })) });
    } finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#020712]/80 px-3 py-5 backdrop-blur-md sm:p-8">
    <section className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b1726] shadow-2xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#07111d] px-5 py-4 sm:px-7">
        <div><p className="text-xs font-bold uppercase tracking-[.24em] text-[#f6c65b]">Song arrangement</p><h1 className="mt-1 font-serif text-2xl">Edit the sung targets</h1></div>
        <div className="flex gap-2"><button onClick={onClose} disabled={saving} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Cancel</button><button onClick={() => void save()} disabled={saving} className="rounded-xl bg-[#f6c65b] px-4 py-2 text-sm font-bold text-[#07111d] disabled:opacity-60">{saving ? 'Saving…' : 'Save arrangement'}</button></div>
      </header>
      <div className="p-5 sm:p-7">
        <label className="block text-xs font-bold uppercase tracking-[.16em] text-slate-400">Song title<input value={title} onChange={event => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#07111d] px-4 py-3 text-lg text-white outline-none focus:border-[#f6c65b]" /></label>
        <div className="mt-5 rounded-2xl border border-[#f6c65b]/20 bg-[#f6c65b]/[.06] p-4 text-sm text-[#f7df9b]">One row is one singable target. Use <b>Shared guide</b> for an unarranged melody, or assign Soprano, Alto, Tenor and Bass to create authentic independent lanes.</div>
        <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10"><table className="min-w-[900px] w-full text-left text-sm"><thead className="bg-white/[.04] text-xs uppercase tracking-[.13em] text-slate-400"><tr><th className="px-3 py-3">Voice</th><th className="px-3 py-3">Lyric</th><th className="px-3 py-3">Pitch (MIDI)</th><th className="px-3 py-3">Start</th><th className="px-3 py-3">End</th><th className="px-3 py-3" /></tr></thead><tbody>{sorted.map(note => <tr key={note.id} className="border-t border-white/10"><td className="px-3 py-2"><select value={note.part} onChange={event => update(note.id, { part: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-[#07111d] px-2 py-2" style={{ color: COLOURS[note.part + 1] ?? COLOURS[0] }}>{PARTS.map((voice, index) => <option key={voice} value={index - 1}>{voice}</option>)}</select></td><td className="px-3 py-2"><input value={note.lyric} onChange={event => update(note.id, { lyric: event.target.value })} className="w-full min-w-52 rounded-lg border border-white/10 bg-[#07111d] px-2 py-2" /></td><td className="px-3 py-2"><input type="number" min="24" max="108" value={note.midi} onChange={event => update(note.id, { midi: Number(event.target.value) })} className="w-24 rounded-lg border border-white/10 bg-[#07111d] px-2 py-2" /></td><td className="px-3 py-2"><input type="number" step="0.1" min="0" value={note.start} onChange={event => update(note.id, { start: Number(event.target.value) })} className="w-24 rounded-lg border border-white/10 bg-[#07111d] px-2 py-2" /></td><td className="px-3 py-2"><input type="number" step="0.1" min="0.1" value={note.end} onChange={event => update(note.id, { end: Number(event.target.value) })} className="w-24 rounded-lg border border-white/10 bg-[#07111d] px-2 py-2" /></td><td className="px-3 py-2"><button onClick={() => setNotes(current => current.filter(item => item.id !== note.id))} className="rounded-lg border border-red-300/30 px-3 py-2 text-red-200">Remove</button></td></tr>)}</tbody></table></div>
        <button onClick={addNote} className="mt-4 rounded-xl border border-[#f6c65b]/40 bg-[#f6c65b]/10 px-4 py-2 text-sm font-semibold text-[#f7df9b]">+ Add target</button>
      </div>
    </section>
  </div>;
}
