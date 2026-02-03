// Next.js API Route - reads env vars at RUNTIME (not build time)
// This allows the API_URL to be set in Container Apps environment variables

export async function GET() {
    const apiUrl = process.env.API_URL || 'http://localhost:8000';

    return Response.json({
        apiUrl,
    });
}
