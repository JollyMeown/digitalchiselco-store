/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        // earthy / artisanal brand palette (clone of current site)
        cream: '#FAEEDA',
        bronze: { 600: '#854F0B', 700: '#633806', 800: '#412402' },
        ink: { 700: '#3a2a1a', 800: '#2b1d10' },
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Instrument Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
