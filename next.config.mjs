import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Baked in at build time. Every Vercel deploy is a new build, so this is
    // the deploy time; shown at the bottom of /auth (components/deploy-info.tsx).
    env: {
        BUILD_TIME: new Date().toISOString(),
        BUILD_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7),
    },
    async headers() {
        const devCorsHeaders = [
            { key: 'Access-Control-Allow-Origin', value: 'http://localhost:8887' },
            { key: 'Access-Control-Allow-Credentials', value: 'true' },
            { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
            { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ];
        if (process.env.NODE_ENV === 'production') return [];
        return [{ source: '/api/auth/:path*', headers: devCorsHeaders }];
    },
    // Where chat is deployed on its own (Vercel), there's no localsite folder,
    // so /localsite/ is proxied from model.earth. The bare /localsite rule runs
    // before the routes, since app/[wikiSlug] would otherwise claim it; deeper
    // paths fall back once no page or file matches. Locally, chat/server.mjs
    // serves the webroot's localsite before Next.js sees the request.
    async rewrites() {
        return {
            beforeFiles: [
                { source: '/localsite', destination: 'https://model.earth/localsite/' },
            ],
            fallback: [
                { source: '/localsite/:path*', destination: 'https://model.earth/localsite/:path*' },
            ],
        };
    },
    // ⚠️ FIXME: PPR requires Next.js canary. Re-enable after upgrading from 15.5.9 stable
    // experimental: {
    //   ppr: true,
    // },
    serverExternalPackages: ['drizzle-orm', 'postgres'],
    turbopack: { root: __dirname },
    images: {
        remotePatterns: [
            {
                hostname: "avatar.vercel.sh",
            },
        ],
    },
};

export default nextConfig;
