import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Poppins is the admin panel's one font (body and headings). Tamil text falls back to Nesam Tamil (index.css).
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/poppins/800.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
