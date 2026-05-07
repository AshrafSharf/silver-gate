import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Book, FileText, Save, CheckCircle, HelpCircle, FileQuestion } from 'lucide-react';
import { useActiveContext } from '../hooks/useActiveContext';

export default function JobConfigPage() {
  const { bookId: savedBookId, chapterId: savedChapterId, itemType: savedItemType, setContext } = useActiveContext();
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [selectedItemType, setSelectedItemType] = useState('question');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch books
  const { data: books, isLoading: booksLoading } = useQuery({
    queryKey: ['books'],
    queryFn: () => api.get('/books'),
  });

  // Fetch chapters for selected book
  const { data: chapters, isLoading: chaptersLoading } = useQuery({
    queryKey: ['chapters', selectedBookId],
    queryFn: () => api.get(`/chapters/book/${selectedBookId}`),
    enabled: !!selectedBookId,
  });

  // Initialize form with saved context (URL + localStorage)
  useEffect(() => {
    if (savedBookId) setSelectedBookId(savedBookId);
    if (savedChapterId) setSelectedChapterId(savedChapterId);
    if (savedItemType) setSelectedItemType(savedItemType);
  }, [savedBookId, savedChapterId, savedItemType]);

  // Reset chapter when book changes (compared against the saved book)
  useEffect(() => {
    if (selectedBookId && savedBookId !== selectedBookId) {
      setSelectedChapterId('');
    }
  }, [selectedBookId, savedBookId]);

  const handleSave = () => {
    if (selectedBookId && selectedChapterId) {
      setContext({ book: selectedBookId, chapter: selectedChapterId, type: selectedItemType });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const isLoading = booksLoading;
  const canSave = selectedBookId && selectedChapterId;

  // Look up display names for the currently saved context.
  const savedBook = books?.data?.find((b) => b.id === savedBookId);
  const savedBookLabel = savedBook?.display_name || savedBook?.name || 'Not set';
  const savedChapter = chapters?.data?.find((c) => c.id === savedChapterId);
  const savedChapterLabel = savedChapter?.display_name || savedChapter?.name || 'Not set';

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800">Job Configuration</h1>
        <p className="text-gray-500 mt-1">
          Configure the active book, chapter, and scan mode for scanning items
        </p>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          Loading...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Current Active Context */}
          {savedBookId && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center text-green-700 mb-2">
                <CheckCircle className="w-5 h-5 mr-2" />
                <span className="font-medium">Current Active Job</span>
              </div>
              <p className="text-green-800">
                <span className="font-medium">Book:</span> {savedBookLabel}
              </p>
              <p className="text-green-800">
                <span className="font-medium">Chapter:</span> {savedChapterLabel}
              </p>
              <p className="text-green-800">
                <span className="font-medium">Scan Mode:</span>{' '}
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium ${
                  savedItemType === 'question'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-purple-100 text-purple-800'
                }`}>
                  {savedItemType === 'question' ? 'Questions' : 'Solutions'}
                </span>
              </p>
            </div>
          )}

          {/* Book Selection */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-4">
              <Book className="w-5 h-5 text-blue-600 mr-2" />
              <h2 className="text-lg font-semibold text-gray-800">Select Book</h2>
            </div>

            <select
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">-- Select a book --</option>
              {books?.data?.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.display_name || book.name}
                </option>
              ))}
            </select>
          </div>

          {/* Chapter Selection */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-4">
              <FileText className="w-5 h-5 text-green-600 mr-2" />
              <h2 className="text-lg font-semibold text-gray-800">Select Chapter</h2>
            </div>

            {!selectedBookId ? (
              <div className="text-gray-500 text-center py-4">
                Please select a book first
              </div>
            ) : chaptersLoading ? (
              <div className="text-gray-500 text-center py-4">
                Loading chapters...
              </div>
            ) : chapters?.data?.length === 0 ? (
              <div className="text-gray-500 text-center py-4">
                No chapters found for this book
              </div>
            ) : (
              <select
                value={selectedChapterId}
                onChange={(e) => setSelectedChapterId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">-- Select a chapter --</option>
                {chapters?.data?.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.chapter_number ? `Ch ${chapter.chapter_number}: ` : ''}
                    {chapter.display_name || chapter.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Scan Mode Selection */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-4">
              <FileQuestion className="w-5 h-5 text-purple-600 mr-2" />
              <h2 className="text-lg font-semibold text-gray-800">Scan Mode</h2>
            </div>

            <div className="flex gap-4">
              <label
                className={`flex-1 flex items-center justify-center p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  selectedItemType === 'question'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="itemType"
                  value="question"
                  checked={selectedItemType === 'question'}
                  onChange={(e) => setSelectedItemType(e.target.value)}
                  className="sr-only"
                />
                <div className="text-center">
                  <HelpCircle className="w-8 h-8 mx-auto mb-2" />
                  <span className="font-medium">Questions</span>
                  <p className="text-sm text-gray-500 mt-1">Scan question papers</p>
                </div>
              </label>

              <label
                className={`flex-1 flex items-center justify-center p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  selectedItemType === 'solution'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="itemType"
                  value="solution"
                  checked={selectedItemType === 'solution'}
                  onChange={(e) => setSelectedItemType(e.target.value)}
                  className="sr-only"
                />
                <div className="text-center">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2" />
                  <span className="font-medium">Solutions</span>
                  <p className="text-sm text-gray-500 mt-1">Scan solution pages</p>
                </div>
              </label>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`flex items-center px-6 py-3 rounded-lg font-medium transition-colors ${
                canSave
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Save className="w-5 h-5 mr-2" />
              Save Configuration
            </button>

            {saveSuccess && (
              <span className="flex items-center text-green-600">
                <CheckCircle className="w-5 h-5 mr-2" />
                Configuration saved successfully!
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
