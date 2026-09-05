/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0a0a',
          900: '#111111',
          800: '#1a1a1a',
          700: '#262626',
          600: '#3f3f46',
        },
        yes: {
          DEFAULT: '#00d26a',
          dim: '#0d2a1c',
        },
        no: {
          DEFAULT: '#ff5c5c',
          dim: '#2a1212',
        },
        gold: {
          200: '#f4e2a8',
          300: '#eccf6e',
          400: '#e4b84a',
          500: '#d4a017',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
