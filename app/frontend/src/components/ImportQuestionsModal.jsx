import { useState, useRef } from 'react';
import { X, Upload, FileJson, AlertCircle, Check } from 'lucide-react';

/**
 * Fix invalid escape sequences in JSON string (LaTeX backslashes)
 * LaTeX uses single backslashes (\frac, \alpha, etc.) which are invalid in JSON
 */
function fixInvalidEscapeSequences(jsonStr) {
  let result = '';
  let i = 0;

  while (i < jsonStr.length) {
    if (jsonStr[i] === '"') {
      result += '"';
      i++;

      while (i < jsonStr.length) {
        const char = jsonStr[i];

        if (char === '\\' && i + 1 < jsonStr.length) {
          const nextChar = jsonStr[i + 1];

          // Valid JSON escape sequences: \" \\ \/ \b \f \n \r \t \uXXXX
          if ('"\\/bfnrtu'.includes(nextChar)) {
            result += char + nextChar;
            i += 2;
          } else {
            // Invalid escape - double the backslash
            result += '\\\\' + nextChar;
            i += 2;
          }
        } else if (char === '"') {
          result += '"';
          i++;
          break;
        } else {
          result += char;
          i++;
        }
      }
    } else {
      result += jsonStr[i];
      i++;
    }
  }

  return result;
}

export default function ImportQuestionsModal({ isOpen, onClose, onImport, books, chapters, selectedBookId, selectedChapterId }) {
  const [name, setName] = useState('');
  const [bookId, setBookId] = useState(selectedBookId || '');
  const [chapterId, setChapterId] = useState(selectedChapterId || '');
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');
  const [isValidJson, setIsValidJson] = useState(false);
  const [parsedCount, setParsedCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const validateJson = (text) => {
    setError('');
    setIsValidJson(false);
    setParsedCount(0);

    if (!text.trim()) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Try fixing invalid escape sequences (common in LaTeX)
      try {
        const fixedText = fixInvalidEscapeSequences(text);
        parsed = JSON.parse(fixedText);
        console.log('JSON parsed after fixing escape sequences');
      } catch (e2) {
        setError(`Invalid JSON: ${e.message}`);
        return;
      }
    }

    // Check if it has the questions array
    if (parsed.questions && Array.isArray(parsed.questions)) {
      setIsValidJson(true);
      setParsedCount(parsed.questions.length);
    } else if (Array.isArray(parsed)) {
      // If it's just an array, wrap it
      setIsValidJson(true);
      setParsedCount(parsed.length);
    } else {
      setError('JSON must have a "questions" array property or be an array of questions');
    }
  };

  const handleJsonChange = (e) => {
    const value = e.target.value;
    setJsonInput(value);
    validateJson(value);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        setJsonInput(text);
        validateJson(text);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!isValidJson) return;

    setIsSubmitting(true);
    setError('');

    try {
      let questions;
      try {
        questions = JSON.parse(jsonInput);
      } catch {
        // Try with fixed escape sequences
        questions = JSON.parse(fixInvalidEscapeSequences(jsonInput));
      }

      // Wrap array in questions object if needed
      if (Array.isArray(questions)) {
        questions = { questions };
      }

      await onImport({
        name: name || `Manual Import ${new Date().toLocaleString()}`,
        bookId: bookId || null,
        chapterId: chapterId || null,
        questions,
      });

      // Reset form and close
      setName('');
      setJsonInput('');
      setIsValidJson(false);
      setParsedCount(0);
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to import questions');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setName('');
    setJsonInput('');
    setError('');
    setIsValidJson(false);
    setParsedCount(0);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-green-50">
          <div className="flex items-center gap-3">
            <FileJson className="w-6 h-6 text-green-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Import Questions</h2>
              <p className="text-sm text-gray-500">Upload or paste JSON to create a question set</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-green-100 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Name input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Question Set Name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Book/Chapter selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Book (optional)
              </label>
              <select
                value={bookId}
                onChange={(e) => {
                  setBookId(e.target.value);
                  setChapterId('');
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="">Select Book</option>
                {books?.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.display_name || book.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Chapter (optional)
              </label>
              <select
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                disabled={!bookId}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:bg-gray-100"
              >
                <option value="">Select Chapter</option>
                {chapters?.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.display_name || chapter.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Upload JSON File
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors"
            >
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Click to upload or drag and drop</p>
              <p className="text-xs text-gray-400 mt-1">.json files only</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {/* JSON textarea */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Or Paste JSON
            </label>
            <textarea
              value={jsonInput}
              onChange={handleJsonChange}
              placeholder={'{\n  "questions": [\n    {\n      "question_label": "1",\n      "text": "Question text here",\n      "choices": ["(a) Choice 1", "(b) Choice 2", "(c) Choice 3", "(d) Choice 4"]\n    }\n  ]\n}'}
              rows={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Validation status */}
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {isValidJson && (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
              <Check className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">Valid JSON - {parsedCount} questions found</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValidJson || isSubmitting}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="animate-spin">...</span>
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Import {parsedCount > 0 && `(${parsedCount} questions)`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
