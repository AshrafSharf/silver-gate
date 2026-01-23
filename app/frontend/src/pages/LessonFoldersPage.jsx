import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { FileQuestion, CheckCircle, Filter, Eye } from 'lucide-react';
import QuestionSetModal from '../components/QuestionSetModal';
import SolutionSetModal from '../components/SolutionSetModal';

export default function LessonFoldersPage() {
  // State for filters
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');

  // State for selected sets
  const [selectedQuestionSetId, setSelectedQuestionSetId] = useState('');
  const [selectedSolutionSetId, setSelectedSolutionSetId] = useState('');

  // State for modal viewing
  const [viewQuestionSet, setViewQuestionSet] = useState(null);
  const [viewSolutionSet, setViewSolutionSet] = useState(null);

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

  // Fetch active job for default selections
  const { data: activeJob } = useQuery({
    queryKey: ['activeJob'],
    queryFn: () => api.get('/jobs/active'),
  });

  // Set default filters from active job
  useEffect(() => {
    if (activeJob?.data?.active_book_id && !selectedBookId) {
      setSelectedBookId(activeJob.data.active_book_id);
    }
    if (activeJob?.data?.active_chapter_id && !selectedChapterId) {
      setSelectedChapterId(activeJob.data.active_chapter_id);
    }
  }, [activeJob?.data?.active_book_id, activeJob?.data?.active_chapter_id]);

  // Reset set selections when book/chapter changes
  useEffect(() => {
    setSelectedQuestionSetId('');
    setSelectedSolutionSetId('');
  }, [selectedBookId, selectedChapterId]);

  // Fetch question sets filtered by book/chapter
  const { data: questionSets, isLoading: isLoadingQuestionSets } = useQuery({
    queryKey: ['questionSets', selectedBookId, selectedChapterId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedBookId) params.append('bookId', selectedBookId);
      if (selectedChapterId) params.append('chapterId', selectedChapterId);
      const queryString = params.toString();
      return api.get(`/question-sets${queryString ? `?${queryString}` : ''}`);
    },
  });

  // Fetch solution sets filtered by book/chapter
  const { data: solutionSets, isLoading: isLoadingSolutionSets } = useQuery({
    queryKey: ['solutionSets', selectedBookId, selectedChapterId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedBookId) params.append('bookId', selectedBookId);
      if (selectedChapterId) params.append('chapterId', selectedChapterId);
      const queryString = params.toString();
      return api.get(`/solution-sets${queryString ? `?${queryString}` : ''}`);
    },
  });

  // Fetch selected question set by ID
  const { data: selectedQuestionSet, isLoading: isLoadingSelectedQuestion } = useQuery({
    queryKey: ['questionSet', selectedQuestionSetId],
    queryFn: () => api.get(`/question-sets/${selectedQuestionSetId}`),
    enabled: !!selectedQuestionSetId,
  });

  // Fetch selected solution set by ID
  const { data: selectedSolutionSet, isLoading: isLoadingSelectedSolution } = useQuery({
    queryKey: ['solutionSet', selectedSolutionSetId],
    queryFn: () => api.get(`/solution-sets/${selectedSolutionSetId}`),
    enabled: !!selectedSolutionSetId,
  });

  const sortedQuestionSets = questionSets?.data
    ? [...questionSets.data].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    : [];

  const sortedSolutionSets = solutionSets?.data
    ? [...solutionSets.data].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    : [];

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Lesson Folders</h1>
        <p className="text-gray-500 mt-1">View questions and solutions for a lesson</p>
      </div>

      {/* Book/Chapter Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-400" />
          <select
            value={selectedBookId}
            onChange={(e) => {
              setSelectedBookId(e.target.value);
              setSelectedChapterId('');
            }}
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
            onChange={(e) => setSelectedChapterId(e.target.value)}
            disabled={!selectedBookId}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
          >
            <option value="">All Chapters</option>
            {chapters?.data?.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.display_name || chapter.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Extracted Questions Section */}
      <div className="bg-white rounded-lg shadow-sm border mb-6">
        <div className="p-4 border-b bg-blue-50">
          <div className="flex items-center gap-3">
            <FileQuestion className="w-6 h-6 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-800">Extracted Questions</h2>
          </div>
        </div>
        <div className="p-4">
          {/* Question Set Dropdown */}
          <div className="mb-4">
            <select
              value={selectedQuestionSetId}
              onChange={(e) => setSelectedQuestionSetId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select Question Set</option>
              {isLoadingQuestionSets ? (
                <option disabled>Loading...</option>
              ) : sortedQuestionSets.length === 0 ? (
                <option disabled>No question sets available</option>
              ) : (
                sortedQuestionSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name} ({set.total_questions || 0} questions)
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Question Set Content - Single Row Table */}
          {selectedQuestionSetId && selectedQuestionSet?.data ? (
            <div className="rounded-lg border overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Book / Chapter
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Questions
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <tr
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setViewQuestionSet(selectedQuestionSet.data)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <FileQuestion className="w-5 h-5 text-blue-500 mr-3" />
                        <span className="text-sm font-medium text-gray-900">{selectedQuestionSet.data.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {selectedQuestionSet.data.book?.display_name || '-'}
                        {selectedQuestionSet.data.chapter?.display_name && ` / ${selectedQuestionSet.data.chapter.display_name}`}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900">{selectedQuestionSet.data.total_questions || 0}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(selectedQuestionSet.data.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(selectedQuestionSet.data.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewQuestionSet(selectedQuestionSet.data);
                        }}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : selectedQuestionSetId && isLoadingSelectedQuestion ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg text-gray-500">Loading question set...</div>
          ) : (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <FileQuestion className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Select a question set to view</p>
            </div>
          )}
        </div>
      </div>

      {/* Extracted Solutions Section */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-4 border-b bg-purple-50">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-800">Extracted Solutions</h2>
          </div>
        </div>
        <div className="p-4">
          {/* Solution Set Dropdown */}
          <div className="mb-4">
            <select
              value={selectedSolutionSetId}
              onChange={(e) => setSelectedSolutionSetId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            >
              <option value="">Select Solution Set</option>
              {isLoadingSolutionSets ? (
                <option disabled>Loading...</option>
              ) : sortedSolutionSets.length === 0 ? (
                <option disabled>No solution sets available</option>
              ) : (
                sortedSolutionSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name} ({set.total_solutions || 0} solutions)
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Solution Set Content - Single Row Table */}
          {selectedSolutionSetId && selectedSolutionSet?.data ? (
            <div className="rounded-lg border overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Book / Chapter
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Solutions
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <tr
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setViewSolutionSet(selectedSolutionSet.data)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <CheckCircle className="w-5 h-5 text-purple-500 mr-3" />
                        <span className="text-sm font-medium text-gray-900">{selectedSolutionSet.data.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {selectedSolutionSet.data.book?.display_name || '-'}
                        {selectedSolutionSet.data.chapter?.display_name && ` / ${selectedSolutionSet.data.chapter.display_name}`}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900">{selectedSolutionSet.data.total_solutions || 0}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(selectedSolutionSet.data.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(selectedSolutionSet.data.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewSolutionSet(selectedSolutionSet.data);
                        }}
                        className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : selectedSolutionSetId && isLoadingSelectedSolution ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg text-gray-500">Loading solution set...</div>
          ) : (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Select a solution set to view</p>
            </div>
          )}
        </div>
      </div>

      {/* Question Set Modal */}
      <QuestionSetModal
        isOpen={!!viewQuestionSet}
        onClose={() => setViewQuestionSet(null)}
        questionSet={viewQuestionSet}
      />

      {/* Solution Set Modal */}
      <SolutionSetModal
        isOpen={!!viewSolutionSet}
        onClose={() => setViewSolutionSet(null)}
        solutionSet={viewSolutionSet}
      />
    </div>
  );
}
