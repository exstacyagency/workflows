/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#09090b',
        'bg-elevated': 'rgba(255,255,255,0.04)',
        panel: 'rgba(255,255,255,0.06)',
        'panel-row': 'rgba(255,255,255,0.03)',
        'panel-strong': 'rgba(255,255,255,0.10)',
        overlay: 'rgba(2,6,23,0.75)',
        line: 'rgba(255,255,255,0.10)',
        muted: '#b7b7bd',
        accent: '#e8d17a',
        'accent-2': '#9ad0ff',
        success: '#90e9a8',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 24px 80px rgba(0,0,0,0.4)',
      },
      borderRadius: {
        card: '26px',
        pill: '999px',
        inner: '20px',
      },
      backdropBlur: {
        panel: '18px',
      },
    },
  },
  plugins: [],
};
