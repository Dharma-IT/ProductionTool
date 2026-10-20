# Production Tool

Vite React frontend with a small Node API that builds the HubSpot call report.

## Local Development

Create `.env.local` from `.env.example`, then set your real HubSpot private app token.

Run the API and frontend in separate terminals:

```sh
npm run api
npm run dev
```

## Deployment

Deploy the frontend to Vercel and the backend API to Render.

### Backend: Render Web Service

Use these settings:

```txt
Build command: npm ci
Start command: npm run api
Health check path: /health
```

Set these Render environment variables:

```txt
HUBSPOT_PRIVATE_APP_TOKEN=pat-na1-your-real-token
HUBSPOT_API_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
HUBSPOT_REPORT_TIMEZONE=America/New_York
HUBSPOT_REPORT_DAY=today
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
AIRCALL_API_ID=your-aircall-api-id
AIRCALL_API_TOKEN=your-aircall-api-token
AIRCALL_WEBHOOK_TOKEN=your-aircall-webhook-token
AIRCALL_ANALYTICS_ACCESS_TOKEN=your-aircall-analytics-oauth-access-token
SUPABASE_REST_URL=https://your-project.supabase.co/rest/v1
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
SUPABASE_AIRCALL_CALLS_TABLE=aircall_calls
```

Run `supabase/aircall_calls.sql` in the Supabase SQL editor, then configure Aircall's
`call.ended` webhook to post to `https://your-render-service.onrender.com/api/aircall/webhook`.
The service-role key must only be stored in Render and must never be exposed through a
`VITE_` environment variable or committed to the repository.

The Shopify API uses the client credentials to request expiring Admin API access tokens and refreshes them automatically before expiry. `SHOPIFY_ADMIN_ACCESS_TOKEN` can be set as a fallback for legacy/admin-created apps.

After Render deploys, the API endpoint will be:

```txt
https://your-render-service.onrender.com/api/hubspot/call-report
```

### Frontend: Vercel

Use these settings:

```txt
Framework preset: Vite
Build command: npm run build
Output directory: dist
```

Set this Vercel environment variable before building:

```txt
VITE_HUBSPOT_CALL_REPORT_URL=https://your-render-service.onrender.com/api/hubspot/call-report
```

The HubSpot token must only be set on Render. Do not add `HUBSPOT_PRIVATE_APP_TOKEN` to Vercel.

### Aircall call fallback

Call reports query Aircall directly for the selected date window. The Public Calls API uses the API ID and token. Historical calls that are absent from the Public API, including calls from deleted numbers, are retrieved through Analytics `CALLS_HISTORY` exports when `AIRCALL_ANALYTICS_ACCESS_TOKEN` is configured. Aircall credentials must only be configured on the backend.
