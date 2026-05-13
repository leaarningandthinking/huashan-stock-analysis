import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        // 古风/水墨色板
        ink: {
          50: "#f7f5f1",
          100: "#ebe6dd",
          200: "#d6cdbc",
          300: "#b8a98e",
          400: "#9c8867",
          500: "#7d6a4d",
          600: "#5e4f38",
          700: "#3f3424",
          800: "#241d13",
          900: "#0f0c08",
        },
        scarlet: {
          500: "#a83232",
          600: "#852828",
          700: "#5e1d1d",
        },
      },
      fontFamily: {
        serif: ["Noto Serif SC", "Source Han Serif", "serif"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
