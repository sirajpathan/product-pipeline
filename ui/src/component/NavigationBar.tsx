type NavigationPage = 'upload' | 'jobs' | 'products'

type NavigationBarProps = {
  activePage: NavigationPage
}

const links: { href: string; label: string; page: NavigationPage }[] = [
  { href: '/', label: 'Upload CSV', page: 'upload' },
  { href: '/jobs', label: 'Jobs', page: 'jobs' },
  { href: '/products', label: 'Products', page: 'products' },
]

function NavigationBar({ activePage }: NavigationBarProps) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Siraj home">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>Siraj</span>
      </a>
      <nav className="topbar-actions" aria-label="Main navigation">
        <span className="topbar-label">DATA WORKSPACE</span>
        {links.map(({ href, label, page }) => (
          <a
            aria-current={activePage === page ? 'page' : undefined}
            className="topbar-login"
            href={href}
            key={page}
          >
            {label}
          </a>
        ))}
        <a className="topbar-login" href="/login">
          Sign in
        </a>
      </nav>
    </header>
  )
}

export default NavigationBar
