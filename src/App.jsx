import './App.css'
import Home from './routes/Home'
import HomeDashboard from './routes/HomeDashboard'
import HubSpotCallReport from './routes/HubSpotCallReport'
import Orders from './routes/Orders'
import Tracking from './routes/Tracking'

const routes = {
  '/': Home,
  '/home': Home,
  '/orders': Orders,
  '/verifier': HomeDashboard,
  '/call-report': HubSpotCallReport,
  '/tracking': Tracking,
}

function App() {
  const currentPath = window.location.pathname
  const ActiveRoute = routes[currentPath] ?? Home
  const tabs = [
    { href: '/home', label: 'Home' },
    { href: '/orders', label: 'Orders' },
    { href: '/verifier', label: 'Verifier' },
    { href: '/call-report', label: 'Call Report' },
    { href: '/tracking', label: 'Tracking' },
  ]

  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Primary">
        <a className="brand" href="/" aria-label="Production Tool Home">
          <img src="/logo1.png" alt="" />
          <span>Production Tool</span>
        </a>
        <nav className="nav-tabs" aria-label="Dashboard">
          {tabs.map((tab) => (
            <a
              className={`nav-tab${currentPath === tab.href || (currentPath === '/' && tab.href === '/home') ? ' active' : ''}`}
              href={tab.href}
              key={tab.href}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </header>
      <ActiveRoute />
    </main>
  )
}

export default App
