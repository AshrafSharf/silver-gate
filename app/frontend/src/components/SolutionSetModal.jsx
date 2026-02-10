import { useState } from 'react';
import { X, CheckCircle, Code, Eye } from 'lucide-react';
import QuestionText from './QuestionText';

export default function SolutionSetModal({ isOpen, onClose, solutionSet }) {
  const [viewMode, setViewMode] = useState('preview'); // 'preview' or 'json'

  if (!isOpen || !solutionSet) return null;

  const solutions = solutionSet.solutions?.solutions || [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-purple-50">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-purple-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-800">{solutionSet.name}</h2>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                {solutionSet.book?.display_name && <span>{solutionSet.book.display_name}</span>}
                {solutionSet.chapter?.display_name && (
                  <>
                    <span>-</span>
                    <span>{solutionSet.chapter.display_name}</span>
                  </>
                )}
                <span>-</span>
                <span>{solutions.length} solutions</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex rounded-lg border border-gray-300 bg-white overflow-hidden">
              <button
                onClick={() => setViewMode('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-purple-500 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                title="Preview"
              >
                <Eye className="w-4 h-4" />
                Preview
              </button>
              <button
                onClick={() => setViewMode('json')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'json'
                    ? 'bg-purple-500 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                title="JSON"
              >
                <Code className="w-4 h-4" />
                JSON
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-purple-100 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 bg-gray-50">
          {solutionSet.status === 'failed' && solutionSet.error_message && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-red-800 text-sm">{solutionSet.error_message}</p>
            </div>
          )}

          {solutionSet.status === 'processing' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-blue-800 text-sm">Extraction in progress...</p>
            </div>
          )}

          {solutionSet.question_set && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-blue-800 text-sm">
                Linked to: <span className="font-medium">{solutionSet.question_set.name}</span>
                {' '}({solutionSet.question_set.total_questions} questions)
              </p>
            </div>
          )}

          {viewMode === 'json' ? (
            /* JSON View */
            <div className="bg-gray-900 rounded-lg p-4 overflow-auto">
              <pre className="text-sm text-gray-100 font-mono whitespace-pre-wrap break-words">
                {JSON.stringify(solutionSet.solutions, null, 2)}
              </pre>
            </div>
          ) : solutions.length > 0 ? (
            <div className="space-y-4">
              {solutions.map((solution, index) => (
                <div key={index} className="bg-white rounded-lg border shadow-sm p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-10 h-10 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-bold">
                      {solution.question_label || index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      {solution.answer_key && (
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-500">Answer:</span>
                          <span className="inline-flex items-center justify-center px-3 py-1 bg-green-100 text-green-700 rounded-md text-sm font-bold">
                            {solution.answer_key}
                          </span>
                        </div>
                      )}
                      {solution.worked_solution && (
                        <div className="mt-2">
                          <span className="text-sm font-medium text-gray-500 block mb-1">Solution:</span>
                          <div className="pl-3 border-l-2 border-purple-200">
                            <QuestionText text={solution.worked_solution} className="whitespace-pre-wrap text-sm" />
                          </div>
                        </div>
                      )}
                      {solution.explanation && (
                        <div className="mt-3">
                          <span className="text-sm font-medium text-gray-500 block mb-1">Explanation:</span>
                          <div className="pl-3 border-l-2 border-gray-200">
                            <QuestionText text={solution.explanation} className="text-gray-600 whitespace-pre-wrap text-sm" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : solutionSet.status === 'completed' ? (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No solutions extracted</p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <span className="text-sm text-gray-500">
            Created: {new Date(solutionSet.created_at).toLocaleString()}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
