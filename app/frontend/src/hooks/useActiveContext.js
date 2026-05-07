import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const STORAGE_KEY = 'silvergate.activeContext';
const VALID_TYPES = new Set(['question', 'solution']);

const readStorage = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeStorage = (ctx) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    // ignore quota / privacy-mode failures
  }
};

/**
 * URL-first / localStorage-fallback context for the user's active book,
 * chapter, and item-type selection.
 *
 * - URL search params (?book=&chapter=&type=) are the source of truth.
 * - On mount, if the URL is bare, hydrate it from localStorage.
 * - Whenever URL values are present, mirror them to localStorage so the
 *   next bare-URL tab gets the same defaults.
 * - Each tab is independent: changing the URL in one tab does not push to
 *   other tabs that already have a pinned URL.
 */
export function useActiveContext() {
  const [params, setParams] = useSearchParams();

  const urlBook = params.get('book') || '';
  const urlChapter = params.get('chapter') || '';
  const urlType = params.get('type') || '';

  // Hydrate bare URL from localStorage on mount.
  useEffect(() => {
    if (urlBook || urlChapter || urlType) return;
    const stored = readStorage();
    if (!stored.book && !stored.chapter && !stored.type) return;
    const next = new URLSearchParams(params);
    if (stored.book) next.set('book', stored.book);
    if (stored.chapter) next.set('chapter', stored.chapter);
    if (stored.type && VALID_TYPES.has(stored.type)) next.set('type', stored.type);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror URL → localStorage whenever values are present.
  useEffect(() => {
    if (urlBook || urlChapter || urlType) {
      writeStorage({ book: urlBook, chapter: urlChapter, type: urlType });
    }
  }, [urlBook, urlChapter, urlType]);

  const setContext = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      if (patch.book !== undefined) {
        if (patch.book) next.set('book', patch.book);
        else next.delete('book');
      }
      if (patch.chapter !== undefined) {
        if (patch.chapter) next.set('chapter', patch.chapter);
        else next.delete('chapter');
      }
      if (patch.type !== undefined) {
        if (patch.type && VALID_TYPES.has(patch.type)) next.set('type', patch.type);
        else next.delete('type');
      }
      setParams(next, { replace: false });
    },
    [params, setParams]
  );

  return {
    bookId: urlBook || '',
    chapterId: urlChapter || '',
    itemType: VALID_TYPES.has(urlType) ? urlType : 'question',
    setContext,
  };
}
