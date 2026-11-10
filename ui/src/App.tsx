import { useEffect } from 'react'
import CsvUploadPage from './CsvUploadPage'
import JobsPage from './JobsPage'
import LoginPage from './LoginPage'
import ProductsPage from './ProductsPage'

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const isLoginPage = path === '/login'
  const hasToken = Boolean(localStorage.getItem('token'))
  const pageTitle =
    isLoginPage
      ? 'Sign in | Forma'
      : path === '/jobs'
        ? 'Jobs | Forma'
        : path === '/products'
          ? 'Products | Forma'
          : 'Upload CSV | Forma'

  useEffect(() => {
    if (!isLoginPage && !localStorage.getItem('token')) {
      window.location.replace('/login')
      return
    }

    document.title = pageTitle
  }, [isLoginPage, pageTitle])

  if (!isLoginPage && !hasToken) {
    return null
  }

  if (isLoginPage) {
    return <LoginPage />
  }

  if (path === '/jobs') {
    return <JobsPage />
  }

  if (path === '/products') {
    return <ProductsPage />
  }

  return <CsvUploadPage />
}

export default App
