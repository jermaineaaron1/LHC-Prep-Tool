// Corrections that have proved mechanical enough to apply automatically.
//
// WHY THIS FILE IS DATA AND NOT CODE
// The model cannot be trained from here, so the scanner improves by someone
// noticing that the same edit keeps being made by hand and encoding it. Keeping
// those rules as a list means adding one is an edit to this file plus a fixture
// in tools/scan-truth/, rather than a change to the transcription pipeline.
//
// HOW A RULE EARNS ITS PLACE
//   1. tools/scan-learn.js shows the same edit across several different songs.
//      Not one song -- one song is somebody fixing one song.
//   2. The edit is mechanical: the same text removed or rewritten every time,
//      with no judgement about the music involved.
//   3. A fixture in tools/scan-truth/ asserts the result, so the rule is proved
//      to work now and stays proved later.
//
// Anything failing those tests belongs in the prompt as guidance, or nowhere.
// A rule here runs on every scan of every sheet, so a rule that is right for
// one hymnal and wrong for the next is worse than no rule at all.
//
// THE LIST IS EMPTY, DELIBERATELY
// Searching every scan recorded so far found no page furniture reaching the
// lyrics: watermarks, hymn numbers and credit lines are already kept out by the
// prompt, which reports them in notes instead. Seeding this with rules for
// markings nobody has actually been stripping would be guessing at a preference
// rather than learning one. It fills as scan-learn finds evidence.

export type LearnedRule = {
  /** Short stable name, used when reporting what was applied. */
  id: string;
  /** The evidence. Say which songs, and how many, so a later reader can judge it. */
  why: string;
  /**
   * removeLine  drop any lyric line that matches outright
   * remove      delete just the matched text, leaving the rest of the line
   * replace     swap the matched text for `with`
   */
  kind: 'removeLine' | 'remove' | 'replace';
  /** Regular expression source, applied per line. */
  pattern: string;
  /** Regex flags. 'i' is usual; 'g' is added for you where it applies. */
  flags?: string;
  /** Replacement text, for kind 'replace'. */
  with?: string;
};

export const LEARNED_RULES: LearnedRule[] = [
  // A worked example, kept commented rather than active so the shape is obvious
  // when the first real rule is added:
  //
  // {
  //   id: 'hymnary-footer',
  //   why: 'Hymnary.org prints its name under every page. Removed by hand in 6 of
  //         6 songs scanned from that source (scan-learn, 2026-08).',
  //   kind: 'removeLine',
  //   pattern: '^\\s*hymnary\\.org\\s*$',
  //   flags: 'i',
  // },
];

/**
 * Applies the rules to a transcription, and says which ones did anything.
 *
 * Chord lines are never touched. A rule is about page furniture and wording in
 * the lyrics; letting one loose on a chord line risks turning "F" into nothing
 * and taking the alignment with it, for no benefit anyone asked for.
 *
 * A rule that would remove more than a third of the lyric text is skipped and
 * reported. That is not a rule doing its job -- it is a pattern that matched far
 * more than its author expected, and losing most of a hymn to a stray regex is
 * exactly the failure this whole feature has been chasing out.
 */
export function applyLearnedRules(
  text: string,
  isChordLine: (line: string) => boolean,
): { text: string; applied: string[]; skipped: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];
  if (!LEARNED_RULES.length || !text) return { text, applied, skipped };

  const weight = (s: string) => s.replace(/\s+/g, '').length;
  let current = text;

  for (const rule of LEARNED_RULES) {
    let re: RegExp;
    try {
      const flags = rule.flags || '';
      re = new RegExp(rule.pattern, rule.kind === 'removeLine' ? flags : flags.includes('g') ? flags : flags + 'g');
    } catch {
      skipped.push(rule.id + ' (bad pattern)');
      continue;
    }

    const before = current;
    const out: string[] = [];
    for (const line of current.split(/\r?\n/)) {
      if (isChordLine(line) || /^\[.*\]$/.test(line.trim())) { out.push(line); continue; }
      if (rule.kind === 'removeLine') {
        re.lastIndex = 0;
        if (re.test(line)) continue;
        out.push(line);
      } else {
        re.lastIndex = 0;
        out.push(line.replace(re, rule.kind === 'replace' ? (rule.with ?? '') : ''));
      }
    }
    const after = out.join('\n');
    if (after === before) continue;

    if (weight(before) && weight(after) < weight(before) * 0.67) {
      skipped.push(rule.id + ' (would have removed too much)');
      continue;
    }
    current = after;
    applied.push(rule.id);
  }

  return { text: current, applied, skipped };
}
