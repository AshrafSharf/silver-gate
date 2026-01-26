import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ScanLine, Plus, Trash2, X, CheckSquare, FileQuestion, Filter, HelpCircle, CheckCircle, Eye, FileText, Pencil } from 'lucide-react';
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

  // LaTeX viewer modal state
  const [latexViewerOpen, setLatexViewerOpen] = useState(false);
  const [selectedLatexItem, setSelectedLatexItem] = useState(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [editFormData, setEditFormData] = useState({
    item_data: '',
    book_id: '',
    chapter_id: '',
  });

  // Extract questions modal state
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractFormData, setExtractFormData] = useState({
    name: '',
    type: 'Question Bank',
  });

  // Extract solutions modal state
  const [showExtractSolutionsModal, setShowExtractSolutionsModal] = useState(false);
  const [extractSolutionsFormData, setExtractSolutionsFormData] = useState({
    name: '',
    type: 'Question Bank',
  });

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

  // Fetch chapters for edit modal book selection
  const { data: editChapters } = useQuery({
    queryKey: ['editChapters', editFormData.book_id],
    queryFn: () => api.get(`/chapters/book/${editFormData.book_id}`),
    enabled: !!editFormData.book_id,
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

  // Set default filters from active job
  useEffect(() => {
    if (activeJob?.data?.active_book_id && !selectedBookId) {
      setSelectedBookId(activeJob.data.active_book_id);
    }
    if (activeJob?.data?.active_chapter_id && !selectedChapterId) {
      setSelectedChapterId(activeJob.data.active_chapter_id);
    }
  }, [activeJob?.data?.active_book_id, activeJob?.data?.active_chapter_id]);

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

  // Update scanned item mutation
  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }) => api.put(`/scanned-items/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scannedItems'] });
      setShowEditModal(false);
      setEditingItem(null);
      setEditFormData({
        item_data: '',
        book_id: '',
        chapter_id: '',
      });
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

  // Extract solutions mutation
  const extractSolutionsMutation = useMutation({
    mutationFn: (data) => api.post('/solution-sets/extract', data),
    onSuccess: (result) => {
      clearSelections();
      queryClient.invalidateQueries({ queryKey: ['solutionSets'] });
      alert(`Extraction started! Solution set ID: ${result.data.id}\nStatus: ${result.data.status}`);
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

  const handleEditItem = (item) => {
    setEditingItem(item);
    setEditFormData({
      item_data: item.item_data,
      book_id: item.book_id,
      chapter_id: item.chapter_id,
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = () => {
    if (editFormData.item_data.trim() && editFormData.book_id && editFormData.chapter_id) {
      updateItemMutation.mutate({
        id: editingItem.id,
        data: {
          item_data: editFormData.item_data,
          book_id: parseInt(editFormData.book_id),
          chapter_id: parseInt(editFormData.chapter_id),
        },
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
    // Open the extraction modal with default values
    setExtractFormData({
      name: `Extraction ${new Date().toLocaleString()}`,
      type: 'Question Bank',
    });
    setShowExtractModal(true);
  };

  const handleSubmitExtraction = () => {
    const orderedIds = getOrderedItemIds();
    extractQuestionsMutation.mutate({
      item_ids: orderedIds,
      name: extractFormData.name,
      type: extractFormData.type,
    });
    setShowExtractModal(false);
  };

  const handleExtractSolutions = () => {
    // Open the extraction modal with default values
    setExtractSolutionsFormData({
      name: `Solution Extraction ${new Date().toLocaleString()}`,
      type: 'Question Bank',
    });
    setShowExtractSolutionsModal(true);
  };

  const handleSubmitSolutionExtraction = () => {
    const orderedIds = getOrderedItemIds();
    extractSolutionsMutation.mutate({
      item_ids: orderedIds,
      name: extractSolutionsFormData.name,
      type: extractSolutionsFormData.type,
    });
    setShowExtractSolutionsModal(false);
  };

  const canSelect = (item) => {
    return item.latex_conversion_status === 'completed' && item.latex_doc;
  };

  // Check if item can be viewed as PDF
  const canViewPdf = (item) => {
    const scanType = item.scan_type?.toLowerCase();
    const itemData = item.item_data?.toLowerCase() || '';
    // Allow viewing if scan_type is pdf/email_attachment, or if filename ends with .pdf
    return scanType === 'pdf' || scanType === 'email_attachment' ||
           itemData.endsWith('.pdf') || item.content;
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

  const handleViewLatex = (item) => {
    setSelectedLatexItem(item);
    setLatexViewerOpen(true);
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
        <div className={`${activeTab === 'solution' ? 'bg-purple-50 border-purple-200' : 'bg-blue-50 border-blue-200'} border rounded-lg p-4 mb-6 flex items-center justify-between`}>
          <div className="flex items-center">
            <CheckSquare className={`w-5 h-5 ${activeTab === 'solution' ? 'text-purple-600' : 'text-blue-600'} mr-2`} />
            <span className={`${activeTab === 'solution' ? 'text-purple-800' : 'text-blue-800'} font-medium`}>
              {selectedItems.length} item{selectedItems.length > 1 ? 's' : ''} selected
            </span>
            <span className={`${activeTab === 'solution' ? 'text-purple-600' : 'text-blue-600'} text-sm ml-2`}>
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
            {activeTab === 'question' ? (
              <button
                onClick={handleExtractQuestions}
                disabled={extractQuestionsMutation.isPending}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <FileQuestion className="w-5 h-5 mr-2" />
                {extractQuestionsMutation.isPending ? 'Extracting...' : 'Extract Questions'}
              </button>
            ) : (
              <button
                onClick={handleExtractSolutions}
                disabled={extractSolutionsMutation.isPending}
                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                {extractSolutionsMutation.isPending ? 'Extracting...' : 'Extract Solutions'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error display */}
      {extractQuestionsMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800">
            Question extraction failed: {extractQuestionsMutation.error.message}
          </p>
        </div>
      )}
      {extractSolutionsMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800">
            Solution extraction failed: {extractSolutionsMutation.error.message}
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
                    className={`hover:bg-gray-50 ${isSelected ? (activeTab === 'solution' ? 'bg-purple-50' : 'bg-blue-50') : ''}`}
                  >
                    {/* Selection Checkbox */}
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleItemSelect(item.id)}
                          disabled={!selectable}
                          className={`w-4 h-4 rounded disabled:opacity-50 disabled:cursor-not-allowed ${activeTab === 'solution' ? 'text-purple-600 focus:ring-purple-500' : 'text-blue-600 focus:ring-blue-500'}`}
                          title={!selectable ? 'LaTeX conversion not completed' : ''}
                        />
                        {selectionOrder && (
                          <span className={`ml-2 text-xs text-white rounded-full w-5 h-5 flex items-center justify-center font-medium ${activeTab === 'solution' ? 'bg-purple-600' : 'bg-blue-600'}`}>
                            {selectionOrder}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {canViewPdf(item) ? (
                        <button
                          onClick={() => handleViewPdf(item)}
                          className="flex items-center gap-2 text-blue-600 hover:text-blue-800 hover:underline max-w-xs text-left group"
                          title={`Click to view: ${item.item_data}`}
                        >
                          <FileText className="w-4 h-4 flex-shrink-0 group-hover:scale-110 transition-transform" />
                          <span className="truncate">{item.item_data}</span>
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
                        <button
                          onClick={() => handleViewLatex(item)}
                          className={`${item.latex_doc ? 'text-green-500 hover:text-green-700' : 'text-gray-300 cursor-not-allowed'}`}
                          title={item.latex_doc ? 'View LaTeX' : 'No LaTeX available'}
                          disabled={!item.latex_doc}
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleEditItem(item)}
                          className="text-gray-600 hover:text-gray-800"
                          title="Edit item"
                        >
                          <Pencil className="w-5 h-5" />
                        </button>
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

      {/* Edit Item Modal */}
      {showEditModal && editingItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
            <div className={`flex items-center justify-between p-4 border-b ${
              activeTab === 'solution' ? 'bg-purple-50' : 'bg-blue-50'
            }`}>
              <h2 className={`text-lg font-semibold ${
                activeTab === 'solution' ? 'text-purple-800' : 'text-blue-800'
              }`}>
                Edit Scanned Item
              </h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  PDF Name / Item Data
                </label>
                <input
                  type="text"
                  value={editFormData.item_data}
                  onChange={(e) => setEditFormData({ ...editFormData, item_data: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter PDF name or URL..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Book
                </label>
                <select
                  value={editFormData.book_id}
                  onChange={(e) => {
                    setEditFormData({
                      ...editFormData,
                      book_id: e.target.value,
                      chapter_id: '', // Reset chapter when book changes
                    });
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a book</option>
                  {books?.data?.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.display_name || book.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Chapter
                </label>
                <select
                  value={editFormData.chapter_id}
                  onChange={(e) => setEditFormData({ ...editFormData, chapter_id: e.target.value })}
                  disabled={!editFormData.book_id}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="">Select a chapter</option>
                  {editChapters?.data?.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.chapter_number ? `Ch ${chapter.chapter_number}: ` : ''}
                      {chapter.display_name || chapter.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Current Type:</span>{' '}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    activeTab === 'solution'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {activeTab === 'solution' ? 'Solution' : 'Question'}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-4 border-t">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={
                  !editFormData.item_data.trim() ||
                  !editFormData.book_id ||
                  !editFormData.chapter_id ||
                  updateItemMutation.isPending
                }
                className={`px-4 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                  activeTab === 'solution'
                    ? 'bg-purple-600 hover:bg-purple-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {updateItemMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extract Questions Modal */}
      {showExtractModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b bg-blue-50">
              <h2 className="text-lg font-semibold text-blue-800">
                Extract Questions
              </h2>
              <button
                onClick={() => setShowExtractModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={extractFormData.name}
                  onChange={(e) => setExtractFormData({ ...extractFormData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter extraction name..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Source Type
                </label>
                <select
                  value={extractFormData.type}
                  onChange={(e) => setExtractFormData({ ...extractFormData, type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="Question Bank">Question Bank</option>
                  <option value="Academic Book">Academic Book</option>
                </select>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Selected Items:</span>{' '}
                  {selectedItems.length} item{selectedItems.length > 1 ? 's' : ''}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-4 border-t">
              <button
                onClick={() => setShowExtractModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitExtraction}
                disabled={!extractFormData.name.trim() || extractQuestionsMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {extractQuestionsMutation.isPending ? 'Extracting...' : 'Start Extraction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extract Solutions Modal */}
      {showExtractSolutionsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b bg-purple-50">
              <h2 className="text-lg font-semibold text-purple-800">
                Extract Solutions
              </h2>
              <button
                onClick={() => setShowExtractSolutionsModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={extractSolutionsFormData.name}
                  onChange={(e) => setExtractSolutionsFormData({ ...extractSolutionsFormData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Enter extraction name..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Source Type
                </label>
                <select
                  value={extractSolutionsFormData.type}
                  onChange={(e) => setExtractSolutionsFormData({ ...extractSolutionsFormData, type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="Question Bank">Question Bank</option>
                  <option value="Academic Book">Academic Book</option>
                </select>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Selected Items:</span>{' '}
                  {selectedItems.length} item{selectedItems.length > 1 ? 's' : ''}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-4 border-t">
              <button
                onClick={() => setShowExtractSolutionsModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitSolutionExtraction}
                disabled={!extractSolutionsFormData.name.trim() || extractSolutionsMutation.isPending}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {extractSolutionsMutation.isPending ? 'Extracting...' : 'Start Extraction'}
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

      {/* LaTeX Viewer Modal */}
      {latexViewerOpen && selectedLatexItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">LaTeX Content</h2>
                <p className="text-sm text-gray-500">{selectedLatexItem.item_data}</p>
              </div>
              <button
                onClick={() => {
                  setLatexViewerOpen(false);
                  setSelectedLatexItem(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              <pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto">
                {selectedLatexItem.latex_doc || 'No LaTeX content available'}
              </pre>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(selectedLatexItem.latex_doc || '');
                  alert('LaTeX copied to clipboard!');
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => {
                  setLatexViewerOpen(false);
                  setSelectedLatexItem(null);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
