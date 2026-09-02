import { useState, useRef } from 'react';
import { X, Upload, FileJson, AlertCircle, AlertTriangle, Check } from 'lucide-react';

const REF_ID_PATTERN = /^[a-f0-9]{24}$/i;

/**
 * Normalize the exported chapter shape ({ chapterNumber, name, displayName,
 * refId }) into the flat rows the preview table and the import endpoint use.
 * Returns { chapters, error } — error is a human-readable string on failure.
 */
function normalizeChapters(parsed) {
  const list = Array.isArray(parsed) ? parsed : parsed?.chapters;

  if (!Array.isArray(list)) {
    return { error: 'JSON must have a "chapters" array property, or be an array of chapters' };
  }

  if (list.length === 0) {
    return { error: 'The "chapters" array is empty' };
  }

  const chapters = [];

  for (let i = 0; i < list.length; i++) {
    const raw = list[i] || {};
    const name = String(raw.name ?? '').trim();

    if (!name) {
      return { error: `Chapter at position ${i + 1} is missing a "name"` };
    }

    const rawNumber = raw.chapterNumber ?? raw.chapter_number;
    const hasNumber = rawNumber !== undefined && rawNumber !== null && rawNumber !== '';
    const chapterNumber = hasNumber ? Number(rawNumber) : null;

    if (chapterNumber !== null && !Number.isInteger(chapterNumber)) {
      return { error: `Chapter "${name}" has a non-numeric chapterNumber` };
    }

    const refId = String(raw.refId ?? raw.ref_id ?? '').trim();

    if (refId && !REF_ID_PATTERN.test(refId)) {
      return { error: `Chapter "${name}" has an invalid refId (expected 24 hex characters)` };
    }

    chapters.push({
      name,
      displayName: String(raw.displayName ?? raw.display_name ?? '').trim() || name,
      chapterNumber,
      refId: refId || null,
    });
  }

  return { chapters };
}

export default function ImportChaptersModal({ isOpen, onClose, onImport, book }) {
  const [jsonInput, setJsonInput] = useState('');
  const [fileName, setFileName] = useState('');
  const [chapters, setChapters] = useState([]);
  const [bookRefId, setBookRefId] = useState(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [result, setResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const resetValidation = () => {
    setError('');
    setWarning('');
    setChapters([]);
    setBookRefId(null);
    setResult(null);
  };

  const validateJson = (text) => {
    resetValidation();

    if (!text.trim()) return;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${e.message}`);
      return;
    }

    const { chapters: normalized, error: normalizeError } = normalizeChapters(parsed);

    if (normalizeError) {
      setError(normalizeError);
      return;
    }

    // The file records the ref id of the book it was exported from, under any
    // of these spellings. A mismatch is a likely wrong-book import, so surface
    // it prominently — but the selected book still wins if the user proceeds.
    const fileBookRefId = parsed?.book_refId ?? parsed?.bookRefId ?? parsed?.book_ref_id ?? parsed?.bookId ?? parsed?.book_id ?? null;

    if (fileBookRefId && book?.ref_id && fileBookRefId !== book.ref_id) {
      setWarning(
        `This file was exported for book ${fileBookRefId}, but "${book.display_name || book.name}" has ref id ${book.ref_id}. Importing will add these chapters to the selected book.`
      );
    }

    setBookRefId(fileBookRefId);
    setChapters(normalized);
  };

  const handleJsonChange = (e) => {
    const value = e.target.value;
    setJsonInput(value);
    setFileName('');
    validateJson(value);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        setFileName(file.name);
        setJsonInput(text);
        validateJson(text);
      }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);

    // Allow re-selecting the same file after a failed import.
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (chapters.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const response = await onImport(chapters, bookRefId);
      setResult(response);
    } catch (e) {
      setError(e.message || 'Failed to import chapters');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setJsonInput('');
    setFileName('');
    resetValidation();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-blue-50">
          <div className="flex items-center gap-3">
            <FileJson className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Import Chapters</h2>
              <p className="text-sm text-gray-500">
                Upload or paste JSON to create chapters for{' '}
                <span className="font-medium">{book?.display_name || book?.name || 'the selected book'}</span>
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-blue-100 rounded-lg transition-colors" title="Close">
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Upload JSON File</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">{fileName || 'Click to upload a chapters JSON file'}</p>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Or Paste JSON</label>
            <textarea
              value={jsonInput}
              onChange={handleJsonChange}
              placeholder={'{\n  "book_refId": "6a958aa785537405ab0f8f2f",\n  "chapters": [\n    {\n      "chapterNumber": 1,\n      "name": "numerical_methods",\n      "displayName": "Numerical Methods",\n      "refId": "6a958aa785537405ab0f8f34"\n    }\n  ]\n}'}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Validation status */}
          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {warning && (
            <div className="flex items-start gap-2 text-amber-700 bg-amber-50 p-3 rounded-lg">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{warning}</span>
            </div>
          )}

          {chapters.length > 0 && !result && (
            <>
              <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
                <Check className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">Valid JSON — {chapters.length} chapters found</span>
              </div>

              {/* Preview */}
              <div className="border rounded-lg divide-y max-h-64 overflow-auto">
                {chapters.map((ch, i) => (
                  <div key={`${ch.name}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="text-gray-500 mr-2">
                        {ch.chapterNumber !== null ? `Ch ${ch.chapterNumber}` : `#${i + 1}`}
                      </span>
                      <span className="text-gray-800">{ch.displayName}</span>
                    </div>
                    <span className="ml-3 font-mono text-xs text-gray-400 flex-shrink-0">{ch.refId || 'auto'}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Import result */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-green-700 bg-green-50 p-3 rounded-lg">
                <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span className="text-sm">
                  Imported — {result.created} created, {result.updated} updated
                  {result.errors?.length > 0 ? `, ${result.errors.length} failed` : ''}
                </span>
              </div>

              {result.errors?.length > 0 && (
                <div className="border border-red-200 rounded-lg divide-y divide-red-100 max-h-40 overflow-auto">
                  {result.errors.map((err, i) => (
                    <div key={i} className="px-3 py-2 text-sm">
                      <span className="font-medium text-gray-800">{err.name}</span>
                      <span className="text-red-600"> — {err.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t">
          <button onClick={handleClose} className="px-4 py-2 text-gray-600 hover:text-gray-800">
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleSubmit}
              disabled={chapters.length === 0 || isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Importing...' : `Import ${chapters.length || ''} Chapters`.trim()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
