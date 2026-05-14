import katex from 'katex';

// Match display math $$...$$ first (greedy to avoid matching empty)
const DISPLAY_MATH_REGEX = /\$\$([\s\S]+?)\$\$/g;
// Match inline math $...$ (but not $$)
const INLINE_MATH_REGEX = /\$([^$]+)\$/g;

// Pattern for invalid LaTeX that should become line breaks (e.g., $\\\\$, $\\$)
const LINEBREAK_PATTERN = /\$\\{2,}\$/g;

function convertToKatex(content, displayMode = false) {
  if (!content || !content.trim()) return '';

  // Normalize double-escaped backslashes in LaTeX commands (\\\\command -> \\command)
  let normalizedContent = content.trim();
  // Fix double-escaped LaTeX commands like \\\\dfrac -> \\dfrac
  normalizedContent = normalizedContent.replace(/\\{4}([a-zA-Z])/g, '\\$1');
  // Fix triple-escaped backslashes
  normalizedContent = normalizedContent.replace(/\\{3}([a-zA-Z])/g, '\\$1');

  // KaTeX's throwOnError:false only suppresses ParseError — it still throws
  // generic Errors for internal build failures. Catch everything so a single
  // malformed expression can't crash the React tree.
  try {
    return katex.renderToString(normalizedContent, {
      throwOnError: false,
      trust: true, // Enable \htmlClass for colored boxes
      displayMode,
    });
  } catch {
    return '';
  }
}

export function preprocessMathWithLatex(paraText) {
  if (!paraText) return '';

  let result = paraText;

  // Convert standalone backslash patterns meant to be line breaks to <br>
  result = result.replace(LINEBREAK_PATTERN, '<br>');

  // Fix adjacent inline math: $...$$(...)$ -> $...$ $(...)$
  // This prevents $$ from being mistakenly interpreted as display math delimiter
  // Matches $$ followed by ( or - or a letter (common starts of inline math).
  // NOTE: backslash is intentionally excluded — legitimate display math very
  // commonly starts with a command ($$\begin, $$\frac, $$\sum), and splitting
  // those corrupts the $$...$$ pairing.
  result = result.replace(/\$\$([\(\-a-zA-Z])/g, '$ $$$1');

  // First, handle display math $$...$$ (block mode)
  result = result.replace(DISPLAY_MATH_REGEX, (match, content) => {
    const rendered = convertToKatex(content, true);
    return rendered || match;
  });

  // Then, handle inline math $...$ (but not empty $$ which would be left from display math)
  result = result.replace(INLINE_MATH_REGEX, (match, content) => {
    const rendered = convertToKatex(content, false);
    return rendered || match;
  });

  return result;
}

export default preprocessMathWithLatex;
