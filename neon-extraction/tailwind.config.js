/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        neon: {
          cyan: "#00F0FF",
          magenta: "#FF2D78",
          green: "#00FF88",
          gold: "#FFB800",
        },
        deep: {
          DEFAULT: "#0A0A0F",
          50: "#0E0E16",
          100: "#12121C",
          200: "#161622",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['"Outfit"', 'sans-serif'],
      },
      keyframes: {
        "glitch-1": {
          "0%, 92%": { transform: "translate(0)" },
          "93%": { transform: "translate(-3px, 1px)" },
          "95%": { transform: "translate(2px, -1px)" },
          "97%": { transform: "translate(-1px, 2px)" },
          "100%": { transform: "translate(0)" },
        },
        "glitch-2": {
          "0%, 90%": { transform: "translate(0)" },
          "91%": { transform: "translate(3px, -1px)" },
          "94%": { transform: "translate(-2px, 1px)" },
          "96%": { transform: "translate(1px, -2px)" },
          "100%": { transform: "translate(0)" },
        },
        "scan-sweep": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "scan-bar": {
          "0%": { left: "0" },
          "50%": { left: "100%" },
          "100%": { left: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        "float-up": {
          "0%": { opacity: "0", transform: "translateY(100vh) scale(0)" },
          "10%": { opacity: "0.6" },
          "90%": { opacity: "0.6" },
          "100%": { opacity: "0", transform: "translateY(-10vh) scale(1)" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "card-reveal": {
          from: { opacity: "0", transform: "translateY(20px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "shimmer": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "glitch-1": "glitch-1 4s infinite linear alternate-reverse",
        "glitch-2": "glitch-2 4s infinite linear alternate-reverse",
        "scan-sweep": "scan-sweep 3s ease-in-out infinite",
        "scan-bar": "scan-bar 1.5s ease-in-out infinite",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "float-up": "float-up 8s infinite",
        "spin-slow": "spin-slow 0.8s linear infinite",
        "fade-in-up": "fade-in-up 0.6s ease-out both",
        "card-reveal": "card-reveal 0.6s ease-out both",
        "shimmer": "shimmer 3s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
