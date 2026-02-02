'use client';

import { useState } from 'react';
import { AgentType } from './useAgentTypes';

interface AgentTypeManagerProps {
  agentTypes: AgentType[];
  selectedTypeId: string;
  onSelect: (id: string) => void;
  onAdd: (name: string, agenda: string) => AgentType;
  onUpdate: (id: string, updates: Partial<Pick<AgentType, 'name' | 'agenda'>>) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

export function AgentTypeManager({
  agentTypes,
  selectedTypeId,
  onSelect,
  onAdd,
  onUpdate,
  onDelete,
  disabled,
}: AgentTypeManagerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleCreate = () => {
    if (!newName.trim()) return;
    const newType = onAdd(newName.trim(), '');
    onSelect(newType.id);
    setNewName('');
    setIsCreating(false);
  };

  const handleStartEdit = (type: AgentType) => {
    setEditingId(type.id);
    setEditingName(type.name);
  };

  const handleSaveEdit = () => {
    if (editingId && editingName.trim()) {
      onUpdate(editingId, { name: editingName.trim() });
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this agent type?')) {
      onDelete(id);
      if (selectedTypeId === id) {
        onSelect(agentTypes[0]?.id || '');
      }
    }
  };

  const selectedType = agentTypes.find(t => t.id === selectedTypeId);

  return (
    <div className="space-y-3">
      {/* Dropdown for selecting agent type */}
      <div className="flex gap-2">
        <select
          value={selectedTypeId}
          onChange={(e) => onSelect(e.target.value)}
          disabled={disabled}
          className="flex-1 px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <optgroup label="Built-in">
            {agentTypes.filter(t => t.isBuiltIn).map(type => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </optgroup>
          {agentTypes.some(t => !t.isBuiltIn) && (
            <optgroup label="Custom">
              {agentTypes.filter(t => !t.isBuiltIn).map(type => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <button
          onClick={() => setIsCreating(true)}
          disabled={disabled}
          className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          title="Create new agent type"
        >
          + New
        </button>
      </div>

      {/* Edit/Delete buttons for custom types */}
      {selectedType && !selectedType.isBuiltIn && (
        <div className="flex gap-2 text-sm">
          {editingId === selectedType.id ? (
            <>
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                className="flex-1 px-2 py-1 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                autoFocus
              />
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded"
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 text-gray-500 dark:text-gray-400 italic">
                Custom agent type
              </span>
              <button
                onClick={() => handleStartEdit(selectedType)}
                disabled={disabled}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded disabled:opacity-50"
              >
                Rename
              </button>
              <button
                onClick={() => handleDelete(selectedType.id)}
                disabled={disabled}
                className="px-3 py-1 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded disabled:opacity-50"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Create new agent type modal/inline */}
      {isCreating && (
        <div className="p-3 border rounded-lg dark:border-gray-600 bg-blue-50 dark:bg-blue-900/20">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            New Agent Type Name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g., 🎯 Sales Follow-up"
              className="flex-1 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => { setIsCreating(false); setNewName(''); }}
              className="px-4 py-2 bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-700 dark:text-white rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
