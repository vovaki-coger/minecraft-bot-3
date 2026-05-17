/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/**/*.{js,ts,jsx,tsx,html}"],
  theme: {
    extend: {
      colors: {
        mc: {
          green: "#5B8C3E",
          dark: "#1A1A1A",
          panel: "#2A2A2A",
          border: "#3A3A3A",
          accent: "#7ECC49",
          red: "#C0392B",
          yellow: "#F1C40F",
          blue: "#3498DB",
          text: "#E8E8E8",
          muted: "#888888",
        },
      },
      fontFamily: {
        mono: ["'Courier New'", "monospace"],
      },
    },
  },
  plugins: [],
};
