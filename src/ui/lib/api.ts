/**
 * API URL management with runtime configuration.
 * 
 * This module fetches the API URL from a Next.js server-side endpoint
 * that reads environment variables at RUNTIME (not build time).
 * 
 * Why: Next.js NEXT_PUBLIC_* env vars are baked at build time.
 * Regular env vars (like API_URL) are only available server-side.
 * The /api/runtime-config endpoint reads API_URL at runtime and
 * returns it to the client.
 */

// Cached API URL - fetched once and reused
let cachedApiUrl: string | null = null;
let fetchPromise: Promise<string> | null = null;

/**
 * Fetch the API URL from the runtime-config endpoint.
 * This is cached after the first call.
 */
export async function fetchApiUrl(): Promise<string> {
    // Return cached value if available
    if (cachedApiUrl) {
        return cachedApiUrl;
    }

    // Return existing promise if fetch is in progress (dedup requests)
    if (fetchPromise) {
        return fetchPromise;
    }

    // Start the fetch
    fetchPromise = (async () => {
        try {
            const res = await fetch('/api/runtime-config');
            if (res.ok) {
                const data = await res.json();
                cachedApiUrl = data.apiUrl;
                return cachedApiUrl!;
            }
        } catch (err) {
            console.warn('Failed to fetch runtime config, using fallback:', err);
        }

        // Fallback: derive from hostname (for backwards compatibility)
        cachedApiUrl = getFallbackApiUrl();
        return cachedApiUrl;
    })();

    return fetchPromise;
}

/**
 * Fallback: Get API URL from hostname (used if runtime-config fails)
 */
function getFallbackApiUrl(): string {
    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        if (hostname.includes('ca-ui-')) {
            const apiHostname = hostname.replace('ca-ui-', 'ca-api-');
            return `https://${apiHostname}`;
        }
    }
    return 'http://localhost:8000';
}

/**
 * Synchronous getter - returns cached value or fallback.
 * Use fetchApiUrl() for guaranteed correct value.
 * This is for cases where async isn't possible.
 */
export function getApiUrl(): string {
    if (cachedApiUrl) {
        return cachedApiUrl;
    }
    // Fallback for sync access before async fetch completes
    return getFallbackApiUrl();
}

/**
 * Get the WebSocket URL for the API.
 * Converts http(s) to ws(s).
 */
export function getWsUrl(): string {
    const apiUrl = getApiUrl();
    return apiUrl.replace(/^http/, 'ws');
}
