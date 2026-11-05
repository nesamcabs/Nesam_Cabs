# Nesam Tours & Travels Admin Panel

React + Vite + Tailwind CSS project for Nesam Tours & Travels Enterprise Fleet & Booking Management.

## Development Server

A Vite development server runs on `$PORT` (default 8443).

- Preview URL: Access the running app through the preview panel or browser at http://localhost:8443/
- Hot reload: Changes to source files are reflected immediately

## Project Structure

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and routing structure
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and Vite build/development scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and `@` alias for `src`

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with `@tailwindcss/vite`
- Charts: Recharts
- Build tooling: Vite 8, TypeScript 5.7, `@vitejs/plugin-react`

## Styling

This project uses **Tailwind CSS v4** through `@tailwindcss/vite`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or custom tokens in `src/index.css`.
