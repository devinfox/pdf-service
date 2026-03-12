# PDF Service

A microservice for generating filled and flattened Investment Direction PDFs using pdftk.

## Why This Exists

pdf-lib (JavaScript) has a known bug where `form.flatten()` removes radio buttons and checkboxes from PDFs. pdftk handles this correctly but requires a Linux environment with Java.

This service runs on Railway (or any Docker host) where pdftk can be installed.

## Endpoints

### Health Check
```
GET /health
```
Returns `{ status: 'ok', service: 'pdf-service' }`

### Generate Investment Direction PDF
```
POST /api/generate-investment-direction
Content-Type: application/json

{
  "formData": {
    "accountholderName": "John Doe",
    "accountNumber": "123456",
    "ssnEin": "1234",
    "email": "john@example.com",
    "investmentType": "purchase",
    "purchaseAmount": "50000",
    "dealerName": "Citadel Gold",
    "dealerRepName": "Jane Smith",
    "dealerRepEmail": "jane@citadel.com",
    "valueMetalsOutgoing": "",
    "valueMetalsIncoming": "",
    "additionalFunds": "",
    "depository": "texas",
    "storageMethod": "segregated",
    "processingFee": "deduct",
    "signatureDate": "03/11/2026"
  }
}
```

Returns: PDF file (application/pdf)

## Local Development

```bash
# Install dependencies
npm install

# Run in development mode (requires pdftk installed locally)
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Deploy to Railway

1. Create a new project on Railway
2. Connect this repository
3. Railway will automatically detect the Dockerfile and build
4. Set the PORT environment variable if needed (default: 3000)

## Environment Variables

- `PORT` - Server port (default: 3000)

## Calling from Vercel/Next.js

```typescript
const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL || 'https://your-railway-app.railway.app';

const response = await fetch(`${PDF_SERVICE_URL}/api/generate-investment-direction`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ formData }),
});

if (!response.ok) {
  throw new Error('Failed to generate PDF');
}

const pdfBuffer = await response.arrayBuffer();
```
