import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { CheckCircle, Trash2, Eye, Filter } from 'lucide-react';
import SolutionSetModal from '../components/SolutionSetModal';

export default function ExtractedSolutionsPage() {
  const queryClient = useQueryClient();
  const [selectedSet, setSelectedSet] = useState(null);
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');

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

  // Fetch active job
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

  // Fetch solution sets with filters
  const { data: solutionSets, isLoading } = useQuery({
    queryKey: ['solutionSets', selectedBookId, selectedChapterId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedBookId) params.append('bookId', selectedBookId);
      if (selectedChapterId) params.append('chapterId', selectedChapterId);
      const queryString = params.toString();
      return api.get(`/solution-sets${queryString ? `?${queryString}` : ''}`);
    },
  });

  // Delete solution set mutation
  const deleteSetMutation = useMutation({
    mutationFn: (id) => api.delete(`/solution-sets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solutionSets'] });
    },
  });

  const handleDelete = (e, id, name) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
      deleteSetMutation.mutate(id);
    }
  };

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

  const sortedSets = solutionSets?.data
    ? [...solutionSets.data].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Extracted Solutions</h1>
          <p className="text-gray-500 mt-1">View and manage extracted solution sets</p>
        </div>
      </div>

      {/* Filters */}
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

      {/* Solution Sets List */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading solution sets...</div>
      ) : sortedSets.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No solution sets found</p>
          <p className="text-gray-400 text-sm mt-1">Extract solutions from scanned items to see them here</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[180px]">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[150px]">
                  Book / Chapter
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                  Solutions
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[140px]">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedSets.map((set) => (
                <tr
                  key={set.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedSet(set)}
                >
                  <td className="px-4 py-4">
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 text-purple-500 mr-2 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-900 truncate max-w-[200px]" title={set.name}>
                        {set.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-gray-500 truncate max-w-[180px]" title={`${set.book?.display_name || '-'}${set.chapter?.display_name ? ` / ${set.chapter.display_name}` : ''}`}>
                      {set.book?.display_name || '-'}
                      {set.chapter?.display_name && ` / ${set.chapter.display_name}`}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-900">{set.total_solutions || 0}</span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    {getStatusBadge(set.status)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(set.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSet(set);
                      }}
                      className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg mr-1"
                      title="View"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, set.id, set.name)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Solution Set Modal */}
      <SolutionSetModal
        isOpen={!!selectedSet}
        onClose={() => setSelectedSet(null)}
        solutionSet={selectedSet}
      />
    </div>
  );
}
