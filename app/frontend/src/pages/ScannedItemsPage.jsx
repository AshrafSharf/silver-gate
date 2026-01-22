import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ScanLine, Plus, Trash2, X, CheckSquare, FileQuestion, Filter, HelpCircle, CheckCircle, Eye } from 'lucide-react';
import PDFViewerModal from '../components/PDFViewerModal';

export default function ScannedItemsPage() {
  const queryClient = useQueryClient();

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemData, setNewItemData] = useState('');
  const [newScanType, setNewScanType] = useState('pdf');

  // Tab state for item type
  const [activeTab, setActiveTab] = useState('question');

  // Filter state
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');

  // Multi-select state
  const [selectedItems, setSelectedItems] = useState([]); // Array of {id, order}
  const [selectionCounter, setSelectionCounter] = useState(0);

  // PDF viewer modal state
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [selectedPdfItem, setSelectedPdfItem] = useState(null);

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

  // Fetch scanned items with filters
  const { data: scannedItems, isLoading } = useQuery({
    queryKey: ['scannedItems', selectedBookId, selectedChapterId, activeTab],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedBookId) params.append('bookId', selectedBookId);
      if (selectedChapterId) params.append('chapterId', selectedChapterId);
      params.append('itemType', activeTab);
      const queryString = params.toString();
      return api.get(`/scanned-items?${queryString}`);
    },
  });

  // Fetch active job
  const { data: activeJob } = useQuery({
    queryKey: ['activeJob'],
    queryFn: () => api.get('/jobs/active'),
  });

  // Add scanned item mutation
  const addItemMutation = useMutation({
    mutationFn: (data) => api.post('/scanned-items', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scannedItems'] });
      setShowAddModal(false);
      setNewItemData('');
      setNewScanType('pdf');
    },
  });

  // Delete scanned item mutation
  const deleteItemMutation = useMutation({
    mutationFn: (id) => api.delete(`/scanned-items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scannedItems'] });
      // Remove from selection if deleted
      setSelectedItems((prev) => prev.filter((item) => item.id !== id));
    },
  });

  // Extract questions mutation
  const extractQuestionsMutation = useMutation({
    mutationFn: (data) => api.post('/question-sets/extract', data),
    onSuccess: (result) => {
      clearSelections();
      queryClient.invalidateQueries({ queryKey: ['questionSets'] });
      alert(`Extraction started! Question set ID: ${result.data.id}\nStatus: ${result.data.status}`);
    },
  });

  const handleAddItem = () => {
    if (newItemData.trim()) {
      addItemMutation.mutate({
        item_data: newItemData,
        scan_type: newScanType,
      });
    }
  };

  // Selection handlers
  const handleItemSelect = (itemId) => {
    setSelectedItems((prev) => {
      const existing = prev.find((item) => item.id === itemId);
      if (existing) {
        // Remove from selection
        return prev.filter((item) => item.id !== itemId);
      } else {
        // Add to selection with order
        const newOrder = selectionCounter + 1;
        setSelectionCounter(newOrder);
        return [...prev, { id: itemId, order: newOrder }];
      }
    });
  };

  const getSelectionOrder = (itemId) => {
    const item = selectedItems.find((item) => item.id === itemId);
    return item ? item.order : null;
  };

  const clearSelections = () => {
    setSelectedItems([]);
    setSelectionCounter(0);
  };

  const getOrderedItemIds = () => {
    return [...selectedItems]
      .sort((a, b) => a.order - b.order)
      .map((item) => item.id);
  };

  const handleExtractQuestions = () => {
    const orderedIds = getOrderedItemIds();
    extractQuestionsMutation.mutate({
      item_ids: orderedIds,
      name: `Extraction ${new Date().toLocaleString()}`,
    });
  };

  const canSelect = (item) => {
    return item.latex_conversion_status === 'completed' && item.latex_doc;
  };

  // Check if item can be viewed as PDF
  const canViewPdf = (item) => {
    const scanType = item.scan_type?.toLowerCase();
    return scanType === 'pdf' || scanType === 'email_attachment' ||
           (scanType === 'url' && item.item_data?.toLowerCase().endsWith('.pdf'));
  };

  // Get the PDF URL for viewing
  const getPdfUrl = (item) => {
    // For items with binary content or base64, use the backend endpoint
    if (item.scan_type === 'email_attachment' || !item.item_data?.startsWith('http')) {
      return `/api/scanned-items/${item.id}/pdf`;
    }
    // For URL-based PDFs, use the URL directly
    return item.item_data;
  };

  const handleViewPdf = (item) => {
    setSelectedPdfItem(item);
    setPdfViewerOpen(true);
  };

  const hasActiveJob = activeJob?.data?.active_book_id && activeJob?.data?.active_chapter_id;

  // Sort items by created_at (newest first)
  const sortedItems = scannedItems?.data
    ? [...scannedItems.data].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Scanned Items</h1>
          <p className="text-gray-500 mt-1">
            View, filter, and extract questions from scanned items
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          disabled={!hasActiveJob}
          className={`flex items-center px-4 py-2 rounded-lg font-medium ${
            hasActiveJob
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          }`}
          title={!hasActiveJob ? 'Please configure an active job first' : ''}
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Item
        </button>
      </div>

      {/* Item Type Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => {
                setActiveTab('question');
                clearSelections();
              }}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'question'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <HelpCircle className={`w-5 h-5 mr-2 ${activeTab === 'question' ? 'text-blue-500' : 'text-gray-400'}`} />
              Questions
            </button>
            <button
              onClick={() => {
                setActiveTab('solution');
                clearSelections();
              }}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'solution'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <CheckCircle className={`w-5 h-5 mr-2 ${activeTab === 'solution' ? 'text-purple-500' : 'text-gray-400'}`} />
              Solutions
            </button>
          </nav>
        </div>
      </div>

      {/* Filter Section */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-5 h-5 text-gray-500" />
          <span className="font-medium text-gray-700">Filter Items</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {/* Book Filter */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Book
            </label>
            <select
              value={selectedBookId}
              onChange={(e) => {
                setSelectedBookId(e.target.value);
                setSelectedChapterId('');
                clearSelections();
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Books</option>
              {books?.data?.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.display_name || book.name}
                </option>
              ))}
            </select>
          </div>

          {/* Chapter Filter */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Chapter
            </label>
            <select
              value={selectedChapterId}
              onChange={(e) => {
                setSelectedChapterId(e.target.value);
                clearSelections();
              }}
              disabled={!selectedBookId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">All Chapters</option>
              {chapters?.data?.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.chapter_number ? `Ch ${chapter.chapter_number}: ` : ''}
                  {chapter.display_name || chapter.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Selection Action Bar */}
      {selectedItems.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center">
            <CheckSquare className="w-5 h-5 text-blue-600 mr-2" />
            <span className="text-blue-800 font-medium">
              {selectedItems.length} item{selectedItems.length > 1 ? 's' : ''} selected
            </span>
            <span className="text-blue-600 text-sm ml-2">
              (in order: {getOrderedItemIds().map((_, i) => i + 1).join(', ')})
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={clearSelections}
              className="px-3 py-1.5 text-gray-600 hover:text-gray-800"
            >
              Clear Selection
            </button>
            <button
              onClick={handleExtractQuestions}
              disabled={extractQuestionsMutation.isPending}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <FileQuestion className="w-5 h-5 mr-2" />
              {extractQuestionsMutation.isPending ? 'Extracting...' : 'Extract Questions'}
            </button>
          </div>
        </div>
      )}

      {/* Error display */}
      {extractQuestionsMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800">
            Extraction failed: {extractQuestionsMutation.error.message}
          </p>
        </div>
      )}

      {!hasActiveJob && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-yellow-800">
            No active job configured. Please configure an active book and chapter
            before adding scanned items.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          Loading...
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <ScanLine className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">No scanned items found</p>
          {hasActiveJob && !selectedBookId && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 text-blue-600 hover:underline"
            >
              Add your first item
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                  Select
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Item Data
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Book / Chapter
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Scan Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  LaTeX Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedItems.map((item) => {
                const isSelected = !!selectedItems.find((s) => s.id === item.id);
                const selectionOrder = getSelectionOrder(item.id);
                const selectable = canSelect(item);

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}
                  >
                    {/* Selection Checkbox */}
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleItemSelect(item.id)}
                          disabled={!selectable}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={!selectable ? 'LaTeX conversion not completed' : ''}
                        />
                        {selectionOrder && (
                          <span className="ml-2 text-xs bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center font-medium">
                            {selectionOrder}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {canViewPdf(item) ? (
                        <button
                          onClick={() => handleViewPdf(item)}
                          className="text-blue-600 hover:text-blue-800 hover:underline max-w-xs truncate text-left"
                          title={item.item_data}
                        >
                          {item.item_data}
                        </button>
                      ) : (
                        <p className="text-gray-800 max-w-xs truncate" title={item.item_data}>
                          {item.item_data}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-gray-800 text-sm">
                        {item.book?.display_name || item.book?.name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {item.chapter?.display_name || item.chapter?.name}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                        {item.scan_type || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          item.latex_conversion_status === 'completed'
                            ? 'bg-green-100 text-green-600'
                            : item.latex_conversion_status === 'failed'
                            ? 'bg-red-100 text-red-600'
                            : item.latex_conversion_status === 'processing'
                            ? 'bg-blue-100 text-blue-600'
                            : 'bg-yellow-100 text-yellow-600'
                        }`}
                      >
                        {item.latex_conversion_status || 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canViewPdf(item) && (
                          <button
                            onClick={() => handleViewPdf(item)}
                            className="text-blue-600 hover:text-blue-800"
                            title="View PDF"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteItemMutation.mutate(item.id)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold text-gray-800">
                Add Scanned Item
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Item Data (PDF URL or content)
                </label>
                <textarea
                  value={newItemData}
                  onChange={(e) => setNewItemData(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={4}
                  placeholder="Enter PDF URL or scanned data..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Scan Type
                </label>
                <select
                  value={newScanType}
                  onChange={(e) => setNewScanType(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="pdf">PDF</option>
                  <option value="image">Image</option>
                  <option value="url">URL</option>
                  <option value="text">Text</option>
                </select>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Active Book:</span>{' '}
                  {activeJob?.data?.active_book?.display_name || 'Not set'}
                </p>
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Active Chapter:</span>{' '}
                  {activeJob?.data?.active_chapter?.display_name || 'Not set'}
                </p>
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Item Type:</span>{' '}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    activeJob?.data?.active_item_type === 'solution'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {activeJob?.data?.active_item_type === 'solution' ? 'Solution' : 'Question'}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-4 border-t">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleAddItem}
                disabled={!newItemData.trim() || addItemMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addItemMutation.isPending ? 'Adding...' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Viewer Modal */}
      <PDFViewerModal
        isOpen={pdfViewerOpen}
        onClose={() => {
          setPdfViewerOpen(false);
          setSelectedPdfItem(null);
        }}
        pdfUrl={selectedPdfItem ? getPdfUrl(selectedPdfItem) : null}
        title={selectedPdfItem?.item_data || 'PDF Document'}
      />
    </div>
  );
}
