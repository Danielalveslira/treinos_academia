import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pwaPlugin } from './scripts/pwa-plugin.js'
import { buildIdentityPlugin } from './scripts/release/build-identity-plugin.mjs'
import { publicPreviewPlugin } from './scripts/public-preview-plugin.js'

// Icons actually used by the app shell and shared public/account navigation.
// Keep route-only icons out of the eagerly loaded React/Primer runtime.
const bootIcons = new Set('AlertFillIcon AlertIcon ArrowRightIcon BriefcaseIcon CheckCircleFillIcon CheckIcon ChecklistIcon ChevronDownIcon ChevronRightIcon ChevronUpIcon CreditCardIcon DeviceMobileIcon DownloadIcon GraphIcon HistoryIcon HomeIcon ImageIcon InfoIcon LocationIcon MegaphoneIcon MoonIcon OrganizationIcon PackageIcon PeopleIcon PersonAddIcon PersonIcon PlayIcon PlusIcon QuestionIcon RocketIcon SearchIcon ShieldLockIcon SignInIcon SignOutIcon StopIcon SunIcon ThreeBarsIcon TrashIcon TriangleDownIcon XIcon'.split(' '))

export default defineConfig({
  plugins: [react(), pwaPlugin(), publicPreviewPlugin(), buildIdentityPlugin()],
  server: {
    fs: {
      // Preserve Vite defaults and keep audit backups/credentials out of dev HTTP.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.finance-local/**'],
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        publicHomeRedirect: 'src/publicHomeRedirect.js',
        publicHeaderAuth: 'src/publicHeaderAuth.js',
        publicTurbo: 'src/publicTurbo.js',
        publicHeaderMenu: 'src/PublicHeaderMenu.jsx',
      },
      output: {
        onlyExplicitManualChunks: true,
        entryFileNames: (chunk) =>
          chunk.name === 'publicHomeRedirect'
            ? 'assets/public-home-redirect.js'
            : chunk.name === 'publicHeaderAuth'
              ? 'assets/public-header-auth.js'
              : 'assets/[name]-[hash].js',
        manualChunks(id, { getModuleInfo }) {
          // Assign only live modules: grouping unused Primer modules also pulls their CSS.
          if (!getModuleInfo(id)?.isIncluded) return
          if (
            id.endsWith('/src/components/PublicNavigationMenu.jsx') ||
            id.endsWith('/src/styles/public-navigation-menu.css') ||
            id.endsWith('/scripts/public-navigation.mjs')
          )
            return 'primer'
          if (id.includes('/@primer/octicons-react/')) {
            const file = id.split('/').at(-1)
            if (file.startsWith('renderOcticon-') || bootIcons.has(file.replace(/\.mjs$/, ''))) return 'primer'
          }
          if (id.includes('/node_modules/recharts/')) return 'charts'
          if (/\/node_modules\/(react-markdown|remark-gfm|rehype-sanitize)\//.test(id))
            return 'markdown'
          // These components are used only by lazy routes, not by the application shell.
          if (
            /\/@primer\/react\/lib-esm\/(Blankslate|Label|ProgressBar|SegmentedControl|UnderlineNav)\//.test(
              id
            )
          )
            return
          if (/\/@primer\/react\/lib-esm\/(index|experimental\/index)\.js$/.test(id)) return
          if (
            /\/node_modules\/(react|react-dom|react-router|react-router-dom|react-is|react-compiler-runtime|scheduler|styled-components|styled-system|hoist-non-react-statics|lodash.isempty|object-assign|deepmerge|focus-visible|clsx|tslib|@emotion\/[^/]+|@styled-system\/[^/]+|@primer\/react|@primer\/primitives|@oddbird\/popover-polyfill)\//.test(
              id
            ) ||
            id.includes('vite/preload-helper') || id.includes('commonjsHelpers')
          )
            return 'primer'
        },
      },
    },
    // Keep the previous Vite 5 browser contract while upgrading the build tools.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
  },
})
