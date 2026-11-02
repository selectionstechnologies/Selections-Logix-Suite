/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#FACC15', hover: '#EAB308', light: '#FEF9C3', dark: '#854D0E' },
        danger: { DEFAULT: '#DC2626', hover: '#B91C1C', light: '#FEE2E2', dark: '#991B1B' },
        surface: '#FAFAFA',
        line: '#E5E7EB',
        ink: { DEFAULT: '#111827', muted: '#6B7280' },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Naskh Arabic', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,24,39,.04), 0 2px 8px rgba(17,24,39,.05)',
        pop: '0 8px 30px rgba(17,24,39,.14)',
      },
    },
  },
  plugins: [],
};
