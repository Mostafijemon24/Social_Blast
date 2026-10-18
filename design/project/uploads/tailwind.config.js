/**
 * Tailwind theme mapping for the AI Social Media Management SaaS.
 *
 * Every colour resolves to a CSS variable from tokens.css, so `bg-surface`
 * and `text-muted` follow the active theme (light / dark) automatically with
 * no `dark:` variants needed on components. Keep tokens.css loaded globally.
 *
 * Dark mode is driven by the data-theme attribute and prefers-color-scheme,
 * handled entirely in tokens.css — so darkMode here is 'class' only as an
 * escape hatch for the rare component that must branch on theme.
 */
const withOpacity = (v) => `rgb(from var(${v}) r g b / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx,js,jsx,html}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',

      bg: withOpacity('--color-bg'),
      surface: withOpacity('--color-surface'),
      'surface-2': withOpacity('--color-surface-2'),
      border: withOpacity('--color-border'),
      'border-input': withOpacity('--color-border-input'),

      text: withOpacity('--color-text'),
      muted: withOpacity('--color-text-muted'),
      subtle: withOpacity('--color-text-subtle'),

      accent: {
        DEFAULT: withOpacity('--color-accent'),
        hover: withOpacity('--color-accent-hover'),
        subtle: withOpacity('--color-accent-subtle'),
        text: withOpacity('--color-accent-text'),
      },
      'on-accent': withOpacity('--color-on-accent'),

      danger: {
        DEFAULT: withOpacity('--color-danger'),
        text: withOpacity('--color-danger-text'),
        subtle: withOpacity('--color-danger-subtle'),
      },
      'on-danger': withOpacity('--color-on-danger'),
      success: {
        DEFAULT: withOpacity('--color-success'),
        text: withOpacity('--color-success-text'),
        subtle: withOpacity('--color-success-subtle'),
      },
      warning: {
        DEFAULT: withOpacity('--color-warning'),
        text: withOpacity('--color-warning-text'),
        subtle: withOpacity('--color-warning-subtle'),
      },
      focus: withOpacity('--color-focus'),

      // Post-status roles — pair text with its matching bg.
      status: {
        'draft-text': withOpacity('--color-status-draft-text'),
        'draft-bg': withOpacity('--color-status-draft-bg'),
        'scheduled-text': withOpacity('--color-status-scheduled-text'),
        'scheduled-bg': withOpacity('--color-status-scheduled-bg'),
        'published-text': withOpacity('--color-status-published-text'),
        'published-bg': withOpacity('--color-status-published-bg'),
        'failed-text': withOpacity('--color-status-failed-text'),
        'failed-bg': withOpacity('--color-status-failed-bg'),
        'pending-text': withOpacity('--color-status-pending-text'),
        'pending-bg': withOpacity('--color-status-pending-bg'),
      },
    },

    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },

    fontSize: {
      xs: ['var(--text-xs)', { lineHeight: 'var(--leading-xs)', fontWeight: 'var(--weight-xs)' }],
      sm: ['var(--text-sm)', { lineHeight: 'var(--leading-sm)' }],
      base: ['var(--text-base)', { lineHeight: 'var(--leading-base)' }],
      lg: ['var(--text-lg)', { lineHeight: 'var(--leading-lg)', fontWeight: 'var(--weight-lg)' }],
      xl: ['var(--text-xl)', { lineHeight: 'var(--leading-xl)', fontWeight: 'var(--weight-xl)' }],
      '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-2xl)', fontWeight: 'var(--weight-2xl)' }],
      display: ['var(--text-display)', { lineHeight: 'var(--leading-display)', fontWeight: 'var(--weight-display)' }],
    },

    extend: {
      spacing: {
        0: 'var(--space-0)', 0.5: 'var(--space-1)', 1: 'var(--space-2)', 2: 'var(--space-3)',
        3: 'var(--space-4)', 4: 'var(--space-5)', 5: 'var(--space-6)', 6: 'var(--space-7)',
        8: 'var(--space-8)', 10: 'var(--space-9)', 12: 'var(--space-10)', 16: 'var(--space-11)',
        sidebar: 'var(--sidebar)', 'sidebar-collapsed': 'var(--sidebar-collapsed)', header: 'var(--header)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)', pill: 'var(--radius-pill)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)', card: 'var(--shadow-card)', pop: 'var(--shadow-pop)',
      },
      transitionTimingFunction: { DEFAULT: 'var(--ease)' },
      transitionDuration: { fast: 'var(--motion-fast)', DEFAULT: 'var(--motion-base)', slow: 'var(--motion-slow)' },
      maxWidth: { content: 'var(--content-max)' },
      screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' },
      ringColor: { focus: withOpacity('--color-focus') },
      ringWidth: { DEFAULT: '2px' },
      ringOffsetWidth: { DEFAULT: '2px' },
    },
  },
  plugins: [],
};
