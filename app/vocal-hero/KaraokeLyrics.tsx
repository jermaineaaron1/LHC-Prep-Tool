'use client';

import { Fragment } from 'react';
import type { Song, SongNote } from '@/lib/vocal-hero/types';
import { karaokeCue } from '@/lib/vocal-hero/liveCues';
import type { KaraokeSegment } from '@/lib/vocal-hero/liveCues';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];

const SUNG = '#38bdf8';
const UNSUNG = '#cbd5e1';

/** A segment that remembers where it came from, so keys stay stable. */
type Placed = KaraokeSegment & { index: number };

/**
 * Syllables regrouped into the words they belong to.
 *
 * A hyphenated fragment joins the one before it: "Glo-" + "ry" is one word
 * sung on two notes. Rendering those as loose spans let a line wrap between
 * them, so "Glory" could arrive as "Glo" at the end of one row and "ry" at the
 * start of the next. Grouping first keeps the word whole, and the syllable
 * division inside it can still be shown.
 */
function intoWords(segments: KaraokeSegment[]): Placed[][] {
  const words: Placed[][] = [];
  segments.forEach((segment, index) => {
    const placed = { ...segment, index };
    if (index === 0 || !segment.joinsPrevious) words.push([placed]);
    else words[words.length - 1].push(placed);
  });
  return words;
}

/**
 * One syllable, in one of three states.
 *
 * The one being sung RIGHT NOW is the whole point of this component, and until
 * now it was told apart only by how far a colour had swept across it -- which,
 * on a syllable two characters wide, is a few pixels nobody catches mid-phrase.
 * It now sits on its own lit chip, and the chip is what fills: which syllable
 * is yours, and how much of it is left, in one glance.
 */
function Syllable({ segment, sung, unsung, accent, lit }: {
  segment: KaraokeSegment;
  sung: string;
  unsung: string;
  accent: string;
  lit: boolean;
}) {
  if (lit) {
    const edge = `${segment.fill * 100}%`;
    return <span
      className="rounded-[.28em] px-[.18em] text-white"
      style={{
        backgroundImage: `linear-gradient(90deg, ${accent}f2 ${edge}, ${accent}38 ${edge})`,
        boxShadow: `0 0 24px ${accent}70`,
        textShadow: '0 1px 3px rgba(0,0,0,.55)',
      }}
    >{segment.text}</span>;
  }
  if (segment.fill >= 1) return <span style={{ color: sung, textShadow: `0 0 18px ${sung}66` }}>{segment.text}</span>;
  if (segment.fill <= 0) return <span style={{ color: unsung }}>{segment.text}</span>;
  // Mid-sweep but not the current note -- a tie, or two notes overlapping.
  // Keep the within-syllable gradient so the sweep still reads as continuous.
  const edge = `${segment.fill * 100}%`;
  return <span style={{
    backgroundImage: `linear-gradient(90deg, ${sung} ${edge}, ${unsung} ${edge})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  }}>{segment.text}</span>;
}

/**
 * The line, lit syllable by syllable as it is sung.
 *
 * Each fragment carries its own fill rather than the whole line being clipped
 * from the left. A single clip is only correct while the line fits on one row:
 * as soon as it wraps — which is exactly what a sentence-long phrase does — a
 * horizontal clip lights the same fraction of every row at once, so half of the
 * second line glows while the singer is still on the first.
 */
function LyricLine({ segments, fallback, className, sung = SUNG, unsung = UNSUNG, accent }: {
  segments: KaraokeSegment[];
  fallback: string;
  className: string;
  sung?: string;
  unsung?: string;
  accent: string;
}) {
  if (!segments.length) return <p className={className} style={{ color: unsung }}>{fallback}</p>;
  return <p className={className}>
    {/* The space goes OUTSIDE the nowrap span, and the span is not an
        inline-block. Inside, the space is unbreakable and the whole line
        refuses to wrap; as an inline-block, the leading space is dropped
        altogether and every word runs into the next. */}
    {intoWords(segments).map((word, wordIndex) => <Fragment key={word[0].index}>
      {wordIndex > 0 ? ' ' : ''}
      <span className="whitespace-nowrap">{word.map((segment, part) => <span key={segment.index}>
        {/* The division inside a word, which the singer otherwise cannot see:
            the notes know "Glo-ry" is two syllables and the page showed
            "Glory". Faint on purpose — it marks the break without breaking
            the word. */}
        {part > 0 && <span aria-hidden className="font-normal opacity-30">·</span>}
        <Syllable segment={segment} sung={sung} unsung={unsung} accent={accent} lit={segment.current} />
      </span>)}</span>
    </Fragment>)}
  </p>;
}

/**
 * The phrase as a row of syllable ticks.
 *
 * A single sliding bar said how far through the line the singer was. It did
 * not say how many syllables that meant, or which one they were on. One tick
 * per syllable, in the same order as the words above it, so the bar and the
 * lyric are two readings of one thing. Past a certain count a tick would be
 * thinner than the gap beside it, so a very long phrase keeps the plain bar.
 */
function SyllableTrack({ segments, progress, sung, accent, thin }: {
  segments: KaraokeSegment[];
  progress: number;
  sung: string;
  accent: string;
  thin: boolean;
}) {
  const height = thin ? 'h-1.5' : 'h-2';
  if (!segments.length || segments.length > 40) {
    return <div className={`mx-auto max-w-4xl overflow-hidden rounded-full bg-white/10 ${height}`}>
      <span className="block h-full rounded-full transition-[width] duration-75"
        style={{ width: `${progress * 100}%`, backgroundImage: `linear-gradient(90deg, ${sung}, ${accent})` }} />
    </div>;
  }
  return <div className={`mx-auto flex max-w-4xl gap-[3px] ${height}`} aria-hidden>
    {segments.map((segment, index) => <span key={index} className="min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
      <span className="block h-full rounded-full transition-[width] duration-75" style={{
        width: `${segment.fill * 100}%`,
        background: segment.current ? accent : sung,
        boxShadow: segment.current ? `0 0 12px ${accent}` : undefined,
      }} />
    </span>)}
  </div>;
}

export function KaraokeLyrics({ song, notes, partIndex, elapsed, compact = false, colour = SUNG }: {
  song: Song;
  notes: SongNote[];
  partIndex: number;
  elapsed: number;
  compact?: boolean;
  /** The voice's own colour, so this banner and that voice's lane agree. */
  colour?: string;
}) {
  const cue = karaokeCue(song, notes, partIndex, elapsed);
  const maxLines = song.backing_track_settings?.karaoke_lyrics?.max_lines ?? 2;
  const size = compact ? 'text-lg sm:text-2xl' : maxLines === 1 ? 'text-xl sm:text-4xl' : 'text-2xl sm:text-5xl';
  // Counting a singer in is a game's job. The banner said "Coming up" and left
  // them to guess the moment.
  const countIn = cue.waiting && cue.startsIn <= 4 ? Math.max(1, Math.ceil(cue.startsIn)) : null;
  const done = cue.segments.filter(segment => segment.fill >= 1).length;
  return <section
    className={`relative overflow-hidden rounded-2xl border bg-[linear-gradient(135deg,#081326,#120d29)] text-center shadow-[0_16px_50px_#02061788] ${compact ? 'p-2 sm:p-4' : 'p-5 sm:p-6'}`}
    style={{ borderColor: `${colour}38` }}
    aria-label="Karaoke lyrics"
  >
    {/* A lit edge along the top, in the voice's own colour. */}
    <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px"
      style={{ backgroundImage: `linear-gradient(90deg, transparent, ${colour}, transparent)` }} />

    <div className="flex items-center justify-center gap-3">
      <p className="text-[10px] font-black uppercase tracking-[.22em]" style={{ color: colour }}>
        {cue.waiting ? 'Coming up' : 'Sing now'}
      </p>
      {countIn !== null
        ? <span className="rounded-full px-2 py-px text-[10px] font-black tabular-nums text-white"
            style={{ background: `${colour}2a`, boxShadow: `0 0 16px ${colour}55` }}>IN {countIn}</span>
        : cue.segments.length > 0 && <span className="text-[10px] font-bold tabular-nums text-slate-500">
            {Math.min(done + (cue.currentLyric ? 1 : 0), cue.segments.length)}/{cue.segments.length} syllables
          </span>}
    </div>

    <div className={`mx-auto mt-2 flex max-w-5xl items-center justify-center overflow-hidden ${compact ? 'min-h-10 sm:min-h-16' : maxLines === 1 ? 'min-h-14 sm:min-h-20' : 'min-h-16 sm:min-h-24'}`}>
      <LyricLine
        segments={cue.segments}
        fallback={cue.text}
        accent={colour}
        className={`${size} max-w-full font-black leading-tight ${maxLines === 1 ? 'whitespace-nowrap' : 'line-clamp-2'}`}
      />
    </div>

    <div className={compact ? 'mt-1.5 sm:mt-3' : 'mt-3'}>
      <SyllableTrack segments={cue.segments} progress={cue.progress} sung={SUNG} accent={colour} thin={compact} />
    </div>

    {!compact && <p className="hidden sm:mt-2 sm:block sm:min-h-5 sm:text-sm text-slate-500">{cue.nextText ? `Next: ${cue.nextText}` : 'Follow the target note as it reaches the gold strike line'}</p>}
  </section>;
}

/** Host view: one banner for genuinely shared words, otherwise one line per SATB part. */
export function ChoirKaraokeLyrics({ song, notes, elapsed }: { song: Song; notes: SongNote[]; elapsed: number }) {
  const cues = VOICES.map((_, partIndex) => karaokeCue(song, notes, partIndex, elapsed));
  const signatures = cues.map(cue => cue.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
  if (signatures.every(Boolean) && new Set(signatures).size === 1) {
    return <KaraokeLyrics song={song} notes={notes} partIndex={0} elapsed={elapsed} compact />;
  }

  return <section className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,#081326,#120d29)] p-4 shadow-[0_16px_50px_#02061788]" aria-label="SATB choir lyrics">
    <p className="mb-3 text-center text-[10px] font-black uppercase tracking-[.22em] text-cyan-300">Choir lyrics · each singer follows their own part</p>
    <div className="grid gap-2 lg:grid-cols-2">
      {cues.map((cue, partIndex) => <div key={VOICES[partIndex]} className="grid grid-cols-[76px_1fr] items-center overflow-hidden rounded-xl border bg-black/20" style={{ borderColor: `${COLOURS[partIndex]}45` }}>
        <div className="self-stretch border-r px-3 py-3" style={{ borderColor: `${COLOURS[partIndex]}35`, background: `${COLOURS[partIndex]}12` }}>
          <b className="text-lg" style={{ color: COLOURS[partIndex] }}>{VOICES[partIndex][0]}</b>
          <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: COLOURS[partIndex] }}>{VOICES[partIndex]}</p>
        </div>
        <div className="min-w-0 px-3 py-3">
          <LyricLine
            segments={cue.segments}
            fallback={cue.text}
            className="min-h-7 text-sm font-bold leading-snug line-clamp-2"
            sung={COLOURS[partIndex]}
            unsung="#e2e8f0"
            accent={COLOURS[partIndex]}
          />
          <div className="mt-2">
            <SyllableTrack segments={cue.segments} progress={cue.progress} sung={COLOURS[partIndex]} accent={COLOURS[partIndex]} thin />
          </div>
        </div>
      </div>)}
    </div>
  </section>;
}
