import { useMemo, memo } from 'react';
import { preprocessMathWithLatex } from '../lib/katexProcessor';
import { isNeededExtraLineHeight } from '../lib/katexLineHeight';
import 'katex/dist/katex.min.css';

/**
 * QuestionText - Displays question text with KaTeX math rendering
 *
 * Renders text containing LaTeX math expressions ($...$) using KaTeX.
 * Automatically detects tall math elements and applies extra line height.
 * Wrapped with React.memo to prevent re-renders when props haven't changed.
 *
 * @param {string} text - The question text to display (may contain $...$ LaTeX)
 * @param {string} className - Additional CSS classes
 */
function QuestionText({ text, className = '' }) {
  const processedContent = useMemo(() => {
    return preprocessMathWithLatex(text);
  }, [text]);

  const needsExtraLineHeight = useMemo(() => {
    return isNeededExtraLineHeight(text);
  }, [text]);

  // Use span for inline rendering, p for block rendering
  const isInline = className.includes('inline');
  const Element = isInline ? 'span' : 'p';

  return (
    <Element
      className={`text-base text-gray-800 ${needsExtraLineHeight ? 'leading-[3.5] py-2' : ''} ${className}`}
      dangerouslySetInnerHTML={{ __html: processedContent }}
    />
  );
}

export default memo(QuestionText);
