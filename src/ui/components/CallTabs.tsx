'use client';

interface CallTabsProps {
    activeTab: 'outbound' | 'inbound';
    onTabChange: (tab: 'outbound' | 'inbound') => void;
    disabled?: boolean;
}

export function CallTabs({ activeTab, onTabChange, disabled }: CallTabsProps) {
    return (
        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
            <button
                onClick={() => onTabChange('outbound')}
                disabled={disabled}
                className={`flex-1 py-3 px-4 text-center font-medium transition-all relative ${activeTab === 'outbound'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
                <span className="flex items-center justify-center gap-2">
                    📞 Outbound Call
                </span>
                {activeTab === 'outbound' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"></div>
                )}
            </button>
            <button
                onClick={() => onTabChange('inbound')}
                disabled={disabled}
                className={`flex-1 py-3 px-4 text-center font-medium transition-all relative ${activeTab === 'inbound'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
                <span className="flex items-center justify-center gap-2">
                    📲 Inbound Calls
                </span>
                {activeTab === 'inbound' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"></div>
                )}
            </button>
        </div>
    );
}
