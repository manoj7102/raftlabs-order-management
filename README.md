# RaftLabs Order Management

A small food delivery order app for the RaftLabs full-stack assessment. The repository contains a React frontend and an Express REST API. Orders are stored in memory, so restarting the API clears them.

The `frontend/` folder holds the React/Vite app and the `backend/` folder holds the Express API.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Open the URL printed by Vite. The API runs on `http://localhost:4000`; Vite proxies `/api` requests to it.

For a separate hosted frontend, set `VITE_API_BASE_URL` to the public HTTPS origin of the deployed API (see `frontend/.env.example`). The backend uses the hosting provider's `PORT` environment variable.

## Checks

```bash
npm test
npm run build
```

## Scope

- Browse a food menu with names, descriptions, prices and images.
- Adjust cart quantities and place an order with name, address and a 10-digit phone number.
- Track the order through Received, Preparing and Out for Delivery. The browser polls for status changes; the API simulates progress.
- Validate input on the API and cover key API/UI flows with tests.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/menu` | List menu items |
| POST | `/api/orders` | Place an order |
| GET | `/api/orders/:id` | Retrieve an order and its status |
| PATCH | `/api/orders/:id/status` | Advance an order status |

Example order request:

```json
{
  "customer": {
    "name": "Aarav Sharma",
    "address": "123 Sample Street, Jaipur",
    "phone": "9876543210"
  },
  "items": [
    { "menuItemId": "margherita-pizza", "quantity": 2 }
  ]
}
```

## Design notes

The API owns prices and item details; clients submit item IDs and quantities only. This prevents a browser from choosing its own total. In-memory storage keeps the exercise easy to run and is permitted by the brief. A production version would use a database, authentication for status updates, and a background job or queue for delivery progress.

## Assessment handoff

Before submitting, create a public GitHub repository, deploy the web app and API, and record the required 12–15 minute Loom walkthrough. Show the app, tests, architecture, design choices, challenges, and explain how AI assistance was used. Those external deliverables are separate from this local setup.
