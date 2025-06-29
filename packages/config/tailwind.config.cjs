/**
 * Shared Tailwind Config for the entire shamgateway monorepo.
 * – Arabisch‑first Farbschema (Light & Dark via CSS Vars)
 * – Spezielle Breakpoints (xs 320 / sm 360 / md 640 / lg 1024 / xl 1280 / 2xl 1536)
 * – Einheitliche Border‑Radius‑Skala
 * – Fonts »Cairo« + »Inter«
 * – Container‑Padding abgestuft pro Breakpoint
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./apps/**/*.{js,ts,jsx,tsx,mdx}",
    "./packages/ui/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class", // <body class="dark"> schaltet Dark‑Mode ein
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1rem",
        md: "2rem",
        lg: "3rem",
        xl: "4rem",
        "2xl": "5rem",
      },
    },
    extend: {
      // Fonts (arabisch‑freundlich)
      fontFamily: {
        sans: ["Cairo", "Inter", "ui-sans-serif", "system-ui"],
        heading: ["Cairo", "Inter", "ui-sans-serif", "system-ui"],
      },
      // Farbpalette über CSS‑Custom‑Properties – Light & Dark in globals.css
      colors: {
        primary: "hsl(var(--color-primary) / <alpha-value>)",
        secondary: "hsl(var(--color-secondary) / <alpha-value>)",
        accent: "hsl(var(--color-accent) / <alpha-value>)",
        neutral: "hsl(var(--color-neutral) / <alpha-value>)",
        base: "hsl(var(--color-base) / <alpha-value>)",
        surface: "hsl(var(--color-surface) / <alpha-value>)",
        background: "hsl(var(--color-background) / <alpha-value>)",
      },
      // Einheitliche Rounded‑Skala (nutze z. B. rounded-lg)
      borderRadius: {
        none: "0px",
        sm: "0.25rem",
        md: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
        full: "9999px",
      },
      // Custom Breakpoints inkl. xs & sm (360 = typische Mobile‑Breite)
      screens: {
        xs: "320px",
        sm: "360px",
        md: "640px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1536px",
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/typography"),
    require("@tailwindcss/line-clamp"),
  ],
};
