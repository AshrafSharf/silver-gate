/**
 * Deterministic parser for academic-book marker annotations.
 *
 * Input:  LaTeX annotated with the `%` marker grammar documented in
 *         `academicBook.instructions.js` — either produced by the LLM
 *         annotator or hand-authored (legacy `preprocessed.tex` files).
 * Output: `{ blocks: [...] }`, one block per exercise set and one per grouped
 *         run of examples, each carrying the section provenance and the
 *         `toc_question_items` shape that lessons already consume.
 *
 * No LLM involvement: once boundaries are explicit, extraction is mechanical.
 * This mirrors `questionExtraction.service.parseMarkerBlocks`, which bypasses
 * the LLM for the same reason.
 *
 * Ported from the `robogebra/latex_parser` project — `src/parser/parser.js`,
 * `src/parser/exercise_parser.js` and `src/model/exerciseModel.js`.
 */

import { AB_MARKERS, AB_META_PREFIXES } from './academicBook.instructions.js';

// question_type values accepted by lesson_items.question_type.
const QUESTION_TYPES = {
  CHOICE_BASED: 'CHOICE_BASED',
  MULTI_QUESTIONS: 'MULTI_QUESTIONS',
  OTHER: 'OTHER',
};

// ---------------------------------------------------------------------------
// Block extraction
// ---------------------------------------------------------------------------

/**
 * Collect the body of every `start` … `end` marker pair, in source order.
 * Unmatched openers are reported and skipped rather than swallowing the rest
 * of the document.
 *
 * Each entry carries its `offset` in the source. Examples and exercises are
 * collected in two separate passes, so without it their relative order is lost
 * and the chapter comes out as "every example, then every exercise" instead of
 * the reading order a book is taught in.
 */
export function extractBlockBodies(content, start, end, warnings) {
  const bodies = [];
  let cursor = 0;

  while (true) {
    const startIdx = content.indexOf(start, cursor);
    if (startIdx === -1) break;

    const endIdx = content.indexOf(end, startIdx + start.length);
    if (endIdx === -1) {
      warnings.push(`Unmatched ${start} at offset ${startIdx} — ignoring the remainder`);
      break;
    }

    bodies.push({ body: content.substring(startIdx + start.length, endIdx), offset: startIdx });
    cursor = endIdx + end.length;
  }

  return bodies;
}

// ---------------------------------------------------------------------------
// Metadata parsing
// ---------------------------------------------------------------------------

export function readMetaValue(body, prefix) {
  // Prefixes end in `_`, and the value runs to end of line.
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*${escaped}(.*)$`, 'm').exec(body);
  return match ? match[1].trim() : null;
}

function parseParentSectionName(body) {
  if (body.includes(AB_META_PREFIXES.NO_PARENT) || body.includes(AB_META_PREFIXES.NO_COMMON_PARENT)) {
    return null;
  }
  return readMetaValue(body, AB_META_PREFIXES.PARENT) || '';
}

function parseCommonParentSectionName(body) {
  if (body.includes(AB_META_PREFIXES.NO_COMMON_PARENT)) return null;
  return readMetaValue(body, AB_META_PREFIXES.COMMON_PARENT) || '';
}

function parsePageNumber(body, prefix) {
  const raw = readMetaValue(body, prefix);
  if (!raw) return null;
  const digits = /^(\d+)/.exec(raw);
  return digits ? parseInt(digits[1], 10) : null;
}

/**
 * Title comes from the block's `\section*{...}` heading.
 * "EXERCISE 1.1" → { title: 'EXERCISE 1.1', key: 'EXERCISE', index: '1.1' }
 * "Example 12"   → { title: 'Example 12',   key: 'Example',  index: '12'  }
 * Unnumbered headings ("Miscellaneous Exercise") keep index '1'.
 */
export function parseTitle(body) {
  const heading = /\\section\*\{([^}]*)\}/.exec(body);
  if (!heading) return null;

  const title = heading[1].trim();
  const match = /^([^\d]+?)\s+(\d+(?:\.\d+)*)(.*)$/.exec(title);
  if (!match) {
    return { title, key: title, index: '1' };
  }
  return { title, key: match[1].trim(), index: match[2] };
}

/**
 * Chapter number: the explicit `% CHAPTER_ORDER_` marker when present, else the
 * integer before the first dot of the title index ("1.1" → "1").
 */
function parseChapterOrder(body, titleInfo) {
  const explicit = readMetaValue(body, AB_META_PREFIXES.CHAPTER_ORDER);
  if (explicit) {
    const digits = /^(\d+)/.exec(explicit);
    if (digits) return digits[1];
  }
  if (titleInfo?.index?.includes('.')) {
    return titleInfo.index.split('.')[0];
  }
  return null;
}

/**
 * Sort order within a chapter: the part of the index after the chapter number
 * ("1.11" → 11). Unnumbered blocks fall back to their position in the source.
 */
export function parseOrder(titleInfo, fallback) {
  if (!titleInfo?.index) return fallback;
  const parts = titleInfo.index.split('.');
  const value = parts.length > 1 ? parseInt(parts.slice(1).join(''), 10) : parseInt(parts[0], 10);
  return Number.isNaN(value) ? fallback : value;
}

// ---------------------------------------------------------------------------
// Question extraction inside an exercise block
// ---------------------------------------------------------------------------

/**
 * Strip the annotation scaffolding from a question fragment: the "3. " label
 * prefix, the `\item` command, trailing `\\` line breaks and stray blank lines.
 * Math and everything else is left untouched.
 */
export function cleanQuestionText(raw) {
  // Scaffolding can stack in either order and repeat, e.g.
  //   "3.  \item Given that ..."          (enumerate form)
  //   "\item[1.] Classify the following"  (itemize with an explicit label)
  //   "1.  \item[1.] Find ..."            (both)
  // so strip repeatedly until the line stops shrinking rather than assuming one
  // fixed order.
  const stripPrefixes = (line) => {
    const patterns = [
      /^\s*\\item\s*/, // \item
      /^\s*\[[^\]]*\]\s*/, // [1.] — \item's optional label
      /^\s*\d+(?:\.\d+)*\s*[.)]\s*/, // 3. or 3)
    ];
    let previous;
    do {
      previous = line;
      for (const pattern of patterns) line = line.replace(pattern, '');
    } while (line !== previous);
    return line;
  };

  // Only the first non-empty line carries the label scaffolding. Stripping every
  // line would corrupt bodies whose continuation lines legitimately start with a
  // number (e.g. a step numbered "2." inside a worked solution).
  const lines = raw.split('\n');
  const firstContent = lines.findIndex((line) => line.trim() !== '');
  if (firstContent !== -1) {
    lines[firstContent] = stripPrefixes(lines[firstContent]);
  }

  return lines
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\\\\\s*$/, '')
    .trim();
}

/**
 * Leading "(i)" / "(a)" / "(1)" label of a sub-part or option, if present.
 *
 * OCR emits sub-parts in two shapes — a bare "(i) Every natural number ..." and
 * an itemize entry "\item[(i)] Every natural number ...". Reading only the bare
 * form dropped the printed roman numerals on `\item` lists and replaced them
 * with positional "(1)/(2)/(3)", which breaks matching against a solutions
 * document that prints the roman labels.
 */
export function readPartLabel(raw) {
  const trimmed = raw.trim();
  const inItem = /^\\item\s*\[\s*\(?\s*([ivxIVX]+|[a-zA-Z]|\d+)\s*\)?\s*\.?\s*\]/.exec(trimmed);
  if (inItem) return `(${inItem[1].toLowerCase()})`;

  const bare = /^\(([ivxIVX]+|[a-zA-Z]|\d+)\)/.exec(trimmed);
  return bare ? `(${bare[1].toLowerCase()})` : null;
}

/** Drop the leading "(i)" / "(a)" label so it isn't duplicated in the body. */
export function stripPartLabel(raw) {
  return raw.trim().replace(/^\(([ivxIVX]+|[a-zA-Z]|\d+)\)\s*/, '').replace(/\\\\\s*$/, '').trim();
}

/**
 * Collect every `% ST_<name><suffix>` … `% ED_<name><suffix>` pair, keyed by
 * the numeric suffix. `1.2` sorts after `1.1` and before `2`.
 */
export function collectSuffixedMarkers(body, startPrefix, endPrefix) {
  const escStart = startPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escEnd = endPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The end marker must repeat the same suffix; a mismatched pair is skipped by
  // the backreference rather than merging two questions.
  const re = new RegExp(`${escStart}(\\d+(?:\\.\\d+)*)\\s*\\n([\\s\\S]*?)${escEnd}\\1(?![\\d.])`, 'g');

  const found = [];
  let match;
  while ((match = re.exec(body)) !== null) {
    found.push({ suffix: match[1], content: match[2] });
  }
  return found;
}

/**
 * Number of opening markers for a family, regardless of whether they pair up.
 * Compared against the matched-pair count to catch annotation mistakes — a
 * duplicated or unclosed opener would otherwise drop a question silently.
 */
export function countOpeners(body, startPrefix) {
  const esc = startPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (body.match(new RegExp(`${esc}\\d`, 'g')) || []).length;
}

export function compareSuffix(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Build `toc_question_items` for one exercise block from its question markers.
 *
 * Three shapes are recognised, matching the three marker families:
 *   - MUL_QUE_TEXT_n + MUL_QUE_n.k  → stem with `sub_questions`
 *   - QUES_CHOICE_TEXT_n + QUES_CHOICE_n.k → MCQ set with `choices`
 *   - ST_QUE_n → plain question with an empty `sub_questions`
 */
function parseExerciseQuestions(body, warnings, blockLabel) {
  const items = [];

  const multiStems = collectSuffixedMarkers(
    body,
    '% ST_MUL_QUE_TEXT_',
    '% ED_MUL_QUE_TEXT_'
  );
  const choiceHeaders = collectSuffixedMarkers(
    body,
    '% ST_QUES_CHOICE_TEXT_',
    '% ED_QUES_CHOICE_TEXT_'
  );

  // MULTI_PART and CHOICE_ITEM share a prefix with their header markers, so
  // strip the header pairs out before scanning for parts.
  const withoutHeaders = body
    .replace(/% ST_MUL_QUE_TEXT_\d+(?:\.\d+)*\s*\n[\s\S]*?% ED_MUL_QUE_TEXT_\d+(?:\.\d+)*/g, '')
    .replace(/% ST_QUES_CHOICE_TEXT_\d+(?:\.\d+)*\s*\n[\s\S]*?% ED_QUES_CHOICE_TEXT_\d+(?:\.\d+)*/g, '');

  const multiParts = collectSuffixedMarkers(withoutHeaders, '% ST_MUL_QUE_', '% ED_MUL_QUE_');
  const choiceItems = collectSuffixedMarkers(withoutHeaders, '% ST_QUES_CHOICE_', '% ED_QUES_CHOICE_');
  const simple = collectSuffixedMarkers(body, '% ST_QUE_', '% ED_QUE_');

  // Unpaired openers mean a question was annotated but cannot be read — most
  // often a duplicated suffix or a missing closing marker. Report it loudly
  // instead of returning a block that is quietly short a question.
  const balanceChecks = [
    ['% ST_QUE_', simple.length, '% ED_QUE_'],
    ['% ST_MUL_QUE_TEXT_', multiStems.length, '% ED_MUL_QUE_TEXT_'],
    ['% ST_QUES_CHOICE_TEXT_', choiceHeaders.length, '% ED_QUES_CHOICE_TEXT_'],
    ['% ST_MUL_QUE_', multiParts.length, '% ED_MUL_QUE_'],
    ['% ST_QUES_CHOICE_', choiceItems.length, '% ED_QUES_CHOICE_'],
  ];
  for (const [prefix, matched, endPrefix] of balanceChecks) {
    const scope = prefix === '% ST_MUL_QUE_' || prefix === '% ST_QUES_CHOICE_' ? withoutHeaders : body;
    const opened = countOpeners(scope, prefix);
    if (opened !== matched) {
      warnings.push(
        `${blockLabel}: ${opened - matched} of ${opened} ${prefix}n markers could not be paired with ${endPrefix}n ` +
        `(duplicate suffix or missing closing marker) — those questions were skipped`
      );
    }
  }

  // Group parts / choice items by their parent question number.
  const partsByParent = new Map();
  for (const part of multiParts) {
    const parent = part.suffix.split('.')[0];
    if (!partsByParent.has(parent)) partsByParent.set(parent, []);
    partsByParent.get(parent).push(part);
  }

  const choicesByParent = new Map();
  for (const choice of choiceItems) {
    const parent = choice.suffix.split('.')[0];
    if (!choicesByParent.has(parent)) choicesByParent.set(parent, []);
    choicesByParent.get(parent).push(choice);
  }

  // Assemble one entry per question, ordered by question number.
  const entries = [];

  for (const stem of multiStems) {
    entries.push({ kind: 'multi', suffix: stem.suffix, stem, parts: partsByParent.get(stem.suffix) || [] });
  }
  for (const question of simple) {
    entries.push({ kind: 'simple', suffix: question.suffix, question });
  }
  // A choice set is a header plus its items; each item is its own question, so
  // the header text is lifted to the block and the items become questions.
  for (const header of choiceHeaders) {
    for (const choice of choicesByParent.get(header.suffix) || []) {
      entries.push({ kind: 'choice', suffix: choice.suffix, choice });
    }
  }
  // Choice items whose header was lost still become questions.
  for (const [parent, list] of choicesByParent) {
    if (choiceHeaders.some((h) => h.suffix === parent)) continue;
    for (const choice of list) {
      entries.push({ kind: 'choice', suffix: choice.suffix, choice });
    }
  }

  entries.sort((a, b) => compareSuffix(a.suffix, b.suffix));

  let hasChoices = false;
  let hasSubQuestions = false;

  entries.forEach((entry, index) => {
    const id = String(index + 1);

    if (entry.kind === 'multi') {
      const item = {
        id,
        question: cleanQuestionText(entry.stem.content),
        question_label: entry.suffix,
        sub_questions: entry.parts
          .slice()
          .sort((a, b) => compareSuffix(a.suffix, b.suffix))
          .map((part, partIndex) => ({
            id: `${id}.${partIndex + 1}`,
            question: stripPartLabel(cleanQuestionText(part.content)),
            question_label: readPartLabel(part.content) || `(${partIndex + 1})`,
          })),
      };
      if (item.sub_questions.length > 0) hasSubQuestions = true;
      if (item.sub_questions.length === 0) {
        warnings.push(`${blockLabel}: multi-part question ${entry.suffix} has no % ST_MUL_QUE_${entry.suffix}.n parts`);
      }
      items.push(item);
      return;
    }

    if (entry.kind === 'choice') {
      const { stem, options } = splitStemAndOptions(entry.choice.content);
      const suffixParts = entry.suffix.split('.');
      const item = {
        id,
        // The printed number moves to question_label; keeping it in the stem
        // would render as "(1) (1) If ..." next to the option list.
        question: stem.replace(/^\s*\((\d+)\)\s*/, ''),
        question_label:
          readPrintedNumber(entry.choice.content) || suffixParts[suffixParts.length - 1],
        choices: options.map((option, optionIndex) => ({
          id: `${id}.${optionIndex + 1}`,
          question: option.body,
          question_label: option.label,
        })),
      };
      if (item.choices.length > 0) hasChoices = true;
      items.push(item);
      return;
    }

    items.push({
      id,
      question: cleanQuestionText(entry.question.content),
      question_label: entry.suffix,
      sub_questions: [],
    });
  });

  warnOnQuestionNumberGaps(items, warnings, blockLabel);

  return {
    items,
    choiceHeaderText: choiceHeaders.length > 0 ? cleanQuestionText(choiceHeaders[0].content) : null,
    questionType: hasChoices
      ? QUESTION_TYPES.CHOICE_BASED
      : hasSubQuestions
        ? QUESTION_TYPES.MULTI_QUESTIONS
        : QUESTION_TYPES.OTHER,
  };
}

/**
 * Report gaps and duplicates in an exercise's printed question numbers.
 *
 * The annotator marks questions, and a question it fails to mark simply is not
 * there afterwards — the block parses cleanly and comes up short, which is
 * invisible without this check. The usual cause is a question the OCR stranded
 * between two `enumerate` environments: the list closes, one or two questions
 * sit as loose lines, a new list reopens with `\setcounter{enumi}{n}`, and the
 * loose ones are skipped.
 */
function warnOnQuestionNumberGaps(items, warnings, blockLabel) {
  const numbers = items
    .map((item) => parseInt(item.question_label, 10))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return;

  const seen = new Set(numbers);
  const highest = Math.max(...numbers);

  const missing = [];
  for (let n = 1; n <= highest; n++) {
    if (!seen.has(n)) missing.push(n);
  }
  if (missing.length > 0) {
    warnings.push(
      `${blockLabel}: question ${missing.join(', ')} not annotated — the printed numbers run to ` +
      `${highest} but only ${numbers.length} question${numbers.length === 1 ? '' : 's'} carry markers. ` +
      `Check for questions the OCR left outside \\begin{enumerate}.`
    );
  }
  if (seen.size !== numbers.length) {
    warnings.push(
      `${blockLabel}: duplicate question number(s) — ${numbers.length} questions share ${seen.size} ` +
      `distinct labels, so two questions were annotated with the same number.`
    );
  }
}

/**
 * Split an MCQ block into its stem and its answer options.
 *
 * Options are recognised at line start as "(a)"/"(A)"/"(1)" — the forms used by
 * CBSE and State board books. A line with no marker after options have started
 * continues the previous option (wrapped math).
 *
 * The first non-empty line is ALWAYS stem, never an option. State board books
 * number the question itself the same way they number its options:
 *
 *   (1) If $a_{ij} = \frac{1}{2}(3i-2j)$ and $A = [a_{ij}]_{2x2}$ is
 *   (1) <option>   (2) <option>   (3) <option>   (4) <option>
 *
 * so treating a leading marker on the first line as an option would swallow the
 * question text and yield five options.
 */
function splitStemAndOptions(raw) {
  const optionRe = /^\s*\\?\(?([a-eA-E]|[1-4])\)\s*(.*)$/;
  const stemLines = [];
  const options = [];
  let inOptions = false;
  let seenContent = false;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const match = seenContent ? optionRe.exec(trimmed) : null;
    seenContent = true;

    if (match) {
      inOptions = true;
      options.push({
        label: `(${match[1].toLowerCase()})`,
        body: match[2].replace(/\\\\\s*$/, '').trim(),
      });
      continue;
    }

    if (inOptions && options.length > 0) {
      const last = options[options.length - 1];
      last.body = `${last.body} ${trimmed.replace(/\\\\\s*$/, '')}`.trim();
      continue;
    }

    stemLines.push(line);
  }

  return { stem: cleanQuestionText(stemLines.join('\n')), options };
}

/**
 * Printed number at the start of a question, in either "3." or "(3)" form.
 * Used as the label for MCQ items, whose marker suffix encodes their position
 * in the choice set ("1.7") rather than the number shown to the student.
 */
function readPrintedNumber(raw) {
  const match = /^\s*\(?(\d+)\)?\s*[.)]?\s/.exec(raw.trim());
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Example grouping
// ---------------------------------------------------------------------------

/** A printed solution label, in the forms Mathpix leaves behind. */
const SOLUTION_LABEL_RE =
  /(?:^|\n)\s*\$?\s*(?:Solution|SOLUTION|Sol|தீர்வு)\s*\d*\s*\$?\s*[:.]\s*/;

/** Any stray half of a solution marker pair, so it never leaks into a field. */
const SOLUTION_MARKER_LINE_RE = new RegExp(
  `^[ \\t]*(?:${AB_MARKERS.SOLUTION_START}|${AB_MARKERS.SOLUTION_END})[ \\t]*$\n?`,
  'gm'
);

/** True for a line that is one of the two solution markers. */
export function isSolutionMarkerLine(line) {
  const trimmed = line.trim();
  return trimmed === AB_MARKERS.SOLUTION_START || trimmed === AB_MARKERS.SOLUTION_END;
}

/**
 * Split a worked example into its statement and its solution.
 *
 * Two sources for the boundary, in order of trust:
 *
 *  1. The annotator's `% ST_SOLUTION` … `% ED_SOLUTION` pair. Required, because
 *     State board books print the working straight after the statement with no
 *     label of any kind — "Find the rank of the matrix ..." is followed directly
 *     by "Let $A=...$", and no rule over the text alone separates them. Without
 *     the markers the whole example ended up in `question`.
 *  2. A printed "Solution :" label, for books that have one and for legacy
 *     hand-annotated files that predate the markers.
 *
 * Returns the whole thing as the statement when neither is present — better a
 * question with the working attached than a silently truncated one.
 */
function splitExampleBody(body) {
  const withoutLabel = body
    .trim()
    .replace(/^(?:Example|EXAMPLE|எடுத்துக்காட்டு)\s*\d+(?:\.\d+)*\s*[:.\-–]?\s*/, '');

  const clean = (text) => text.replace(SOLUTION_MARKER_LINE_RE, '').trim();

  const startIdx = withoutLabel.indexOf(AB_MARKERS.SOLUTION_START);
  if (startIdx !== -1) {
    const bodyStart = startIdx + AB_MARKERS.SOLUTION_START.length;
    const endIdx = withoutLabel.indexOf(AB_MARKERS.SOLUTION_END, bodyStart);
    // An unclosed opener means the annotation was truncated; the working still
    // runs to the end of the block, so take it rather than dropping it.
    const solutionRaw = withoutLabel.slice(bodyStart, endIdx === -1 ? withoutLabel.length : endIdx);

    // The marker sits before the printed label when there is one, so strip the
    // label here too — the same text is dropped on the fallback path below.
    const labelMatch = SOLUTION_LABEL_RE.exec(solutionRaw);
    const solution =
      labelMatch && solutionRaw.slice(0, labelMatch.index).trim() === ''
        ? solutionRaw.slice(labelMatch.index + labelMatch[0].length)
        : solutionRaw;

    return {
      statement: clean(withoutLabel.slice(0, startIdx)),
      solution: clean(solution),
    };
  }

  const solutionMatch = SOLUTION_LABEL_RE.exec(withoutLabel);
  if (!solutionMatch) {
    return { statement: clean(withoutLabel), solution: '' };
  }

  return {
    statement: clean(withoutLabel.slice(0, solutionMatch.index)),
    solution: clean(withoutLabel.slice(solutionMatch.index + solutionMatch[0].length)),
  };
}

/**
 * Identity of a section heading for grouping purposes: its number when it has
 * one ("1.1.4 Testing the consistency of ..." -> "1.1.4"), else the normalised
 * text.
 *
 * Grouping on the full heading text splits one sub-topic's examples into two
 * blocks whenever the annotator reproduces its title with even a small
 * difference — a long heading truncated in one chunk and complete in the next is
 * enough, and a chapter's examples routinely span a chunk boundary. The number
 * is stable across chunks; the text is not.
 */
export function sectionIdentity(name) {
  if (!name) return '';
  const number = /^\s*(\d+(?:\.\d+)*)/.exec(name);
  return number ? number[1] : name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The heading text to show for a group whose members disagree about it: the
 * longest, since the failure mode is truncation rather than invention.
 */
function canonicalSectionName(members, field, warnings, label) {
  const variants = [...new Set(members.map((m) => m[field]).filter((v) => v))];
  if (variants.length === 0) return members[0]?.[field] ?? '';
  if (variants.length > 1) {
    warnings.push(
      `${label}: examples disagree on ${field} — ${variants.map((v) => `"${v}"`).join(' vs ')}. ` +
      'Grouped by section number; keeping the longest.'
    );
  }
  return variants.reduce((longest, v) => (v.length > longest.length ? v : longest), variants[0]);
}

/** "Example" → "Examples" when a group holds more than one. */
function pluralizeKey(key, count) {
  if (count === 1) return key;
  if (key === 'Example') return 'Examples';
  if (key === 'எடுத்துக்காட்டு') return 'எடுத்துக்காட்டுகள்';
  return key;
}

/**
 * Collapse consecutive single examples into one block per
 * (chapter, common parent, parent) group — "Examples 1 - 5" — the way the
 * hand-annotated pipeline did. Each example becomes one `toc_question_items`
 * entry inside the group.
 */
function groupExamples(examples, warnings) {
  const groups = new Map();

  for (const example of examples) {
    const key = [
      example.chapter_order ?? '',
      sectionIdentity(example.common_parent_section_name),
      sectionIdentity(example.parent_section_name),
      example.key,
    ].join(' | ');

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(example);
  }

  const blocks = [];

  for (const members of groups.values()) {
    const ordered = members.slice().sort((a, b) => a.order - b.order);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const groupLabel =
      ordered.length === 1
        ? `${first.key} ${first.index}`
        : `${pluralizeKey(first.key, ordered.length)} ${first.index} - ${last.index}`;

    blocks.push({
      type: 'EXAMPLE',
      sourceOffset: first.sourceOffset,
      name: pluralizeKey(first.key, ordered.length),
      // An example group's name is already number-free; `key` exists so both
      // block types expose the same field to consumers.
      key: pluralizeKey(first.key, ordered.length),
      index: ordered.length === 1 ? first.index : `${first.index} - ${last.index}`,
      order: first.order,
      chapter_order: first.chapter_order,
      parent_section_name: canonicalSectionName(ordered, 'parent_section_name', warnings, groupLabel),
      common_parent_section_name: canonicalSectionName(
        ordered,
        'common_parent_section_name',
        warnings,
        groupLabel
      ),
      question_type: QUESTION_TYPES.OTHER,
      start_page: first.start_page,
      end_page: last.end_page,
      latex_content: ordered.map((example) => example.latex_content).join('\n'),
      toc_question_items: ordered.map((example, index) => {
        const { statement, solution } = splitExampleBody(example.body);
        const item = {
          id: String(index + 1),
          question: statement,
          question_label: example.index,
          sub_questions: [],
        };
        // Worked examples ship with their solution; carry it so lesson creation
        // can populate solution_context without a separate solution set.
        if (solution) {
          item.solution = solution;
        } else {
          // A worked example without working means the annotator marked no
          // statement/solution boundary, so the whole example — question AND
          // answer — is now sitting in `question`.
          warnings.push(
            `${first.key} ${example.index}: no solution content — the block carries no ` +
            `${AB_MARKERS.SOLUTION_START} pair and no printed "Solution :" label, so the working ` +
            `(if any) was stored as part of the question.`
          );
        }
        return item;
      }),
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse marker-annotated academic-book content into grouped blocks.
 *
 * @param {string} content annotated LaTeX
 * @returns {{ blocks: object[], warnings: string[] }}
 */
export function parseAcademicBookBlocks(content) {
  const warnings = [];

  if (typeof content !== 'string' || content.trim() === '') {
    return { blocks: [], warnings: ['Empty content — nothing to parse'] };
  }

  // --- exercises ---------------------------------------------------------
  const exerciseBlocks = extractBlockBodies(
    content,
    AB_MARKERS.EXERCISE_START,
    AB_MARKERS.EXERCISE_END,
    warnings
  ).map(({ body, offset }, position) => {
    const titleInfo = parseTitle(body);
    if (!titleInfo) {
      warnings.push(`Exercise block #${position + 1} has no \\section*{...} heading — using a generated name`);
    }

    const label = titleInfo?.title || `Exercise block #${position + 1}`;
    const { items, choiceHeaderText, questionType } = parseExerciseQuestions(body, warnings, label);

    if (items.length === 0) {
      warnings.push(`${label}: no question markers found — block has no items`);
    }

    const name = titleInfo?.title || `EXERCISE ${position + 1}`;

    const block = {
      type: 'EXERCISE',
      sourceOffset: offset,
      name,
      // The heading minus its number ("EXERCISE 1.1" → "EXERCISE"). Downstream
      // storage keeps the name and the index in separate fields, so the number
      // must not be baked into the name.
      key: titleInfo?.key || 'EXERCISE',
      index: titleInfo?.index || String(position + 1),
      order: parseOrder(titleInfo, position + 1),
      chapter_order: parseChapterOrder(body, titleInfo),
      // An exercise is its OWN common parent and has no parent section — it
      // belongs to the chapter, not to whichever sub-topic happens to precede
      // it. Derived from the block's own heading rather than read from the
      // annotation: the exercise's name is not a judgement call, and letting the
      // annotator supply it just gave the last `\subsection*{1.1.4 ...}` seen.
      common_parent_section_name: name,
      parent_section_name: '',
      question_type: questionType,
      start_page: parsePageNumber(body, AB_META_PREFIXES.PAGE_NO),
      end_page: parsePageNumber(body, AB_META_PREFIXES.END_PAGE_NO),
      latex_content: body.trim(),
      toc_question_items: items,
    };

    if (choiceHeaderText) {
      block.choice_question_header_text = choiceHeaderText;
    }

    return block;
  });

  // --- examples ----------------------------------------------------------
  const exampleModels = extractBlockBodies(
    content,
    AB_MARKERS.EXAMPLE_START,
    AB_MARKERS.EXAMPLE_END,
    warnings
  ).map(({ body, offset }, position) => {
    const titleInfo = parseTitle(body);
    if (!titleInfo) {
      warnings.push(`Example block #${position + 1} has no \\section*{Example n} heading — using its source position`);
    }

    // Everything except the metadata comments and the inserted heading is the
    // example itself (statement plus its Solution body). The solution markers
    // are the exception — they are the boundary `splitExampleBody` reads, so
    // they have to survive this filter and are stripped there instead.
    const exampleBody = body
      .split('\n')
      .filter(
        (line) =>
          (!/^\s*%/.test(line) || isSolutionMarkerLine(line)) && !/^\s*\\section\*\{/.test(line)
      )
      .join('\n')
      .trim();

    return {
      sourceOffset: offset,
      key: titleInfo?.key || 'Example',
      index: titleInfo?.index || String(position + 1),
      order: parseOrder(titleInfo, position + 1),
      chapter_order: parseChapterOrder(body, titleInfo),
      parent_section_name: parseParentSectionName(body),
      common_parent_section_name: parseCommonParentSectionName(body),
      start_page: parsePageNumber(body, AB_META_PREFIXES.PAGE_NO),
      end_page: parsePageNumber(body, AB_META_PREFIXES.END_PAGE_NO),
      latex_content: body.trim(),
      body: exampleBody,
    };
  });

  const blocks = [...exerciseBlocks, ...groupExamples(exampleModels, warnings)];

  // Chapter first, then the order the blocks appear in the book — the examples
  // for a topic, then that topic's exercise, then the next topic. Sorting by the
  // number in the heading instead put every example ahead of every exercise, and
  // collided "EXERCISE 1.1" with an unnumbered "Miscellaneous problems" (both
  // reduce to 1).
  blocks.sort((a, b) => {
    const chapterDiff = (parseInt(a.chapter_order, 10) || 0) - (parseInt(b.chapter_order, 10) || 0);
    if (chapterDiff !== 0) return chapterDiff;
    return a.sourceOffset - b.sourceOffset;
  });

  // `order` is the block's position in the chapter, which is what downstream
  // lesson creation sequences on. The heading number lives in `index`.
  blocks.forEach((block, position) => {
    block.order = position + 1;
    delete block.sourceOffset;
  });

  return { blocks, warnings };
}

export default parseAcademicBookBlocks;
