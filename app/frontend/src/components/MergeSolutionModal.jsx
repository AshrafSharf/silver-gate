import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { X, Loader2, AlertCircle, CheckCircle, RefreshCw, Edit2, Eye, Code } from 'lucide-react';
import QuestionText from './QuestionText';
import { buildSolutionLookup } from '../lib/solutionMatching';

// Read-only render for one merged lesson item: question + answer/worked/explanation/visual.
function ItemPreviewCard({ row, idx }) {
  return (
    <div
      className={`border rounded-lg p-4 ${
        row.matched ? 'border-green-200 bg-green-50/40' : 'border-amber-200 bg-amber-50/30'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {row.block_name && (
          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{row.block_name}</span>
        )}
        <span className="text-sm font-bold text-gray-700">Q{row.question_label || idx + 1}</span>
        {row.matched ? (
          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded">auto-matched</span>
        ) : (
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded">no match</span>
        )}
      </div>

      <div className="text-xs font-medium text-gray-500 mb-1">Question</div>
      <QuestionText text={row.text || ''} className="text-sm mb-2" />
      {row.choices?.length > 0 && (
        <div className="pl-4 mb-3 space-y-1">
          {row.choices.map((c, i) => (
            <QuestionText key={i} text={c} className="text-sm text-gray-600" />
          ))}
        </div>
      )}

      <div className="border-t mt-2 pt-2 space-y-2 text-sm">
        <div>
          <span className="text-xs font-medium text-gray-500">Answer:</span>{' '}
          {row.answer_key ? (
            <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold">
              {row.answer_key}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">Worked Solution:</div>
          {row.worked_solution ? (
            <div className="pl-3 border-l-2 border-purple-200">
              <QuestionText text={row.worked_solution} className="whitespace-pre-wrap text-sm" />
            </div>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </div>
        {row.explanation && (
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">Explanation:</div>
            <div className="pl-3 border-l-2 border-gray-200">
              <QuestionText text={row.explanation} className="text-gray-600 text-sm" />
            </div>
          </div>
        )}
        {row.visual_path && (
          <div className="text-xs text-gray-500 break-all">
            <span className="font-medium">visual_path:</span> {row.visual_path}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MergeSolutionModal({ isOpen, onClose, lesson }) {
  const queryClient = useQueryClient();
  const [selectedSolutionSetId, setSelectedSolutionSetId] = useState('');

  // 'preview' = read-only formatted view; 'edit' = JSON Editor + Preview sub-tabs.
  const [mode, setMode] = useState('preview');
  const [editTab, setEditTab] = useState('editor'); // 'editor' | 'preview'

  // The single source of truth for what will be Synced. Always rebuilt from
  // this string when needed so manual edits in the JSON Editor are honored.
  const [itemsJson, setItemsJson] = useState('[]');
  const [jsonError, setJsonError] = useState(null);

  const bookId = lesson?.book_id || '';
  const chapterId = lesson?.chapter_id || '';

  useEffect(() => {
    if (isOpen) {
      setSelectedSolutionSetId('');
      setMode('preview');
      setEditTab('editor');
      setItemsJson('[]');
      setJsonError(null);
    }
  }, [isOpen]);

  const { data: solutionSets } = useQuery({
    queryKey: ['solutionSets', bookId, chapterId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (bookId) params.append('bookId', bookId);
      if (chapterId) params.append('chapterId', chapterId);
      const qs = params.toString();
      return api.get(`/solution-sets${qs ? `?${qs}` : ''}`);
    },
    enabled: isOpen,
  });

  const sortedSolutionSets = useMemo(
    () =>
      solutionSets?.data
        ? [...solutionSets.data].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        : [],
    [solutionSets]
  );

  const { data: solutionSetDetail, isFetching: isFetchingSet } = useQuery({
    queryKey: ['solutionSet', selectedSolutionSetId],
    queryFn: () => api.get(`/solution-sets/${selectedSolutionSetId}`),
    enabled: isOpen && !!selectedSolutionSetId,
  });

  // Initial preview rows derived from lesson_items × matched solution.
  const initialRows = useMemo(() => {
    if (!selectedSolutionSetId) return [];
    const lessonItems = lesson?.lesson_items || [];
    // Academic Book solutions are keyed on (block, label) — see solutionMatching.
    const lookup = buildSolutionLookup(solutionSetDetail?.data?.solutions);
    return lessonItems.map((li) => {
      const label =
        li.question_label !== null && li.question_label !== undefined
          ? String(li.question_label)
          : null;
      const j = li.question_solution_item_json || {};
      const matched = lookup({
        question_label: j.question_label ?? label,
        block_type: j.block_type,
        block_index: j.block_index,
      });
      return {
        item_id: li.id,
        question_label: label || j.question_label || '',
        block_name: j.block_name || null,
        text: j.text || '',
        choices: j.choices || [],
        matched: !!matched,
        answer_key: matched?.answer_key ?? j.answer_key ?? '',
        worked_solution: matched?.worked_solution ?? j.worked_solution ?? '',
        explanation: matched?.explanation ?? j.explanation ?? '',
        visual_path: matched?.visual_path ?? j.visual_path ?? '',
      };
    });
  }, [selectedSolutionSetId, solutionSetDetail, lesson]);

  // Reset itemsJson + mode whenever a fresh preview is computed (new selection).
  useEffect(() => {
    if (initialRows.length === 0) {
      setItemsJson('[]');
      setJsonError(null);
      return;
    }
    setItemsJson(JSON.stringify(initialRows, null, 2));
    setJsonError(null);
    setMode('preview');
    setEditTab('editor');
  }, [initialRows]);

  // Parse the current JSON into rows; keep last good rows on parse error so the
  // preview tab in edit mode doesn't blank out.
  const parsedRows = useMemo(() => {
    try {
      const parsed = JSON.parse(itemsJson || '[]');
      if (!Array.isArray(parsed)) {
        return { rows: [], error: 'JSON must be an array' };
      }
      return { rows: parsed, error: null };
    } catch (err) {
      return { rows: null, error: err.message };
    }
  }, [itemsJson]);

  // Surface JSON parse errors to the editor tab.
  useEffect(() => {
    setJsonError(parsedRows.error);
  }, [parsedRows.error]);

  const rowsForRender = parsedRows.rows ?? initialRows;
  const matchedCount = initialRows.filter((r) => r.matched).length;

  const syncMutation = useMutation({
    mutationFn: () => {
      // Always re-parse the latest text so the user's last keystroke is honored.
      let payloadRows = initialRows;
      try {
        const parsed = JSON.parse(itemsJson || '[]');
        if (Array.isArray(parsed)) payloadRows = parsed;
      } catch {
        // fall through with initial rows
      }
      const itemsPayload = payloadRows
        .filter((r) => r && r.item_id)
        .map((r) => ({
          item_id: r.item_id,
          answer_key: r.answer_key ?? '',
          worked_solution: r.worked_solution ?? '',
          explanation: r.explanation ?? '',
          visual_path: r.visual_path ?? '',
        }));
      return api.post(`/lessons/${lesson.id}/merge-solution`, {
        solution_set_id: selectedSolutionSetId,
        items: itemsPayload,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lessons'] });
      await queryClient.refetchQueries({ queryKey: ['lessons'] });
      // Keep the success banner visible briefly so the user sees the count, then close.
      setTimeout(() => handleClose(), 1200);
    },
  });

  const handleClose = () => {
    setSelectedSolutionSetId('');
    setItemsJson('[]');
    setJsonError(null);
    setMode('preview');
    setEditTab('editor');
    syncMutation.reset();
    onClose();
  };

  if (!isOpen) return null;

  const result = syncMutation.data?.data;
  const canSync =
    !!selectedSolutionSetId &&
    initialRows.length > 0 &&
    !syncMutation.isPending &&
    !jsonError;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-gray-800 truncate">
              Merge Solution {lesson?.name ? `— ${lesson.name}` : ''}
            </h2>
            {lesson && (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                {lesson.book?.display_name || lesson.book?.name ? (
                  <span>
                    <span className="font-medium text-gray-500">Book:</span>{' '}
                    {lesson.book.display_name || lesson.book.name}
                  </span>
                ) : null}
                {lesson.chapter?.display_name || lesson.chapter?.name ? (
                  <span>
                    <span className="font-medium text-gray-500">Chapter:</span>{' '}
                    {lesson.chapter.display_name || lesson.chapter.name}
                  </span>
                ) : null}
                <span>
                  <span className="font-medium text-gray-500">Items:</span>{' '}
                  {lesson.lesson_items?.length ?? 0}
                </span>
              </div>
            )}
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-lg ml-3">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4 pb-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Extracted Solutions <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedSolutionSetId}
            onChange={(e) => setSelectedSolutionSetId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            required
          >
            <option value="">Select a solution set</option>
            {sortedSolutionSets.map((ss) => (
              <option key={ss.id} value={ss.id}>
                {ss.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-gray-500">
            Question Bank items are matched by <code>question_label</code>; Academic Book
            items by their block plus that label, so the same number in two exercises
            cannot cross over. Review the preview, click{' '}
            <span className="font-medium">Edit</span> to tweak the JSON, then click{' '}
            <span className="font-medium">Sync</span> to save.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {!selectedSolutionSetId ? (
            <div className="p-8 text-center text-sm text-gray-500">
              Pick a solution set to load the preview.
            </div>
          ) : isFetchingSet ? (
            <div className="p-8 flex items-center justify-center text-gray-500 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading solutions…
            </div>
          ) : initialRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              This lesson has no items to merge into.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-gray-600">
                  {matchedCount} of {initialRows.length} item
                  {initialRows.length === 1 ? '' : 's'} have an auto-matched solution.
                </div>
                {mode === 'preview' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('edit');
                      setEditTab('editor');
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    <Edit2 className="w-4 h-4" /> Edit
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMode('preview')}
                    disabled={!!jsonError}
                    title={jsonError ? 'Fix JSON errors first' : 'Done editing'}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    <Eye className="w-4 h-4" /> Done
                  </button>
                )}
              </div>

              {mode === 'preview' ? (
                <div className="space-y-3">
                  {initialRows.map((row, idx) => (
                    <ItemPreviewCard key={row.item_id} row={row} idx={idx} />
                  ))}
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center border-b bg-gray-50">
                    <button
                      type="button"
                      onClick={() => setEditTab('editor')}
                      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-r ${
                        editTab === 'editor'
                          ? 'bg-white text-indigo-700 border-b-2 border-b-indigo-600'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <Code className="w-4 h-4" /> JSON Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTab('preview')}
                      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium ${
                        editTab === 'preview'
                          ? 'bg-white text-indigo-700 border-b-2 border-b-indigo-600'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <Eye className="w-4 h-4" /> Preview
                    </button>
                  </div>

                  {editTab === 'editor' ? (
                    <div>
                      <textarea
                        value={itemsJson}
                        onChange={(e) => setItemsJson(e.target.value)}
                        spellCheck={false}
                        className="w-full h-[46vh] p-3 font-mono text-xs border-0 focus:outline-none focus:ring-0 resize-none"
                      />
                      {jsonError && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 border-t border-red-200 text-sm text-red-700">
                          <AlertCircle className="w-4 h-4 mt-0.5" />
                          <span>Invalid JSON: {jsonError}</span>
                        </div>
                      )}
                    </div>
                  ) : jsonError ? (
                    <div className="p-6 text-sm text-red-700 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5" />
                      <span>Cannot preview — fix JSON in the editor tab first: {jsonError}</span>
                    </div>
                  ) : (
                    <div className="max-h-[46vh] overflow-y-auto p-3 space-y-3 bg-white">
                      {(parsedRows.rows || []).map((row, idx) => (
                        <ItemPreviewCard key={row.item_id || idx} row={row} idx={idx} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {syncMutation.isError && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <span>
                {syncMutation.error?.response?.data?.error ||
                  syncMutation.error?.message ||
                  'Failed to sync solution context'}
              </span>
            </div>
          )}

          {result && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              <CheckCircle className="w-4 h-4 mt-0.5" />
              <div>
                <div className="font-medium">
                  Synced {result.matched} of {result.total_items} item
                  {result.total_items === 1 ? '' : 's'}.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={!canSync}
            title={jsonError ? 'Fix JSON errors first' : ''}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {syncMutation.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <RefreshCw className="w-5 h-5" />
            )}
            Sync
          </button>
        </div>
      </div>
    </div>
  );
}
