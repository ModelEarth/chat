import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// localsite is part of the site when a Vercel build copied it into public/
// (CloudRoot's vercel.json), or locally when chat sits in a webroot
// (../localsite). On Vercel only the copy counts, so if it didn't happen the
// site still gets localsite, proxied from model.earth.
const localsiteDirs = process.env.VERCEL ? ['public/localsite'] : ['public/localsite', '../localsite']
const hasLocalsite = localsiteDirs
    .some((dir) => existsSync(join(__dirname, dir, 'js', 'localsite.js')))

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
    // /localsite/ on Vercel. With localsite copied into public/, Next.js
    // serves its files but not a folder's index.html, so folder paths are
    // rewritten to it. Without localsite, it's proxied from model.earth.
    // The bare /localsite rule runs before the routes, since app/[wikiSlug]
    // would otherwise claim it; deeper paths fall back once no page or file
    // matches. Locally, chat/server.mjs serves the webroot's localsite before
    // Next.js sees the request.
    async rewrites() {
        if (hasLocalsite) {
            return {
                beforeFiles: [
                    { source: '/localsite', destination: '/localsite/index.html' },
                ],
                fallback: [
                    { source: '/localsite/:path+', destination: '/localsite/:path+/index.html' },
                ],
            };
        }
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
