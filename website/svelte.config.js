import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';

/** @type {import('mdsvex').MdsvexOptions} */
const mdsvexOptions = {
    extensions: ['.mdx'],
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
    extensions: ['.svelte', ...mdsvexOptions.extensions],
    preprocess: [vitePreprocess({ script: true }), mdsvex(mdsvexOptions)],
    kit: {
        adapter: adapter({
            pages: 'build',
            assets: 'build',
            precompress: false,
            strict: false,
        }),
        paths: {
            base: process.env.BASE_PATH ?? '/studio',
            relative: false,
        },
        prerender: {
            crawl: false,
            entries: ['/fr/app'],
            handleUnseenRoutes: 'ignore',
        },
    },
};

export default config;
