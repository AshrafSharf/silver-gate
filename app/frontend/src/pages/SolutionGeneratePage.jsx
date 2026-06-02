import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Wand2, Loader2, AlertCircle, CheckCircle2, Play } from 'lucide-react';
import { api } from '../lib/api';

export default function SolutionGeneratePage() {
  const [boardFilter, setBoardFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [bookChoice, setBookChoice] = useState('');
  const [chapterChoice, setChapterChoice] = useState('');
  const [parentChoice, setParentChoice] = useState(''); // '' = all sections
  const [jobId, setJobId] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Portal books (reused from the Generate Section feature).
  const { data: books, isLoading: booksLoading } = useQuery({
    queryKey: ['portalBooks'],
    queryFn: () => api.get('/scanned-items/portal-books'),
    staleTime: 0,
  });

  // Portal chapters for the selected book.
  const { data: chapters, isLoading: chaptersLoading } = useQuery({
    queryKey: ['portalChapters', bookChoice],
    queryFn: () => api.get(`/scanned-items/portal-books/${bookChoice}/chapters`),
    enabled: !!bookChoice,
    staleTime: 0,
  });

  // Common parent sections in the selected chapter (each groups many exercises).
  const { data: parents, isLoading: parentsLoading } = useQuery({
    queryKey: ['solutionRefineCommonParents', chapterChoice],
    queryFn: () => api.get(`/solution-refine/chapter/${chapterChoice}/common-parents`),
    enabled: !!chapterChoice,
    staleTime: 0,
  });

  // Latest job for the current selection (chapter + optional section) — lets us
  // resume the progress view.
  const { data: chapterJob } = useQuery({
    queryKey: ['solutionRefineChapterJob', chapterChoice, parentChoice],
    queryFn: () =>
      api.get(`/solution-refine/chapter/${chapterChoice}/job${parentChoice ? `?commonParent=${encodeURIComponent(parentChoice)}` : ''}`),
    enabled: !!chapterChoice,
    staleTime: 0,
  });

  // Adopt a still-running job for the chapter so progress keeps showing.
  useEffect(() => {
    const existing = chapterJob?.data;
    if (existing && !jobId) setJobId(existing.id);
  }, [chapterJob, jobId]);

  // Poll the active job while it's running.
  const { data: jobStatus } = useQuery({
    queryKey: ['solutionRefineJob', jobId],
    queryFn: () => api.get(`/solution-refine/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) =>
      query.state.data?.data?.status === 'running' ? 2000 : false,
  });

  const startMutation = useMutation({
    mutationFn: ({ chapterId, commonParent }) =>
      api.post(`/solution-refine/chapter/${chapterId}`, commonParent ? { commonParent } : {}),
    onSuccess: (res) => {
      setJobId(res.data.id);
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(err.message || 'Failed to start refinement'),
  });

  const allBooks = books?.data ?? [];
  const boards = [...new Set(allBooks.map((b) => b.board).filter(Boolean))].sort();
  const grades = [...new Set(allBooks.map((b) => b.grade).filter(Boolean))].sort();
  const filteredBooks = allBooks.filter(
    (b) => (!boardFilter || b.board === boardFilter) && (!gradeFilter || b.grade === gradeFilter)
  );
  const chapterList = chapters?.data ?? [];
  const parentList = parents?.data ?? [];

  const job = jobStatus?.data || chapterJob?.data || null;
  const isRunning = job?.status === 'running';
  const progressPct = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setBookChoice('');
    setChapterChoice('');
    setParentChoice('');
    setJobId(null);
  };

  const handleBookChange = (e) => {
    setBookChoice(e.target.value);
    setChapterChoice('');
    setParentChoice('');
    setJobId(null);
  };

  const handleChapterChange = (e) => {
    setChapterChoice(e.target.value);
    setParentChoice('');
    setJobId(null);
  };

  const handleParentChange = (e) => {
    setParentChoice(e.target.value);
    setJobId(null);
  };

  const handleGenerate = () => {
    setErrorMsg(null);
    if (!chapterChoice) {
      setErrorMsg('Select a chapter first.');
      return;
    }
    startMutation.mutate({ chapterId: chapterChoice, commonParent: parentChoice || null });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Solution Generate</h1>
        <p className="text-gray-500 mt-1">
          Pick a book and chapter (and optionally a single section), then refine those
          solutions with DeepSeek. The job runs in the background and saves the refined
          solutions back to the portal.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 max-w-2xl space-y-4">
        {/* Board / Grade filters */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Board</label>
            <select
              value={boardFilter}
              onChange={handleFilterChange(setBoardFilter)}
              disabled={booksLoading}
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
              disabled={booksLoading}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">All grades</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        {/* Book */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Book</label>
          <select
            value={bookChoice}
            onChange={handleBookChange}
            disabled={booksLoading}
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
        </div>

        {/* Chapter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Chapter</label>
          <select
            value={chapterChoice}
            onChange={handleChapterChange}
            disabled={!bookChoice || chaptersLoading}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="">
              {!bookChoice ? '— Select a book first —' : '— Select a chapter —'}
            </option>
            {chapterList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.order != null ? `Ch ${c.order}: ` : ''}{c.name}
                {c.exerciseCount > 0 ? ` (${c.exerciseCount} exercise${c.exerciseCount === 1 ? '' : 's'})` : ' (empty)'}
              </option>
            ))}
          </select>
        </div>

        {/* Section / common parent (optional scope) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
          <select
            value={parentChoice}
            onChange={handleParentChange}
            disabled={!chapterChoice || parentsLoading}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="">
              {!chapterChoice ? '— Select a chapter first —' : 'All sections in chapter'}
            </option>
            {parentList.map((p) => (
              <option key={p.commonParent} value={p.commonParent}>
                {p.commonParent}
                {` — ${p.exerciseCount} exercise${p.exerciseCount === 1 ? '' : 's'}, ${p.solutionCount} solution${p.solutionCount === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Leave as <em>All sections</em> to refine the whole chapter, or pick one section
            (e.g. <em>1.4 NEWTON'S LAWS OF MOTION</em>) to refine every solution under it. The
            original is backed up to <code>step_output_json_original</code> before it is overwritten.
          </p>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div>
          <button
            onClick={handleGenerate}
            disabled={!chapterChoice || isRunning || startMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isRunning || startMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isRunning ? 'Refining…' : 'Starting…'}
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Generate
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress */}
      {job && (
        <div className="bg-white rounded-lg shadow p-6 max-w-2xl mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isRunning ? (
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              ) : job.status === 'completed' ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
              <span className="font-medium text-gray-800">
                {job.bookName ? `${job.bookName} — ` : ''}{job.chapterName}
                {job.commonParent ? ` — ${job.commonParent}` : ' — all sections'}
              </span>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${
              isRunning ? 'bg-blue-100 text-blue-700'
                : job.status === 'completed' ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}>
              {job.status}
            </span>
          </div>

          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{job.processed} / {job.total} processed</span>
              <span>{progressPct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full ${job.status === 'failed' ? 'bg-red-500' : 'bg-blue-600'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            <div className="bg-gray-50 rounded p-2">
              <div className="font-semibold text-gray-800">{job.total}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            <div className="bg-green-50 rounded p-2">
              <div className="font-semibold text-green-700">{job.refined}</div>
              <div className="text-xs text-gray-500">Refined</div>
            </div>
            <div className="bg-yellow-50 rounded p-2">
              <div className="font-semibold text-yellow-700">{job.skipped}</div>
              <div className="text-xs text-gray-500">Skipped</div>
            </div>
            <div className="bg-red-50 rounded p-2">
              <div className="font-semibold text-red-700">{job.failed}</div>
              <div className="text-xs text-gray-500">Failed</div>
            </div>
          </div>

          {job.errors?.length > 0 && (
            <div className="border border-red-200 rounded overflow-hidden">
              <div className="bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                Errors ({job.errors.length})
              </div>
              <div className="max-h-40 overflow-y-auto divide-y text-xs">
                {job.errors.map((e, i) => (
                  <div key={i} className="px-3 py-2">
                    {e.solutionId && <span className="font-mono text-gray-500">{e.solutionId}: </span>}
                    <span className="text-gray-700">{e.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
