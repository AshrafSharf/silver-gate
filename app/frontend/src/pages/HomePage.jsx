import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  Settings,
  Book,
  FileText,
  Plus,
  Trash2,
  X,
  HelpCircle,
  CheckCircle,
  Save,
  Pencil,
} from 'lucide-react';
import { useActiveContext } from '../hooks/useActiveContext';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('job');

  const tabs = [
    { id: 'job', label: 'Active Job', icon: Settings },
    { id: 'books', label: 'Books', icon: Book },
    { id: 'chapters', label: 'Chapters', icon: FileText },
  ];

  return (
    <div>
      {/* Tab Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="flex space-x-1" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className={`w-5 h-5 mr-2 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'job' && <ActiveJobTab />}
      {activeTab === 'books' && <BooksTab />}
      {activeTab === 'chapters' && <ChaptersTab />}
    </div>
  );
}

// ============ ACTIVE JOB TAB ============
function ActiveJobTab() {
  const { bookId: savedBookId, chapterId: savedChapterId, itemType: savedItemType, setContext } = useActiveContext();
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [selectedItemType, setSelectedItemType] = useState('question');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: books, isLoading } = useQuery({
    queryKey: ['books'],
    queryFn: () => api.get('/books'),
  });

  const { data: chapters } = useQuery({
    queryKey: ['chapters', selectedBookId],
    queryFn: () => api.get(`/chapters/book/${selectedBookId}`),
    enabled: !!selectedBookId,
  });

  useEffect(() => {
    if (savedBookId) setSelectedBookId(savedBookId);
    if (savedChapterId) setSelectedChapterId(savedChapterId);
    if (savedItemType) setSelectedItemType(savedItemType);
  }, [savedBookId, savedChapterId, savedItemType]);

  const handleSave = () => {
    if (selectedBookId && selectedChapterId) {
      setContext({ book: selectedBookId, chapter: selectedChapterId, type: selectedItemType });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  // Look up display names for the currently saved context.
  const savedBook = books?.data?.find((b) => b.id === savedBookId);
  const savedBookLabel = savedBook?.display_name || savedBook?.name || 'N/A';
  const savedChapter = chapters?.data?.find((c) => c.id === savedChapterId);
  const savedChapterLabel = savedChapter?.display_name || savedChapter?.name || 'N/A';

  if (isLoading) return <div className="text-center py-8 text-gray-500">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Active Job Configuration</h2>
        <p className="text-gray-500 text-sm mt-1">Set the book, chapter, and scan mode for incoming items</p>
      </div>

      {savedBookId && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center text-green-700 mb-2">
            <CheckCircle className="w-5 h-5 mr-2" />
            <span className="font-medium">Current Active Job</span>
          </div>
          <p className="text-green-800 text-sm">
            <span className="font-medium">Book:</span> {savedBookLabel} |{' '}
            <span className="font-medium">Chapter:</span> {savedChapterLabel} |{' '}
            <span className="font-medium">Mode:</span> {savedItemType}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Book</label>
          <select
            value={selectedBookId}
            onChange={(e) => { setSelectedBookId(e.target.value); setSelectedChapterId(''); }}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select book...</option>
            {books?.data?.map((book) => (
              <option key={book.id} value={book.id}>{book.display_name || book.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Chapter</label>
          <select
            value={selectedChapterId}
            onChange={(e) => setSelectedChapterId(e.target.value)}
            disabled={!selectedBookId}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="">Select chapter...</option>
            {chapters?.data?.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.chapter_number ? `Ch ${ch.chapter_number}: ` : ''}{ch.display_name || ch.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Scan Mode</label>
        <div className="flex gap-4">
          <label className={`flex-1 flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer ${
            selectedItemType === 'question' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
          }`}>
            <input type="radio" value="question" checked={selectedItemType === 'question'}
              onChange={(e) => setSelectedItemType(e.target.value)} className="sr-only" />
            <HelpCircle className="w-5 h-5 mr-2" />
            <span>Questions</span>
          </label>
          <label className={`flex-1 flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer ${
            selectedItemType === 'solution' ? 'border-purple-500 bg-purple-50' : 'border-gray-200'
          }`}>
            <input type="radio" value="solution" checked={selectedItemType === 'solution'}
              onChange={(e) => setSelectedItemType(e.target.value)} className="sr-only" />
            <CheckCircle className="w-5 h-5 mr-2" />
            <span>Solutions</span>
          </label>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={!selectedBookId || !selectedChapterId}
          className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-5 h-5 mr-2" />
          Save Configuration
        </button>
        {saveSuccess && <span className="text-green-600 flex items-center"><CheckCircle className="w-4 h-4 mr-1" /> Saved!</span>}
      </div>
    </div>
  );
}

// ============ BOOKS TAB ============
function BooksTab() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [formData, setFormData] = useState({ name: '', display_name: '', description: '' });

  const { data: books, isLoading } = useQuery({
    queryKey: ['books'],
    queryFn: () => api.get('/books'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.post('/books', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['books'] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.put(`/books/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['books'] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/books/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['books'] }),
  });

  const openCreate = () => { setEditingBook(null); setFormData({ name: '', display_name: '', description: '', ref_id: '' }); setShowModal(true); };
  const openEdit = (book) => { setEditingBook(book); setFormData({ name: book.name, display_name: book.display_name || '', description: book.description || '', ref_id: book.ref_id || '' }); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditingBook(null); setFormData({ name: '', display_name: '', description: '', ref_id: '' }); };

  const handleSubmit = () => {
    if (!formData.name.trim()) return;
    const payload = {
      name: formData.name,
      display_name: formData.display_name,
      description: formData.description,
    };
    const trimmedRefId = formData.ref_id.trim();
    if (trimmedRefId) payload.ref_id = trimmedRefId;
    if (editingBook) {
      updateMutation.mutate({ id: editingBook.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  if (isLoading) return <div className="text-center py-8 text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Books</h2>
          <p className="text-gray-500 text-sm">Manage your book collection</p>
        </div>
        <button onClick={openCreate} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus className="w-5 h-5 mr-2" /> Add Book
        </button>
      </div>

      {books?.data?.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Book className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">No books found</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y">
          {books?.data?.map((book) => (
            <div key={book.id} className="flex items-center justify-between p-4 hover:bg-gray-50">
              <div>
                <p className="font-medium text-gray-800">{book.display_name || book.name}</p>
                {book.description && <p className="text-sm text-gray-500">{book.description}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(book)} className="p-2 text-gray-400 hover:text-blue-600">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => deleteMutation.mutate(book.id)} className="p-2 text-gray-400 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editingBook ? 'Edit Book' : 'Add Book'} onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name (ID)</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg" placeholder="e.g., math_grade10" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input type="text" value={formData.display_name} onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg" placeholder="e.g., Mathematics Grade 10" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ref Id</label>
              <input
                type="text"
                value={formData.ref_id}
                onChange={(e) => setFormData({ ...formData, ref_id: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
                placeholder="Optional — auto-generated if empty"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg" rows={2} placeholder="Optional description" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={closeModal} className="px-4 py-2 text-gray-600">Cancel</button>
            <button onClick={handleSubmit} disabled={!formData.name.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
              {editingBook ? 'Save Changes' : 'Add Book'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ CHAPTERS TAB ============
function ChaptersTab() {
  const queryClient = useQueryClient();
  const [selectedBookId, setSelectedBookId] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingChapter, setEditingChapter] = useState(null);
  const [formData, setFormData] = useState({ name: '', display_name: '', chapter_number: '' });

  const { data: books } = useQuery({
    queryKey: ['books'],
    queryFn: () => api.get('/books'),
  });

  const { data: chapters, isLoading } = useQuery({
    queryKey: ['chapters', selectedBookId],
    queryFn: () => api.get(`/chapters/book/${selectedBookId}`),
    enabled: !!selectedBookId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.post('/chapters', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['chapters'] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.put(`/chapters/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['chapters'] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/chapters/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chapters'] }),
  });

  const openCreate = () => { setEditingChapter(null); setFormData({ name: '', display_name: '', chapter_number: '', ref_id: '' }); setShowModal(true); };
  const openEdit = (ch) => { setEditingChapter(ch); setFormData({ name: ch.name, display_name: ch.display_name || '', chapter_number: ch.chapter_number || '', ref_id: ch.ref_id || '' }); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditingChapter(null); };

  const handleSubmit = () => {
    if (!formData.name.trim() || !selectedBookId) return;
    const { ref_id, ...rest } = formData;
    const payload = {
      ...rest,
      book_id: selectedBookId,
      chapter_number: formData.chapter_number ? parseInt(formData.chapter_number, 10) : null,
    };
    const trimmedRefId = ref_id.trim();
    if (trimmedRefId) payload.ref_id = trimmedRefId;
    if (editingChapter) {
      updateMutation.mutate({ id: editingChapter.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Chapters</h2>
          <p className="text-gray-500 text-sm">Manage chapters within books</p>
        </div>
        <button onClick={openCreate} disabled={!selectedBookId}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          <Plus className="w-5 h-5 mr-2" /> Add Chapter
        </button>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select Book</label>
        <select value={selectedBookId} onChange={(e) => setSelectedBookId(e.target.value)}
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg">
          <option value="">-- Select a book --</option>
          {books?.data?.map((book) => (
            <option key={book.id} value={book.id}>{book.display_name || book.name}</option>
          ))}
        </select>
      </div>

      {!selectedBookId ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          Select a book to view chapters
        </div>
      ) : isLoading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : chapters?.data?.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">No chapters found</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y">
          {chapters?.data?.map((ch) => (
            <div key={ch.id} className="flex items-center justify-between p-4 hover:bg-gray-50">
              <div>
                <p className="font-medium text-gray-800">
                  {ch.chapter_number && <span className="text-gray-500 mr-2">Ch {ch.chapter_number}:</span>}
                  {ch.display_name || ch.name}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(ch)} className="p-2 text-gray-400 hover:text-blue-600">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => deleteMutation.mutate(ch.id)} className="p-2 text-gray-400 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editingChapter ? 'Edit Chapter' : 'Add Chapter'} onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Chapter Number</label>
              <input type="number" value={formData.chapter_number} onChange={(e) => setFormData({ ...formData, chapter_number: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg" placeholder="e.g., 1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name (ID)</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg" placeholder="e.g., algebra_basics" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input type="text" value={formData.display_name} onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg" placeholder="e.g., Algebra Basics" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ref Id</label>
              <input
                type="text"
                value={formData.ref_id}
                onChange={(e) => setFormData({ ...formData, ref_id: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
                placeholder="Optional — auto-generated if empty"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={closeModal} className="px-4 py-2 text-gray-600">Cancel</button>
            <button onClick={handleSubmit} disabled={!formData.name.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
              {editingChapter ? 'Save Changes' : 'Add Chapter'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ MODAL COMPONENT ============
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
