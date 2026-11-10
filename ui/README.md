# Forma CSV Upload

The app accepts CSV files and sends them to the local upload API.

The upload page is at `/`. The sign-in page is at `/login`; submitting its
required email and password fields calls the login API and redirects to the
upload page after a successful response. The jobs page is at `/jobs` and shows
the status, ID, file name, and creation time for jobs from the API.
The products page is at `/products`, where products can be searched by store
ID, SKU, or product name and edited.
Nginx is configured to serve the React app for direct requests to application
routes.

## Run locally

```sh
npm install
npm run dev
```

The API is expected at `http://localhost:3000`. Its CORS policy must allow
requests from the app's origin. If the frontend runs on a different origin,
the API must allow the `Authorization` header.

## Authentication API contract

The app sends credentials as JSON:

   ```http
   POST http://localhost:3000/auth/login
   Content-Type: application/json

   { "email": "<email>", "password": "<password>" }
   ```

On success, the API must return the JWT in a JSON `token` field:

   ```http
   HTTP/1.1 200 OK
   Content-Type: application/json

   { "token": "<jwt>" }
   ```

The app stores the token in `localStorage` under the `token` key. API requests
made through the shared request helper send it in the
`Authorization: Bearer <jwt>` header. Local storage is accessible to
JavaScript, so an XSS vulnerability could expose the token; an HttpOnly cookie
managed by the backend is preferable for production.
When an authenticated API request returns `401 Unauthorized`, the shared
helper removes the stored token and redirects the user to `/login`. A `401`
from the login request itself is left on the login page so the form can show
the API error.

## Upload API contract

The app sends the selected CSV as multipart form data:

   ```http
   POST http://localhost:3000/file/upload
   Content-Type: multipart/form-data
   ```

The multipart form contains the selected file in the `file` field. The browser
sets the multipart content type and boundary automatically.

## Jobs API contract

The app requests jobs with `GET http://localhost:3000/jobs` and includes the
JWT in the `Authorization: Bearer <jwt>` header. The API returns an object
with `status: "ok"` and a `jobs` array. Each job includes `id`, `file_name`,
`status`, and `created_at`.

## Products API contract

The products page sends a `GET /products/search` request with one or more of
`storeId`, `sku`, and `productName`, plus a `page` query parameter. The API
returns an object with `status: "ok"`, a `products` array, and pagination
metadata (`page`, `pageSize`, `total`, and `totalPages`). Each product includes
`id`, `store_id`, `sku`, `product_name`, `price`, `price_date`, and `country`.
Saving edits sends a `PATCH /products/{sku}` request. The JSON body contains
`product_name`, `price`, the existing `old_price_date`, and the updated
`price_date`.
