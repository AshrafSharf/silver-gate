import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import { api } from '../lib/api';

export default function GenerateSectionModal({ open, item, onClose }) {
  const queryClient = useQueryClient();

  const [boardFilter, setBoardFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [bookChoice, setBookChoice] = useState(''); // '' | <portal book id>
  const [chapterChoice, setChapterChoice] = useState(''); // '' | <portal chapter id>
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Reset state every time the modal opens for a new item.
  useEffect(() => {
    if (open) {
      setBoardFilter('');
      setGradeFilter('');
      setBookChoice('');
      setChapterChoice('');
      setResult(null);
      setErrorMsg(null);
    }
  }, [open, item?.id]);

  const { data: books, isLoading: booksLoading } = useQuery({
    queryKey: ['portalBooks'],
    queryFn: () => api.get('/scanned-items/portal-books'),
    enabled: open,
    // Always refetch when modal opens — stops the dropdown from showing books
    // that were deleted from MongoDB between sessions.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Chapters for the selected book — the user picks the exact chapter that the
  // generated exercises are inserted into (nothing is auto-created).
  const { data: chapters, isLoading: chaptersLoading } = useQuery({
    queryKey: ['portalChapters', bookChoice],
    queryFn: () => api.get(`/scanned-items/portal-books/${bookChoice}/chapters`),
    enabled: open && !!bookChoice,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const mutation = useMutation({
    mutationFn: (payload) => api.post(`/scanned-items/${item.id}/generate-section`, payload),
    onSuccess: (res) => {
      setResult(res.data);
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['scannedItems'] });
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Generation failed');
      setResult(null);
    },
  });

  if (!open || !item) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!bookChoice) {
      setErrorMsg('Select a book.');
      return;
    }
    if (!chapterChoice) {
      setErrorMsg('Select a chapter to generate sections into.');
      return;
    }

    mutation.mutate({ bookId: bookChoice, chapterId: chapterChoice });
  };

  const disabled = mutation.isPending;

  // Build Board/Grade filter options from the books we actually have, then
  // narrow the Book dropdown to whatever matches the active filters.
  const allBooks = books?.data ?? [];
  const boards = [...new Set(allBooks.map((b) => b.board).filter(Boolean))].sort();
  const grades = [...new Set(allBooks.map((b) => b.grade).filter(Boolean))].sort();
  const filteredBooks = allBooks.filter(
    (b) => (!boardFilter || b.board === boardFilter) && (!gradeFilter || b.grade === gradeFilter)
  );

  // Changing a filter may hide the currently-selected book — clear book and
  // chapter so we never submit something that's no longer visible.
  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setBookChoice('');
    setChapterChoice('');
  };

  const chapterList = chapters?.data ?? [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">Generate Section</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" disabled={disabled}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-600">
            Source: <span className="font-medium text-gray-800">{item.item_data}</span>
          </div>

          {result ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">
                  Generated {result.exerciseCount} section{result.exerciseCount === 1 ? '' : 's'}
                  {result.exerciseItemCount != null && (
                    <> ({result.exerciseItemCount} item{result.exerciseItemCount === 1 ? '' : 's'},{' '}
                    {result.exerciseSolutionCount} solution{result.exerciseSolutionCount === 1 ? '' : 's'})</>
                  )}
                </span>
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                <div>Book: {result.bookId}</div>
                {result.bookGroupId && <div>BookGroup: {result.bookGroupId}</div>}
                <div>Chapter: {result.chapterId}</div>
              </div>
              <div className="border rounded overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">Exercises</div>
                <div className="max-h-60 overflow-y-auto divide-y text-sm">
                  {result.exercises.map((e) => (
                    <div key={`${e.index}-${e.order}`} className="px-3 py-2">
                      <div className="font-mono text-xs text-gray-500">#{e.order} • {e.index || '—'}</div>
                      <div className="text-gray-800">{e.name}</div>
                      <div className="text-xs text-gray-500">↳ {e.parent_section_name}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Board</label>
                  <select
                    value={boardFilter}
                    onChange={handleFilterChange(setBoardFilter)}
                    disabled={disabled || booksLoading}
                    className="w-full border rounded px-3 py-2 text-sm"
                  >
                    <option value="">All boards</option>
                    {boards.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grade</label>
                  <select
                    value={gradeFilter}
                    onChange={handleFilterChange(setGradeFilter)}
                    disabled={disabled || booksLoading}
                    className="w-full border rounded px-3 py-2 text-sm"
                  >
                    <option value="">All grades</option>
                    {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Book</label>
                <select
                  value={bookChoice}
                  onChange={(e) => {
                    setBookChoice(e.target.value);
                    setChapterChoice('');
                  }}
                  disabled={disabled || booksLoading}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">— Select a book —</option>
                  {filteredBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.grade || b.subject ? ` (${[b.grade, b.subject].filter(Boolean).join(' · ')})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {booksLoading
                    ? 'Loading books…'
                    : `${filteredBooks.length} book${filteredBooks.length === 1 ? '' : 's'} match.`}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chapter</label>
                <select
                  value={chapterChoice}
                  onChange={(e) => setChapterChoice(e.target.value)}
                  disabled={disabled || !bookChoice || chaptersLoading}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">
                    {!bookChoice ? '— Select a book first —' : '— Select a chapter —'}
                  </option>
                  {chapterList.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.exerciseCount > 0}>
                      {c.order != null ? `Ch ${c.order}: ` : ''}{c.name}
                      {c.exerciseCount > 0 ? ` — has ${c.exerciseCount} exercise${c.exerciseCount === 1 ? '' : 's'}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {!bookChoice
                    ? 'Pick a book to load its chapters.'
                    : chaptersLoading
                      ? 'Loading chapters…'
                      : `${chapterList.length} chapter${chapterList.length === 1 ? '' : 's'}. Chapters that already have exercises can't be selected — pick an empty one. Exercises are inserted directly into the chosen chapter; nothing is created.`}
                </p>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={disabled}
                  className="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disabled}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {disabled ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
