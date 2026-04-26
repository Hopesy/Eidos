import type { NextConfig } from 'next'
import packageJson from './package.json'

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || '0.0.0'

const nextConfig: NextConfig = {
    env: {
        NEXT_PUBLIC_APP_VERSION: appVersion,
    },
    output: 'standalone',
    outputFileTracingExcludes: {
        '/*': [
            './.git/**/*',
            './.github/**/*',
            './.playwright-mcp/**/*',
            './assets/**/*',
            './data/**/*',
            './electron/**/*',
            './logs/**/*',
            './next.config.ts',
            './scripts/**/*',
            './src/**/*',
            './.gitignore',
            './.npmrc',
            './components.json',
            './eslint.config.mjs',
            './LICENSE',
            './postcss.config.mjs',
            './README.md',
            './tsconfig.json',
            './tsconfig.tsbuildinfo',
        ],
    },
    images: {
        unoptimized: true,
    },
}

export default nextConfig
