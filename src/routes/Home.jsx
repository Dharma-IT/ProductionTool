const tools = [
  {
    href: '/verifier',
    eyebrow: 'Payments',
    title: 'Verifier',
    description: 'Cross-check collected Stripe payments, audit product pricing, and review payment history.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 7 10 17l-5-5" />
        <path d="M4 4h16v16H4z" />
      </svg>
    ),
  },
  {
    href: '/call-report',
    eyebrow: 'HubSpot',
    title: 'Call Report',
    description: 'Build and review team call activity reports with assignment and performance details.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h4l2 5-3 2a14 14 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 6a2 2 0 0 1 2-2Z" />
      </svg>
    ),
  },
  {
    href: '/tracking',
    eyebrow: 'Orders',
    title: 'Tracking',
    description: 'Monitor fulfillment, shipping progress, delivery timing, and orders that need attention.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="18" r="2" />
      </svg>
    ),
  },
]

function Home() {
  return (
    <section className="route-view landing-page" aria-labelledby="landing-title">
      <div className="landing-hero">
        <span className="landing-kicker">Production workspace</span>
        <h1 id="landing-title">Production Tool Dashboard</h1>
        <p>Choose a workspace below to verify payments, review call activity, or track customer orders.</p>
      </div>

      <div className="landing-tools" aria-label="Production tools">
        {tools.map((tool) => (
          <a className="landing-tool-card" href={tool.href} key={tool.href}>
            <span className="landing-tool-icon">{tool.icon}</span>
            <span className="landing-tool-eyebrow">{tool.eyebrow}</span>
            <strong>{tool.title}</strong>
            <p>{tool.description}</p>
            <span className="landing-tool-link">
              Open workspace
              <span aria-hidden="true">→</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  )
}

export default Home
