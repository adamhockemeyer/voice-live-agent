'use client';

interface TranscriptPanelProps {
  transcripts: Array<{ role: string; text: string }>;
}

export function TranscriptPanel({ transcripts }: TranscriptPanelProps) {
  return (
    <div className="h-64 overflow-y-auto space-y-3 p-2">
      {transcripts.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          Conversation transcript will appear here...
        </p>
      ) : (
        transcripts.map((item, index) => (
          <div
            key={index}
            className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-lg ${item.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                }`}
            >
              <span className="text-xs font-semibold block mb-1 opacity-70">
                {item.role === 'user' ? 'You' : 'Assistant'}
              </span>
              <p>{item.text}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
