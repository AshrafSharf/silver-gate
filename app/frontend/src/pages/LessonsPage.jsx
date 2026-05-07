import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { BookOpen, Filter, Eye, Trash2, Calendar, FileQuestion, CheckCircle, Plus, FolderOpen, X, Loader2, CheckCircle2, AlertCircle, Square, CheckSquare, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import LessonModal from '../components/LessonModal';
import PrepareLessonModal from '../components/PrepareLessonModal';
import CreateLessonModal from '../components/CreateLessonModal';
import { useActiveContext } from '../hooks/useActiveContext';

export default function LessonsPage() {
  const queryClient = useQueryClient();

  // Active context (URL ?book=&chapter= with localStorage hydration)
  const { bookId: selectedBookId, chapterId: selectedChapterId, setContext } = useActiveContext();

  // State for viewing/editing
  const [viewingLesson, setViewingLesson] = useState(null);
  const [showPrepareModal, setShowPrepareModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // State for sorting
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 text-gray-300" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1 text-indigo-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-indigo-600" />;
  };

  // State for multi-selection
  const [selectedLessonIds, setSelectedLessonIds] = useState(new Set());

  // State for folder creation modal (now for multiple lessons)
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [folderResult, setFolderResult] = useState(null);

  // Fetch books for dropdown
  const { data: books } = useQuery({
    queryKey: ['books'],
    queryFn: () => api.get('/books'),
  });

  // Fetch chapters for selected book
  const { data: chapters } = useQuery({
    queryKey: ['chapters', selectedBookId],
    queryFn: () => api.get(`/chapters/book/${selectedBookId}`),
    enabled: !!selectedBookId,
  });

  // Fetch lessons filtered by book/chapter
  const { data: lessons, isLoading } = useQuery({
    queryKey: ['lessons', selectedBookId, selectedChapterId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedBookId) params.append('bookId', selectedBookId);
      if (selectedChapterId) params.append('chapterId', selectedChapterId);
      const queryString = params.toString();
      return api.get(`/lessons${queryString ? `?${queryString}` : ''}`);
    },
  });

  // Delete lesson mutation
  const deleteLessonMutation = useMutation({
    mutationFn: (id) => api.delete(`/lessons/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['lessons']);
    },
  });

  // Create folders mutation (now handles multiple lessons)
  const createFoldersMutation = useMutation({
    mutationFn: ({ lessonIds, basePath }) =>
      api.post('/lessons/create-folders', { lessonIds, basePath }),
    onSuccess: (response) => {
      setFolderResult({ success: true, data: response.data });
      setSelectedLessonIds(new Set()); // Clear selection after success
    },
    onError: (error) => {
      setFolderResult({ success: false, error: error.response?.data?.error || error.message });
    },
  });

  // Selection handlers
  const handleSelectLesson = (lessonId, e) => {
    e.stopPropagation();
    setSelectedLessonIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(lessonId)) {
        newSet.delete(lessonId);
      } else {
        newSet.add(lessonId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedLessonIds.size === sortedLessons.length) {
      setSelectedLessonIds(new Set());
    } else {
      setSelectedLessonIds(new Set(sortedLessons.map(l => l.id)));
    }
  };

  // Reset selection when filters change
  useEffect(() => {
    setSelectedLessonIds(new Set());
  }, [selectedBookId, selectedChapterId]);

  const handleDelete = (id, name) => {
    if (window.confirm(`Are you sure you want to delete the lesson "${name}"?`)) {
      deleteLessonMutation.mutate(id);
    }
  };

  const sortedLessons = lessons?.data
    ? [...lessons.data].sort((a, b) => {
        let aVal, bVal;
        switch (sortField) {
          case 'name':
            aVal = (a.name || '').toLowerCase();
            bVal = (b.name || '').toLowerCase();
            break;
          case 'section':
            aVal = (a.common_parent_section_name || '').toLowerCase();
            bVal = (b.common_parent_section_name || '').toLowerCase();
            break;
          case 'range':
            aVal = a.question_range || '';
            bVal = b.question_range || '';
            break;
          case 'order':
            aVal = a.display_order ?? -1;
            bVal = b.display_order ?? -1;
            break;
          case 'items':
            aVal = a.lesson_items?.length || 0;
            bVal = b.lesson_items?.length || 0;
            break;
          case 'created_at':
          default:
            aVal = new Date(a.created_at).getTime();
            bVal = new Date(b.created_at).getTime();
            break;
        }
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
      })
    : [];

  const getLessonCount = (lesson) => {
    return lesson.lesson_items?.length || 0;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Lessons</h1>
          <p className="text-gray-500 mt-1">View and manage your saved lessons</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPrepareModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Prepare Lesson
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Lesson
          </button>
          <button
            onClick={() => {
              setShowFolderModal(true);
              setFolderPath('');
              setFolderResult(null);
            }}
            disabled={selectedLessonIds.size === 0}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            <FolderOpen className="w-5 h-5" />
            Create Folders
            {selectedLessonIds.size > 0 && (
              <span className="bg-orange-800 text-white text-xs px-2 py-0.5 rounded-full">
                {selectedLessonIds.size}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Book/Chapter Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-400" />
          <select
            value={selectedBookId}
            onChange={(e) => setContext({ book: e.target.value, chapter: '' })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Books</option>
            {books?.data?.map((book) => (
              <option key={book.id} value={book.id}>
                {book.display_name || book.name}
              </option>
            ))}
          </select>

          <select
            value={selectedChapterId}
            onChange={(e) => setContext({ chapter: e.target.value })}
            disabled={!selectedBookId}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
          >
            <option value="">All Chapters</option>
            {chapters?.data?.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.chapter_number ? `Ch ${chapter.chapter_number}: ` : ''}{chapter.display_name || chapter.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Lessons List */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-4 border-b bg-green-50">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-800">
              Saved Lessons {lessons?.data && `(${sortedLessons.length})`}
            </h2>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">
            <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4 animate-pulse" />
            <p>Loading lessons...</p>
          </div>
        ) : sortedLessons.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No lessons found</p>
            <p className="text-gray-400 text-sm mt-2">
              Create lessons from the Lesson Folders page
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <button
                      onClick={handleSelectAll}
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                      title={selectedLessonIds.size === sortedLessons.length ? 'Deselect all' : 'Select all'}
                    >
                      {selectedLessonIds.size === sortedLessons.length && sortedLessons.length > 0 ? (
                        <CheckSquare className="w-5 h-5 text-orange-600" />
                      ) : (
                        <Square className="w-5 h-5 text-gray-400" />
                      )}
                    </button>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>
                    <span className="flex items-center">Name<SortIcon field="name" /></span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('section')}>
                    <span className="flex items-center">Section<SortIcon field="section" /></span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('range')}>
                    <span className="flex items-center">Range<SortIcon field="range" /></span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('order')}>
                    <span className="flex items-center">Order<SortIcon field="order" /></span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('items')}>
                    <span className="flex items-center">Items<SortIcon field="items" /></span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Source Sets
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('created_at')}>
                    <span className="flex items-center">Created<SortIcon field="created_at" /></span>
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedLessons.map((lesson) => (
                  <tr
                    key={lesson.id}
                    className={`hover:bg-gray-50 cursor-pointer ${selectedLessonIds.has(lesson.id) ? 'bg-orange-50' : ''}`}
                    onClick={() => setViewingLesson(lesson)}
                  >
                    <td className="px-4 py-4">
                      <button
                        onClick={(e) => handleSelectLesson(lesson.id, e)}
                        className="p-1 hover:bg-gray-200 rounded transition-colors"
                      >
                        {selectedLessonIds.has(lesson.id) ? (
                          <CheckSquare className="w-5 h-5 text-orange-600" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <div className="flex items-center">
                        <BookOpen className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                        <span className="text-sm font-medium text-gray-900 truncate" title={lesson.name}>{lesson.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <span className="text-sm text-gray-600 truncate" title={lesson.common_parent_section_name}>
                        {lesson.common_parent_section_name
                          ? lesson.common_parent_section_name.length > 15
                            ? lesson.common_parent_section_name.substring(0, 15) + '...'
                            : lesson.common_parent_section_name
                          : '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-600">{lesson.question_range || '-'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-600">{lesson.display_order ?? '-'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">{getLessonCount(lesson)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 text-xs text-gray-500">
                        {lesson.question_set && (
                          <div className="flex items-center gap-1">
                            <FileQuestion className="w-3 h-3 text-blue-500" />
                            <span>{lesson.question_set.name}</span>
                          </div>
                        )}
                        {lesson.solution_set && (
                          <div className="flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-purple-500" />
                            <span>{lesson.solution_set.name}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Calendar className="w-4 h-4" />
                        {new Date(lesson.created_at).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingLesson(lesson);
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="View/Edit"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(lesson.id, lesson.name);
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lesson View/Edit Modal */}
      {viewingLesson && (
        <LessonModal
          lesson={viewingLesson}
          onClose={() => setViewingLesson(null)}
        />
      )}

      {/* Prepare Lesson Modal */}
      <PrepareLessonModal
        isOpen={showPrepareModal}
        onClose={() => setShowPrepareModal(false)}
      />

      {/* Create Lesson Modal */}
      <CreateLessonModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        bookId={selectedBookId}
        chapterId={selectedChapterId}
        bookName={(() => {
          const b = books?.data?.find((x) => x.id === selectedBookId);
          return b ? (b.display_name || b.name) : '';
        })()}
        chapterName={(() => {
          const c = chapters?.data?.find((x) => x.id === selectedChapterId);
          return c ? (c.display_name || c.name) : '';
        })()}
      />

      {/* Create Folders Modal (for multiple lessons) */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b bg-orange-50">
              <div className="flex items-center gap-3">
                <FolderOpen className="w-6 h-6 text-orange-600" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">Create Folders</h2>
                  <p className="text-sm text-gray-500">{selectedLessonIds.size} lesson(s) selected</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFolderModal(false);
                  setFolderPath('');
                  setFolderResult(null);
                  createFoldersMutation.reset();
                }}
                className="p-2 hover:bg-orange-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              {/* Show result if available */}
              {folderResult ? (
                folderResult.success ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-700 mb-2">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="font-medium">Folders Created Successfully</span>
                    </div>
                    <div className="text-sm text-green-600 space-y-1">
                      <p><strong>Base path:</strong> {folderResult.data.basePath}</p>
                      <p><strong>Lessons processed:</strong> {folderResult.data.lessonsProcessed}</p>
                      <p><strong>Total question folders:</strong> {folderResult.data.totalFoldersCreated}</p>
                    </div>
                    {folderResult.data.lessonsSummary?.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-green-700 mb-2">Lessons summary:</p>
                        <div className="space-y-1">
                          {folderResult.data.lessonsSummary.map((lesson, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1 border border-green-100">
                              <div className="flex items-center gap-1 text-green-800">
                                <BookOpen className="w-3 h-3" />
                                <span>{lesson.lessonName || 'Unknown'}</span>
                              </div>
                              <span className="text-green-600">{lesson.itemsCreated} items</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {folderResult.data.createdFolders?.length > 0 && (
                      <div className="mt-3 max-h-40 overflow-auto">
                        <p className="text-xs font-medium text-green-700 mb-2">Created folders:</p>
                        <div className="space-y-0.5">
                          {folderResult.data.createdFolders.map((folder, idx) => (
                            <div key={idx} className="flex items-center gap-1 text-xs text-green-600">
                              <FolderOpen className="w-3 h-3" />
                              <span>{folder.folder}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-red-700 mb-2">
                      <AlertCircle className="w-5 h-5" />
                      <span className="font-medium">Failed to Create Folders</span>
                    </div>
                    <p className="text-sm text-red-600">{folderResult.error}</p>
                  </div>
                )
              ) : (
                <>
                  {/* Selected lessons preview */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Selected Lessons
                    </label>
                    <div className="max-h-32 overflow-auto bg-gray-50 rounded-lg p-2 space-y-1">
                      {sortedLessons
                        .filter(l => selectedLessonIds.has(l.id))
                        .map(lesson => (
                          <div key={lesson.id} className="flex items-center gap-2 text-sm text-gray-700">
                            <BookOpen className="w-4 h-4 text-green-500" />
                            <span>{lesson.name}</span>
                            <span className="text-xs text-gray-400">({lesson.lesson_items?.length || 0} items)</span>
                          </div>
                        ))}
                    </div>
                  </div>

                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Base Folder Path
                  </label>
                  <input
                    type="text"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    placeholder="e.g., /path/to/destination"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    autoFocus
                    disabled={createFoldersMutation.isPending}
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    All question folders from selected lessons will be created directly in this path
                  </p>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50">
              <button
                onClick={() => {
                  setShowFolderModal(false);
                  setFolderPath('');
                  setFolderResult(null);
                  createFoldersMutation.reset();
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                {folderResult ? 'Close' : 'Cancel'}
              </button>
              {!folderResult && (
                <button
                  onClick={() => {
                    createFoldersMutation.mutate({
                      lessonIds: Array.from(selectedLessonIds),
                      basePath: folderPath.trim(),
                    });
                  }}
                  disabled={!folderPath.trim() || createFoldersMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {createFoldersMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <FolderOpen className="w-4 h-4" />
                      Proceed
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
