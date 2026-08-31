import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { X, FileQuestion, Code, Eye, Edit2, Save, Loader2, AlertCircle } from 'lucide-react';
import QuestionText from './QuestionText';

export default function QuestionSetModal({ isOpen, onClose, questionSet }) {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState('preview'); // 'preview' or 'json'
  const [isEditing, setIsEditing] = useState(false);
  const [draftJson, setDraftJson] = useState('');
  const [parseError, setParseError] = useState(null);

  // Reset edit state whenever a new question set is opened or modal closes.
  useEffect(() => {
    setIsEditing(false);
    setParseError(null);
    setDraftJson(
      questionSet?.questions ? JSON.stringify(questionSet.questions, null, 2) : ''
    );
  }, [questionSet?.id, isOpen]);

  const saveMutation = useMutation({
    mutationFn: (parsed) =>
      api.put(`/question-sets/${questionSet.id}`, { questions: parsed }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['questionSets'] });
      await queryClient.invalidateQueries({ queryKey: ['questionSet', questionSet.id] });
      await queryClient.refetchQueries({ queryKey: ['questionSets'] });
      setIsEditing(false);
    },
  });

  if (!isOpen || !questionSet) return null;

  const questions = questionSet.questions?.questions || [];
  // Academic Book extractions store grouped blocks (one per exercise / example
  // group) instead of a flat question list.
  const blocks = Array.isArray(questionSet.questions?.blocks)
    ? questionSet.questions.blocks
    : null;
  const parseWarnings = questionSet.questions?.parse_warnings || [];
  const blockItemCount = blocks
    ? blocks.reduce((n, b) => n + (b.toc_question_items?.length || 0), 0)
    : 0;

  const handleStartEdit = () => {
    setDraftJson(JSON.stringify(questionSet.questions ?? { questions: [] }, null, 2));
    setParseError(null);
    saveMutation.reset();
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setDraftJson(JSON.stringify(questionSet.questions ?? { questions: [] }, null, 2));
    setParseError(null);
    saveMutation.reset();
    setIsEditing(false);
  };

  const handleSave = () => {
    let parsed;
    try {
      parsed = JSON.parse(draftJson);
    } catch (e) {
      setParseError(e.message);
      return;
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (!Array.isArray(parsed.questions) && !Array.isArray(parsed.blocks))
    ) {
      setParseError('JSON must have a "questions" array (question bank) or a "blocks" array (academic book)');
      return;
    }
    setParseError(null);
    saveMutation.mutate(parsed);
  };

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
                <span>
                  {blocks
                    ? `${blocks.length} blocks - ${blockItemCount} questions`
                    : `${questions.length} questions`}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View Mode Toggle (hidden in edit mode — JSON only) */}
            {!isEditing && (
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
            )}

            {/* Edit / Save / Cancel */}
            {viewMode === 'json' && !isEditing && (
              <button
                onClick={handleStartEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                title="Edit JSON"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
            )}
            {isEditing && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={saveMutation.isPending}
                  className="px-3 py-1.5 text-sm font-medium bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}

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

          {(saveMutation.isError || parseError) && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                {parseError
                  ? `Invalid JSON: ${parseError}`
                  : saveMutation.error?.response?.data?.error ||
                    saveMutation.error?.message ||
                    'Failed to save questions'}
              </span>
            </div>
          )}

          {isEditing ? (
            <div className="bg-gray-900 rounded-lg overflow-hidden">
              <textarea
                value={draftJson}
                onChange={(e) => {
                  setDraftJson(e.target.value);
                  if (parseError) setParseError(null);
                }}
                spellCheck={false}
                className="w-full min-h-[60vh] p-4 bg-gray-900 text-gray-100 font-mono text-sm border-0 focus:outline-none focus:ring-0 resize-y"
              />
            </div>
          ) : viewMode === 'json' ? (
            /* JSON View (read-only) */
            <div className="bg-gray-900 rounded-lg p-4 overflow-auto">
              <pre className="text-sm text-gray-100 font-mono whitespace-pre-wrap break-words">
                {JSON.stringify(questionSet.questions, null, 2)}
              </pre>
            </div>
          ) : blocks ? (
            /* Academic Book: one card per exercise / example group */
            <div className="space-y-4">
              {parseWarnings.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium mb-1">
                      {parseWarnings.length} annotation {parseWarnings.length === 1 ? 'warning' : 'warnings'}
                    </p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {parseWarnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {blocks.map((block, blockIndex) => (
                <div key={blockIndex} className="bg-white rounded-lg border shadow-sm">
                  <div className="flex items-start justify-between gap-3 p-3 border-b bg-gray-50 rounded-t-lg">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            block.type === 'EXAMPLE'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {block.type}
                        </span>
                        <span className="font-semibold text-gray-800">
                          {block.name} {block.index}
                        </span>
                        <span className="text-xs text-gray-500">
                          {block.toc_question_items?.length || 0} items
                        </span>
                        {block.question_type && block.question_type !== 'OTHER' && (
                          <span className="px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-700">
                            {block.question_type}
                          </span>
                        )}
                      </div>
                      {block.common_parent_section_name && (
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          {block.common_parent_section_name}
                        </p>
                      )}
                    </div>
                    {(block.start_page || block.end_page) && (
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        p. {block.start_page}
                        {block.end_page && block.end_page !== block.start_page ? `-${block.end_page}` : ''}
                      </span>
                    )}
                  </div>

                  <div className="p-4 space-y-4">
                    {block.choice_question_header_text && (
                      <QuestionText
                        text={block.choice_question_header_text}
                        className="text-sm font-medium text-gray-700"
                      />
                    )}
                    {(block.toc_question_items || []).map((item, itemIndex) => (
                      <div key={itemIndex} className="flex items-start gap-3">
                        <span className="flex-shrink-0 w-8 h-8 bg-gray-100 text-gray-600 rounded-full flex items-center justify-center text-xs font-bold">
                          {item.question_label || item.id}
                        </span>
                        <div className="flex-1 min-w-0">
                          <QuestionText text={item.question} className="whitespace-pre-wrap" />
                          {item.solution && (
                            <details className="mt-2">
                              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                                Solution
                              </summary>
                              <QuestionText
                                text={item.solution}
                                className="mt-1 text-sm text-gray-600 whitespace-pre-wrap"
                              />
                            </details>
                          )}
                          {item.sub_questions?.length > 0 && (
                            <div className="mt-2 space-y-1 pl-2 border-l-2 border-gray-200">
                              {item.sub_questions.map((sub, subIndex) => (
                                <div key={subIndex} className="flex gap-2 text-sm">
                                  <span className="text-gray-400 flex-shrink-0">
                                    {sub.question_label}
                                  </span>
                                  <QuestionText text={sub.question} className="text-gray-700" />
                                </div>
                              ))}
                            </div>
                          )}
                          {item.choices?.length > 0 && (
                            <div className="mt-2 space-y-1 pl-2 border-l-2 border-blue-200">
                              {item.choices.map((choice, choiceIndex) => (
                                <div key={choiceIndex} className="flex gap-2 text-sm">
                                  <span className="text-gray-400 flex-shrink-0">
                                    {choice.question_label}
                                  </span>
                                  <QuestionText text={choice.question} className="text-gray-700" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
