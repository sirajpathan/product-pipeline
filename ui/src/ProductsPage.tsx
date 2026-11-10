import { useState, type FormEvent } from 'react'
import { apiRequest } from './api'
import NavigationBar from './component/NavigationBar'
import './ProductsPage.css'

type Product = {
  id: string
  storeId: string
  sku: string
  productName: string
  price: string
  priceDate: string
  country: string
}

type ProductFields = Pick<Product, 'productName' | 'price' | 'priceDate'>
type SearchFields = Pick<Product, 'storeId' | 'sku' | 'productName'>
type Pagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value)
    }
  }
  return undefined
}

function parseProduct(value: unknown): Product | null {
  if (!isRecord(value)) return null

  
  const storeId = getString(value, 'storeId', 'store_id')
  const sku = getString(value, 'sku', 'SKU')
  const productName = getString(value, 'productName', 'product_name', 'name')
  const price = getString(value, 'price')
  const priceDate = getString(value, 'priceDate', 'price_date')
  const country = getString(value, 'country')
  const id = storeId + '-' + sku + '-' + priceDate;

  if (
    id === undefined ||
    storeId === undefined ||
    sku === undefined ||
    productName === undefined ||
    price === undefined ||
    priceDate === undefined ||
    country === undefined
  ) {
    return null
  }

  return { id, storeId, sku, productName, price, priceDate, country }
}

function parseSearchResponse(value: unknown): {
  products: Product[]
  pagination: Pagination
} {
  if (
    !isRecord(value) ||
    value.status !== 'ok' ||
    !Array.isArray(value.products) ||
    !isRecord(value.pagination)
  ) {
    throw new Error('The products API returned data in an unexpected format.')
  }

  const parsed = value.products.map(parseProduct)
  if (parsed.some((product) => product === null)) {
    throw new Error('The products API returned a product with missing fields.')
  }

  const { page, pageSize, total, totalPages } = value.pagination
  if (
    typeof page !== 'number' ||
    typeof pageSize !== 'number' ||
    typeof total !== 'number' ||
    typeof totalPages !== 'number'
  ) {
    throw new Error('The products API returned invalid pagination data.')
  }

  return {
    products: parsed.filter((product): product is Product => product !== null),
    pagination: { page, pageSize, total, totalPages },
  }
}

async function getErrorMessage(response: Response) {
  const body = await response.text()
  return body.trim() || `Request failed with status ${response.status}.`
}

function formatPriceDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function toDateInputValue(value: string) {
  const datePart = value.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function ProductsPage() {
  const [search, setSearch] = useState<SearchFields>({
    storeId: '',
    sku: '',
    productName: '',
  })
  const [products, setProducts] = useState<Product[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProductFields | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  function updateSearch(field: keyof SearchFields, value: string) {
    setSearch((current) => ({ ...current, [field]: value }))
  }

  async function searchProducts(page: number) {
    if (isSearching) return

    const query = new URLSearchParams()
    if (search.storeId.trim()) query.set('storeId', search.storeId.trim())
    if (search.sku.trim()) query.set('sku', search.sku.trim())
    if (search.productName.trim()) {
      query.set('productName', search.productName.trim())
    }
    query.set('page', String(page))

    if (!search.storeId.trim() && !search.sku.trim() && !search.productName.trim()) {
      setSearchError('Enter at least one search value.')
      setHasSearched(false)
      return
    }

    setIsSearching(true)
    setSearchError('')
    setSaveMessage('')
    setEditingId(null)
    setDraft(null)

    try {
      const response = await apiRequest(`/products/search?${query.toString()}`)
      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const result = parseSearchResponse(await response.json())
      setProducts(result.products)
      setPagination(result.pagination)
      setHasSearched(true)
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while searching products.',
      )
      setHasSearched(false)
      setPagination(null)
    } finally {
      setIsSearching(false)
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await searchProducts(1)
  }

  function changePage(page: number) {
    if (page < 1 || (pagination && page > pagination.totalPages)) return
    void searchProducts(page)
  }

  function startEditing(product: Product) {
    setEditingId(product.id)
    setDraft({
      productName: product.productName,
      price: product.price,
      priceDate: toDateInputValue(product.priceDate),
    })
    setSaveError('')
    setSaveMessage('')
  }

  function cancelEditing() {
    setEditingId(null)
    setDraft(null)
    setSaveError('')
  }

  async function saveProduct(product: Product) {
    if (!draft || isSaving) return

    const price = Number(draft.price)
    if (!draft.price.trim() || !Number.isFinite(price)) {
      setSaveError('Enter a valid price.')
      return
    }
    if (!draft.priceDate) {
      setSaveError('Enter a price date.')
      return
    }

    setIsSaving(true)
    setSaveError('')
    setSaveMessage('')

    try {
      const response = await apiRequest(
        `/products/${encodeURIComponent(product.sku)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_name: draft.productName,
            price,
            old_price_date: product.priceDate,
            price_date: draft.priceDate,
          }),
        },
      )

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      setProducts((current) =>
        current.map((currentProduct) =>
          currentProduct.id === product.id
            ? {
                ...currentProduct,
                ...draft,
                id: `${currentProduct.storeId}-${currentProduct.sku}-${draft.priceDate}`,
              }
            : currentProduct,
        ),
      )
      setEditingId(null)
      setDraft(null)
      setSaveMessage('Product saved successfully.')
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while saving the product.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="upload-page">
      <NavigationBar activePage="products" />

      <section className="products-layout" aria-labelledby="products-title">
        <div className="products-heading">
          <span className="eyebrow">DATA WORKSPACE</span>
          <h1 id="products-title">Products</h1>
          <p>Search your catalog and update product details.</p>
        </div>

        <form className="products-search-card" onSubmit={handleSearch}>
          <h2>Search products</h2>
          <div className="products-search-fields">
            {/* <label>
              Store ID
              <input
                onChange={(event) => updateSearch('storeId', event.target.value)}
                value={search.storeId}
              />
            </label> */}
            <label>
              SKU
              <input
                onChange={(event) => updateSearch('sku', event.target.value)}
                value={search.sku}
              />
            </label>
            <label>
              Product name
              <input
                onChange={(event) =>
                  updateSearch('productName', event.target.value)
                }
                value={search.productName}
              />
            </label>
            <button className="products-search-button" disabled={isSearching}>
              {isSearching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchError && (
            <p className="products-error" role="alert">
              {searchError}
            </p>
          )}
        </form>

        {(hasSearched || isSearching || saveError || saveMessage) && (
          <section className="products-results" aria-label="Product results">
            {isSearching ? (
              <p className="products-message" role="status">
                Searching products…
              </p>
            ) : searchError ? null : products.length === 0 ? (
              <p className="products-message">No products found.</p>
            ) : (
              <div className="products-table-scroll">
                <table className="products-table">
                  <thead>
                    <tr>
                      <th scope="col">Store ID</th>
                      <th scope="col">SKU</th>
                      <th scope="col">Product name</th>
                      <th scope="col">Price</th>
                      <th scope="col">Price date</th>
                      <th scope="col">Country</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => {
                      const isEditing = editingId === product.id
                      return (
                        <tr key={product.id}>
                          <td>{product.storeId}</td>
                          <td>{product.sku}</td>
                          <td>
                            {isEditing && draft ? (
                              <input
                                aria-label={`Product name for product ${product.id}`}
                                disabled={isSaving}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    productName: event.target.value,
                                  })
                                }
                                value={draft.productName}
                              />
                            ) : (
                              product.productName
                            )}
                          </td>
                          <td>
                            {isEditing && draft ? (
                              <input
                                aria-label={`Price for product ${product.sku}`}
                                disabled={isSaving}
                                onChange={(event) =>
                                  setDraft({ ...draft, price: event.target.value })
                                }
                                step="any"
                                type="number"
                                value={draft.price}
                              />
                            ) : (
                              product.price
                            )}
                          </td>
                          <td>
                            {isEditing && draft ? (
                              <input
                                aria-label={`Price date for product ${product.sku}`}
                                disabled={isSaving}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    priceDate: event.target.value,
                                  })
                                }
                                type="date"
                                value={draft.priceDate}
                              />
                            ) : (
                              formatPriceDate(product.priceDate)
                            )}
                          </td>
                          <td>{product.country}</td>
                          <td>
                            {isEditing ? (
                              <div className="products-row-actions">
                                <button
                                  className="products-save-button"
                                  disabled={isSaving}
                                  onClick={() => void saveProduct(product)}
                                  type="button"
                                >
                                  {isSaving ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  className="products-cancel-button"
                                  disabled={isSaving}
                                  onClick={cancelEditing}
                                  type="button"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                className="products-edit-button"
                                onClick={() => startEditing(product)}
                                type="button"
                              >
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {pagination && (
              <div className="products-pagination">
                <span>
                  {pagination.total} products · Page {pagination.page} of{' '}
                  {pagination.totalPages}
                </span>
                <div className="products-pagination-actions">
                  <button
                    className="products-edit-button"
                    disabled={isSearching || pagination.page <= 1}
                    onClick={() => changePage(pagination.page - 1)}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    className="products-edit-button"
                    disabled={
                      isSearching || pagination.page >= pagination.totalPages
                    }
                    onClick={() => changePage(pagination.page + 1)}
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            {saveError && (
              <p className="products-error products-feedback" role="alert">
                {saveError}
              </p>
            )}
            {saveMessage && (
              <p className="products-success products-feedback" role="status">
                {saveMessage}
              </p>
            )}
          </section>
        )}
      </section>

      <footer className="page-footer">
        <span>© 2026 Siraj</span>
        <span>Thoughtful work starts here.</span>
      </footer>
    </main>
  )
}

export default ProductsPage
