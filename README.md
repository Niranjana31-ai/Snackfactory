# SnackFactory ERP — Order-to-Audit Management System

Production-ready manufacturing ERP web application for snack food operations, built with **React 19**, **TypeScript**, **Tailwind CSS v4**, **Vite**, **Firebase Authentication**, and **Cloud Firestore**.

## Implemented Modules (16 / 16)

- **Authentication & RBAC**: Username-and-password login mapped internally to Firebase Authentication, one-time Owner initialization, show/hide password, secure sign out, and 5 enforced roles (`Owner`, `Admin`, `Salesman`, `Production Supervisor`, `Accountant/Auditor`).
- **Operations Dashboard**: Role-scoped live metrics (total sales, total purchases, raw material stock, finished goods stock, pending orders, outstanding payments, monthly revenue & P&L summary, production yield variance, low-stock alerts).
- **Master Data**: `Products` (SKUs, HSN codes, GST slabs), `Customers` (GSTIN, state codes), `Suppliers`, `Raw Materials` (opening stock & reorder levels), and `Bill of Materials (BOM)` (versioned recipes & cost estimates).
- **Procurement & Production**: `Purchases` (POs, GST totals, stock receipt posting), `Production` (BOM material availability checks, material issuance, good/damaged packet output, yield & consumption variance), and `Inventory` (raw material, WIP, finished goods, damaged stock balances, adjustments, and immutable ledger).
- **Sales & Fulfillment**: `Sales Orders` (Draft/Pending/Approved/Rejected/Dispatched workflow), `Dispatch` (stock checks, full/partial dispatch, PDF dispatch notes), `Invoices` (Tamil Nadu intra-state CGST+SGST & inter-state IGST tax invoices, PDF export), and `Payments` (Cash/UPI/Bank Transfer/Cheque, partial payments, duplicate protection, PDF receipts).
- **Finance & Governance**: `Costing` (Weighted Average Cost valuation, packaging, labour, gas/electricity & overhead costing, per-packet profit margin), `Reports` (Monthly Audit Report, 9-rule automated anomaly detection, PDF & multi-sheet Excel exports), and `User Management` (employee account provisioning & role governance).

## Firebase Configuration

The application connects to the configured Firebase project in `firebase-applet-config.json`:

- **Project ID**: `gen-lang-client-0884531978`
- **Firestore Database ID**: `ai-studio-02a09853-dcfb-4d4e-b79a-2ddb46962a02`

### Required Firebase Console Setup (Free Tier)

1. Open **Firebase Console** -> **Authentication** -> **Sign-in method**.
2. Ensure **Email/Password** provider is **Enabled** (Email link / passwordless sign-in is not required).
3. Under **Authentication** -> **Settings** -> **Authorized domains**, include your deployed hosting domain (for example `*.web.app`, `*.firebaseapp.com`, or your custom free hosting domain).
4. Cloud Firestore security rules are defined in `firestore.rules` and schema contracts are documented in `firebase-blueprint.json`.

## Local Development & Verification

```bash
# Install dependencies
npm install

# Run TypeScript type check
npm run lint

# Lint Firestore security rules
npx eslint firestore.rules

# Start local development server on port 3000
npm run dev

# Build production static bundle (outputs to dist/)
npm run build
```

## Eligible Free Deployment Options (No Billing Required)

Because SnackFactory ERP compiles to a static client SPA (`dist/`) backed directly by Firebase Authentication and Cloud Firestore, it can be deployed on free hosting plans without enabling billing or adding paid backend services:

1. **Firebase Hosting (Spark Plan — Free)**:
   - Configuration is ready in `firebase.json`.
   - Build and deploy manually when ready:
     ```bash
     npm run build
     npx firebase-tools login
     npx firebase-tools deploy --only hosting,firestore:rules --project gen-lang-client-0884531978
     ```
2. **Vercel (Hobby Plan — Free)** / **Netlify (Starter Plan — Free)** / **Cloudflare Pages (Free)**:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **SPA Routing**: Add fallback rewrite `/* -> /index.html` (and add the deployed domain to Firebase Auth Authorized Domains).

## GitHub Backup & ZIP Export

### Push Complete Source Code to GitHub

```bash
git init
git add .
git commit -m "Initial commit: SnackFactory ERP Stage 8 release"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`.gitignore` automatically excludes `node_modules/`, `dist/`, `.firebase/`, `.env*` (keeping `.env.example`), and archive files.

### Create a Clean Source ZIP Backup

To export a portable ZIP archive without `node_modules/` or `dist/`:

```bash
# Linux / macOS
zip -r snackfactory-erp-source.zip . -x "node_modules/*" "dist/*" ".git/*" ".firebase/*" "*.zip"

# Or using tar/gzip if zip is unavailable
tar --exclude=node_modules --exclude=dist --exclude=.git --exclude=.firebase -czf snackfactory-erp-source.tar.gz .
```
