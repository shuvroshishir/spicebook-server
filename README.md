# SpiceBook — Recipe Sharing & Culinary Inspiration Platform (Server API)

This is the backend API service for **SpiceBook**, a recipe-sharing and subscription-based web application. Built using **Node.js**, **Express**, and **MongoDB**, it handles secure user verification, database management, premium memberships, and Stripe payment processing.

---

## 🌟 Key Features

### 🔒 Security & Middleware
* **JWKS Auth Verification**: Validates authentication tokens dynamically using JSON Web Key Sets (JWKS) provided by the Next.js client-auth framework.
* **Account Status Guard**: An active database interceptor in the middleware blocks restricted/suspended users from making write requests.
* **Role Verification**: Validates user attributes (Admin vs. Standard) to restrict access to management endpoints.

### 🍽️ Recipe & Social Features
* **Server-side Pagination & Filters**: Performs fast, index-optimized database queries with `.skip()`, `.limit()`, and category arrays filtering.
* **Recipe Limit Validation**: Dynamically queries a user's total active recipes to enforce the 2-recipe restriction on standard accounts.
* **Likes & Bookmarks**: Manages user relationships for liked recipes and bookmarked items under user-specific document scopes.
* **Report Handling**: Receives, registers, and tracks user reports on recipes for administrative review.

### 💳 Payment Integration & Transactions
* **Stripe Session Creation**: Handles checkout requests for both Premium Member upgrades ($9.99) and individual premium recipe purchases.
* **Purchase Verification**: Validates Stripe checkout session status and inserts secure transaction/purchase logs in MongoDB upon success.
* **Paginated Transactions Audit**: Delivers historical payment listings, user emails, amounts, and dates for the admin panel.

---

## 💻 Tech Stack

* **Runtime Environment**: Node.js
* **Web Framework**: Express
* **Database Driver**: MongoDB Native Driver (`mongodb`)
* **JWT Cryptography**: Jose (`jose-cjs`)
* **Payment Processing**: Stripe SDK (`stripe`)
* **Cross-Origin Requests**: CORS
* **Configuration**: Dotenv

---

## ⚙️ Installation & Setup

1. **Navigate to the Server Directory**:
   ```bash
   cd spicebook-server
   ```

2. **Install Server Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root of the server folder and supply the following variables:
   ```env
   PORT=5000
   MONGO_DB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/?retryWrites=true&w=majority
   MONGO_DB_NAME=spicebook
   CLIENT_URL=http://localhost:3000
   STRIPE_SECRET_KEY=sk_test_your_secret_stripe_key
   ```

4. **Start the Development Server**:
   Using `nodemon` (auto-reloading):
   ```bash
   npm run dev
   ```
   Or using node standard launch:
   ```bash
   node index.js
   ```

---

## ☁️ Deployment Configuration
This server is pre-configured with a `vercel.json` deployment manifest to support serverless deployment on Vercel:
```json
{
  "version": 2,
  "builds": [
    { "src": "index.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "index.js" }
  ]
}
```
 Ensure that CORS configuration and database connection pooling are properly managed inside `index.js` for serverless environments.
