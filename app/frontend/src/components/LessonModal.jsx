import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { BookOpen, X, Save, Edit2, FileQuestion, CheckCircle, Code, Eye, Trash2 } from 'lucide-react';
import QuestionText from './QuestionText';

export default function LessonModal({ lesson, onClose }) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [showJsonView, setShowJsonView] = useState(false);
  const [editedName, setEditedName] = useState(lesson.name);
  const [editedItems, setEditedItems] = useState(
    lesson.lesson_items || []
  );

  // Update lesson name mutation
  const updateLessonMutation = useMutation({
    mutationFn: (name) => api.put(`/lessons/${lesson.id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries(['lessons']);
    },
  });

  // Update lesson item mutation
  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }) =>
      api.put(`/lessons/${lesson.id}/items/${itemId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['lessons']);
    },
  });

  // Delete lesson item mutation
  const deleteItemMutation = useMutation({
    mutationFn: (itemId) => api.delete(`/lessons/${lesson.id}/items/${itemId}`),
    onSuccess: (_, deletedItemId) => {
      setEditedItems(prev => prev.filter(item => item.id !== deletedItemId));
      queryClient.invalidateQueries(['lessons']);
    },
  });

  const handleDeleteItem = (itemId, label) => {
    if (window.confirm(`Delete question ${label}?`)) {
      deleteItemMutation.mutate(itemId);
    }
  };

  const handleSave = async () => {
    try {
      // Update lesson name if changed
      if (editedName !== lesson.name) {
        await updateLessonMutation.mutateAsync(editedName);
      }

      // Update each lesson item
      const updatePromises = editedItems.map((item, index) => {
        const originalItem = lesson.lesson_items[index];

        // Check if item was modified by comparing JSON
        if (JSON.stringify(item.question_solution_item_json) !==
            JSON.stringify(originalItem?.question_solution_item_json)) {
          return updateItemMutation.mutateAsync({
            itemId: item.id,
            data: { question_solution_item_json: item.question_solution_item_json },
          });
        }
        return Promise.resolve();
      });

      await Promise.all(updatePromises);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving lesson:', error);
    }
  };

  const handleCancel = () => {
    setEditedName(lesson.name);
    setEditedItems(lesson.lesson_items || []);
    setIsEditing(false);
  };

  const updateItem = (index, field, value) => {
    const updated = [...editedItems];
    const itemJson = { ...updated[index].question_solution_item_json };
    itemJson[field] = value;
    updated[index] = {
      ...updated[index],
      question_solution_item_json: itemJson
    };
    setEditedItems(updated);
  };

  const updateChoice = (itemIndex, choiceIndex, value) => {
    const updated = [...editedItems];
    const itemJson = { ...updated[itemIndex].question_solution_item_json };
    const choices = [...(itemJson.choices || [])];
    choices[choiceIndex] = value;
    itemJson.choices = choices;
    updated[itemIndex] = {
      ...updated[itemIndex],
      question_solution_item_json: itemJson
    };
    setEditedItems(updated);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-green-50">
          <div className="flex-1">
            {isEditing ? (
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                className="text-lg font-semibold text-gray-800 border border-gray-300 rounded px-2 py-1 w-full"
              />
            ) : (
              <div className="flex items-center gap-3">
                <BookOpen className="w-6 h-6 text-green-600" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">{lesson.name}</h2>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    {lesson.book?.display_name && <span>{lesson.book.display_name}</span>}
                    {lesson.chapter?.display_name && (
                      <>
                        <span>-</span>
                        <span>{lesson.chapter.display_name}</span>
                      </>
                    )}
                    <span>-</span>
                    <span>{editedItems.length} items</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* JSON View Toggle */}
            <button
              onClick={() => setShowJsonView(!showJsonView)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                showJsonView
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              title={showJsonView ? 'Show formatted view' : 'Show JSON view'}
            >
              {showJsonView ? <Eye className="w-4 h-4" /> : <Code className="w-4 h-4" />}
              {showJsonView ? 'View' : 'JSON'}
            </button>
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={updateLessonMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {updateLessonMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : !showJsonView && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-green-100 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 bg-gray-50">
          {/* JSON View */}
          {showJsonView ? (
            editedItems.length > 0 ? (
              <div className="space-y-4">
                {editedItems.map((lessonItem, index) => (
                  <div key={lessonItem.id || index} className="bg-white rounded-lg border shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="flex-shrink-0 w-8 h-8 bg-gray-700 text-white rounded-full flex items-center justify-center text-sm font-bold">
                        {lessonItem.question_solution_item_json?.question_label || index + 1}
                      </span>
                      <span className="text-sm font-medium text-gray-500">question_solution_item_json</span>
                      <button
                        onClick={() => handleDeleteItem(lessonItem.id, lessonItem.question_solution_item_json?.question_label || index + 1)}
                        className="ml-auto p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-auto text-sm font-mono">
                      {JSON.stringify(lessonItem.question_solution_item_json, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Code className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No JSON data available</p>
              </div>
            )
          ) : editedItems.length > 0 ? (
            <div className="space-y-4">
              {editedItems.map((lessonItem, index) => {
                const item = lessonItem.question_solution_item_json;
                return (
                  <div key={lessonItem.id || index} className="bg-white rounded-lg border shadow-sm p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-bold">
                        {item.question_label || index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        {/* Question */}
                        <div className="mb-3">
                          <label className="text-xs font-medium text-gray-500 block mb-1">Question:</label>
                          {isEditing ? (
                            <textarea
                              value={item.text || ''}
                              onChange={(e) => updateItem(index, 'text', e.target.value)}
                              rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                          />
                        ) : (
                          <QuestionText text={item.text} className="whitespace-pre-wrap" />
                        )}
                      </div>

                      {/* Choices */}
                      {item.choices && item.choices.length > 0 && (
                        <div className="mb-3">
                          <label className="text-xs font-medium text-gray-500 block mb-1">Choices:</label>
                          <div className="space-y-2 pl-2 border-l-2 border-blue-200">
                            {item.choices.map((choice, choiceIndex) => (
                              <div key={choiceIndex}>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={choice || ''}
                                    onChange={(e) => updateChoice(index, choiceIndex, e.target.value)}
                                    className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                  />
                                ) : (
                                  <QuestionText text={choice} className="text-gray-700 text-sm py-1" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                        {/* Answer Key */}
                        <div className="mb-3">
                          <label className="text-xs font-medium text-gray-500 block mb-1">Answer:</label>
                          {isEditing ? (
                            <input
                              type="text"
                              value={item.answer_key || ''}
                              onChange={(e) => updateItem(index, 'answer_key', e.target.value)}
                              className="px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                              placeholder="e.g., A, B, C, D"
                            />
                          ) : item.answer_key ? (
                            <span className="inline-flex items-center justify-center px-3 py-1 bg-green-100 text-green-700 rounded-md text-sm font-bold">
                              {item.answer_key}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-sm">No answer provided</span>
                          )}
                        </div>

                        {/* Worked Solution */}
                        <div className="mb-3">
                          <label className="text-xs font-medium text-gray-500 block mb-1">Solution:</label>
                          {isEditing ? (
                            <textarea
                              value={item.worked_solution || ''}
                              onChange={(e) => updateItem(index, 'worked_solution', e.target.value)}
                              rows={4}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                              placeholder="Step-by-step solution"
                            />
                          ) : item.worked_solution ? (
                            <div className="pl-3 border-l-2 border-purple-200">
                              <QuestionText text={item.worked_solution} className="whitespace-pre-wrap text-sm" />
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">No solution provided</span>
                          )}
                        </div>

                        {/* Explanation */}
                        {(isEditing || item.explanation) && (
                          <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Explanation:</label>
                            {isEditing ? (
                              <textarea
                                value={item.explanation || ''}
                                onChange={(e) => updateItem(index, 'explanation', e.target.value)}
                                rows={2}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 text-sm"
                                placeholder="Additional explanation (optional)"
                              />
                            ) : (
                              <div className="pl-3 border-l-2 border-gray-200">
                                <QuestionText text={item.explanation} className="text-gray-600 whitespace-pre-wrap text-sm" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {!isEditing && (
                        <button
                          onClick={() => handleDeleteItem(lessonItem.id, item.question_label || index + 1)}
                          className="flex-shrink-0 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No items in this lesson</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <div className="flex items-center gap-4 text-sm text-gray-500">
            {lesson.question_set && (
              <div className="flex items-center gap-2">
                <FileQuestion className="w-4 h-4 text-blue-500" />
                <span>Q: {lesson.question_set.name}</span>
              </div>
            )}
            {lesson.solution_set && (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-purple-500" />
                <span>S: {lesson.solution_set.name}</span>
              </div>
            )}
          </div>
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
