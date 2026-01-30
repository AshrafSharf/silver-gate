import { useState } from 'react';
import { X, FileQuestion, Code, Eye } from 'lucide-react';
import QuestionText from './QuestionText';

export default function QuestionSetModal({ isOpen, onClose, questionSet }) {
  const [viewMode, setViewMode] = useState('preview'); // 'preview' or 'json'

  if (!isOpen || !questionSet) return null;

  const questions = questionSet.questions?.questions || [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-blue-50">
          <div className="flex items-center gap-3">
            <FileQuestion className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-800">{questionSet.name}</h2>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                {questionSet.book?.display_name && <span>{questionSet.book.display_name}</span>}
                {questionSet.chapter?.display_name && (
                  <>
                    <span>-</span>
                    <span>{questionSet.chapter.display_name}</span>
                  </>
                )}
                <span>-</span>
                <span>{questions.length} questions</span>
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
                    ? 'bg-blue-500 text-white'
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
                    ? 'bg-blue-500 text-white'
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
              className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 bg-gray-50">
          {questionSet.status === 'failed' && questionSet.error_message && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-red-800 text-sm">{questionSet.error_message}</p>
            </div>
          )}

          {questionSet.status === 'processing' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-blue-800 text-sm">Extraction in progress...</p>
            </div>
          )}

          {viewMode === 'json' ? (
            /* JSON View */
            <div className="bg-gray-900 rounded-lg p-4 overflow-auto">
              <pre className="text-sm text-gray-100 font-mono whitespace-pre-wrap break-words">
                {JSON.stringify(questionSet.questions, null, 2)}
              </pre>
            </div>
          ) : questions.length > 0 ? (
            <div className="space-y-4">
              {questions.map((question, index) => (
                <div key={index} className="bg-white rounded-lg border shadow-sm p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">
                      {question.question_label || index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <QuestionText text={question.text} className="whitespace-pre-wrap" />
                      {question.choices?.length > 0 && (
                        <div className="mt-4 space-y-2 pl-2 border-l-2 border-blue-200">
                          {question.choices.map((choice, choiceIndex) => (
                            <QuestionText
                              key={choiceIndex}
                              text={choice}
                              className="text-gray-700 text-sm py-1"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : questionSet.status === 'completed' ? (
            <div className="text-center py-12">
              <FileQuestion className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No questions extracted</p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <span className="text-sm text-gray-500">
            Created: {new Date(questionSet.created_at).toLocaleString()}
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
