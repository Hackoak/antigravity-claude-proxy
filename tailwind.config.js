/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./public/**/*.{html,js}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        primary: '#da7756',
        white: '#DEDEDE',
        heading: '#DEDEDE',
        description: '#9E9E9E',
        // Vercel-inspired Dark Theme
        space: {
          950: '#000000', // Pure Black
          900: '#111111', // Almost Black
          850: '#1a1a1a', // Dark Gray
          800: '#333333', // Mid Gray (borders/separators)
          border: '#333333'
        },
        // Claude Orange Accents
        claude: {
          orange: '#da7756', // Primary Brand
          soft: '#e89478',   // Lighter/Hover
          deep: '#c25e3e'    // Darker/Active
        },
        // Semantic Colors
        neon: {
          purple: '#a855f7',
          cyan: '#06b6d4',
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444'
        }
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('daisyui')
  ],
  daisyui: {
    themes: [{
      antigravity: {
        "primary": "#da7756",    // Claude Orange
        "secondary": "#333333",  // Vercel Gray
        "accent": "#da7756",     // Claude Orange (was Purple)
        "neutral": "#111111",    // Space 900
        "base-100": "#000000",   // Pure Black
        "info": "#06b6d4",       // Neon Cyan
        "success": "#22c55e",    // Neon Green
        "warning": "#eab308",    // Neon Yellow
        "error": "#ef4444",      // Neon Red
      }
    }],
    logs: false
  }
}
