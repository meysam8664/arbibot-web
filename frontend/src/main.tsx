import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerServiceWorker, watchInstallPrompt } from './pwa'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container missing from index.html')
}

// Keep the ?tab=… shortcut links in manifest.webmanifest working.
const initialTab = new URLSearchParams(window.location.search).get('tab')

createRoot(container).render(
  <StrictMode>
    <App initialTab={initialTab === 'triangles' || initialTab === 'markets' ? initialTab : 'cross'} />
  </StrictMode>,
)

watchInstallPrompt()
registerServiceWorker()
