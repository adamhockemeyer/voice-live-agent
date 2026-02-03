'use client';

interface CallHeaderProps {
    isCallActive: boolean;
    callId: string | null;
    direction: 'inbound' | 'outbound' | null;
    phoneNumber?: string;
}

export function CallHeader({ isCallActive, callId, direction, phoneNumber }: CallHeaderProps) {
    return (
        <div className={`rounded-lg p-4 mb-6 transition-all ${isCallActive
                ? 'bg-green-50 dark:bg-green-900/30 border-2 border-green-400 dark:border-green-600'
                : 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
            }`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {/* Status Indicator */}
                    <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${isCallActive
                                ? 'bg-green-500 animate-pulse'
                                : 'bg-gray-400'
                            }`}></span>
                        <span className={`font-semibold ${isCallActive
                                ? 'text-green-700 dark:text-green-400'
                                : 'text-gray-600 dark:text-gray-400'
                            }`}>
                            {isCallActive ? 'Call Active' : 'No Active Call'}
                        </span>
                    </div>

                    {/* Direction Badge */}
                    {isCallActive && direction && (
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${direction === 'inbound'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                                : 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                            }`}>
                            {direction === 'inbound' ? '📲 Inbound' : '📞 Outbound'}
                        </span>
                    )}

                    {/* Phone Number */}
                    {isCallActive && phoneNumber && (
                        <span className="text-gray-600 dark:text-gray-300 font-mono">
                            {phoneNumber}
                        </span>
                    )}
                </div>

                {/* Call ID */}
                <div className="text-right">
                    {callId ? (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400">Call ID:</span>
                            <code className="text-xs font-mono bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded text-gray-700 dark:text-gray-300">
                                {callId.substring(0, 12)}...
                            </code>
                            <button
                                onClick={() => navigator.clipboard.writeText(callId)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                                title="Copy full Call ID"
                            >
                                📋
                            </button>
                        </div>
                    ) : (
                        <span className="text-xs text-gray-400">—</span>
                    )}
                </div>
            </div>
        </div>
    );
}
