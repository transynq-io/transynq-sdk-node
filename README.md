<p align="center">
  <a href="https://transynq.io/"><img alt="Transynq - transport management software" src="https://raw.githubusercontent.com/transynq-io/transynq-sdk-node/main/assets/brand/transynq-readme-banner.png" width="720"></a>
</p>

<h1 align="center">Transynq TMS Node.js / TypeScript SDK</h1>

<p align="center"><em>The official Node.js / TypeScript client for the <a href="https://transynq.io/transport-management-system">Transynq transport management system (TMS)</a> API</em></p>

<p align="center">
  <a href="https://github.com/transynq-io/transynq-sdk-node/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/transynq-io/transynq-sdk-node/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/transynq-io/transynq-sdk-node/actions/workflows/release.yml"><img alt="Release" src="https://github.com/transynq-io/transynq-sdk-node/actions/workflows/release.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@transynq/sdk"><img alt="npm" src="https://img.shields.io/npm/v/@transynq/sdk?logo=npm&color=2563EB"></a>
  <a href="https://www.npmjs.com/package/@transynq/sdk"><img alt="Downloads" src="https://img.shields.io/npm/dm/@transynq/sdk?color=06B6D4"></a>
  <img alt="Runtime" src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white">
  <a href="https://github.com/transynq-io/transynq-sdk-node/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-8B5CF6"></a>
  <a href="https://github.com/transynq-io/transynq-sdk-node/tree/main/docs/"><img alt="Docs" src="https://img.shields.io/badge/docs-guides-2563EB"></a>
  <img alt="API operations" src="https://img.shields.io/badge/API%20operations-705-0B1220">
  <a href="https://transynq.io/"><img alt="Website: transynq.io" src="https://img.shields.io/badge/website-transynq.io-2563EB"></a>
  <a href="https://transynq.io/transport-management-system"><img alt="Transynq TMS" src="https://img.shields.io/badge/product-Transynq%20TMS-8B5CF6"></a>
</p>

The official Node.js / TypeScript SDK for [**Transynq TMS**](https://transynq.io/transport-management-system), the transport management system (TMS) from
[Transynq](https://transynq.io/) for carriers, fleet operators, 3PLs, brokers and shippers. Use it to connect your own
systems to bookings, dispatch, live tracking, driver proof of delivery, invoicing and costing: all 705 operations
of the Transynq API (`/api/v1`), grouped by area, with typed models, authentication, retries, typed errors,
paging, optimistic concurrency, file transfer and long-running operations handled for you.

- Package: `@transynq/sdk` - version 1.0.2 (semantic versioning, independent of the API version)
- Generated from the Transynq API OpenAPI 3.1 contract v1.0.0 plus a hand-written core
- Licence: [MIT](https://github.com/transynq-io/transynq-sdk-node/blob/main/LICENSE)

## Requirements

- Node.js 20 or later (uses the built-in `fetch`, `FormData`, `Blob` and `crypto.randomUUID`)
- No runtime dependencies; TypeScript types are included (ESM and CommonJS builds)

## Install

```shell
npm install @transynq/sdk
```

## Quick start

```ts
import { ApiKeyCredential, TransynqClient } from '@transynq/sdk';

const client = new TransynqClient({
  baseUrl: 'https://api.example.com',
  credential: new ApiKeyCredential(process.env.TRANSYNQ_API_KEY!),
});

const countries = await client.referenceData.listCountries();
for (const country of countries.data) console.log(country.name);
console.log(`Answered by API ${countries.apiVersion}, correlation id ${countries.correlationId}`);
```

One property per OpenAPI tag (`client.jobs`, `client.referenceData`, `client.driverApp`...), one method per operation named after its `operationId` in camel case (`getJob`, `listCountries`). Path parameters come first, then the body (or a form object for uploads), then a query object, then `RequestOptions` (which also carries an `AbortSignal`). Every method returns a `Promise<ApiResponse<T>>`.

Every call returns an `ApiResponse`: `ApiResponse<T>` exposes `data`, `statusCode`, `headers`, `etag`, `apiVersion` (`X-Api-Version`), `correlationId` (`X-Correlation-Id`), `location` and `isAccepted`.

## Authentication

The API accepts three non-browser credentials; pick the one that matches your integration.

| Credential | When | Wire |
|---|---|---|
| `ApiKeyCredential` | server-to-server integrations | `X-Transynq-APIKey: <key>` |
| `SessionCredential` | tools acting as a named user | `POST /api/v1/auth/login`, then the session cookie + `X-CSRF-Token` |
| `DriverLoginCredential` / `DriverTokenCredential` | driver / POD apps (`/api/v1/driver/*`) | `Authorization: Bearer <token>` |

```ts
const client = new TransynqClient({
  baseUrl: 'https://api.example.com',
  credential: new ApiKeyCredential('tq_example_key_123'),   // sent as X-Transynq-APIKey
});
const who = await client.authentication.getApiClient();     // { companyId, description }
console.log(who.data.json());
```

See [docs/authentication.md](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/authentication.md) for sessions, CSRF and driver tokens.

## Documentation

- [Getting started](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/getting-started.md)
- [Authentication](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/authentication.md)
- [Configuration](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/configuration.md)
- [Error handling](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/error-handling.md)
- [Pagination and grid queries](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/pagination.md)
- [Concurrency (ETag / If-Match)](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/concurrency.md)
- [Idempotency](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/idempotency.md)
- [Long-running operations](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/long-running-operations.md)
- [File upload and download](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/files.md)
- [Logging and observability](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/logging-and-observability.md)
- [Dates, money and enums (type mapping)](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/types.md)
- [Testing your integration](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/testing.md)
- [Versioning and compatibility](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/versioning.md)
- [Troubleshooting and FAQ](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/troubleshooting.md)
- [Resource index (every operation, generated)](https://github.com/transynq-io/transynq-sdk-node/blob/main/docs/resources/README.md)

Runnable samples of real flows (sign in, list and page grid rows, create a booking idempotently, update with If-Match, list
invoices, upload a POD, wait on a long operation) are in [`examples/flows.ts`](https://github.com/transynq-io/transynq-sdk-node/blob/main/examples/flows.ts).

The API reference is generated from the TSDoc comments with TypeDoc (`typedoc.json` in this repository):

```shell
npm run docs   # writes docs/api/ (not checked in)
```

## About Transynq

[**Transynq**](https://transynq.io/) is transport management software for carriers, fleet operators, 3PLs, brokers and shippers.
[**Transynq TMS**](https://transynq.io/transport-management-system), the Transynq transport management system, keeps the whole job on one record, from booking
to invoice: jobs and planning, dispatch, live tracking, a driver app with electronic proof of delivery (POD), invoicing,
costing, compliance and AI. This SDK is the official way to connect your own Node.js applications to it.

- Website: [transynq.io](https://transynq.io/)
- Transport management system: [transynq.io/transport-management-system](https://transynq.io/transport-management-system)
- Contact: [contact@transynq.io](mailto:contact@transynq.io)

## Support

- Bugs and feature requests: [GitHub issues](https://github.com/transynq-io/transynq-sdk-node/issues) (use the templates; never paste real keys, passwords or customer data).
- Security problems: see [SECURITY.md](https://github.com/transynq-io/transynq-sdk-node/blob/main/SECURITY.md) - do not open a public issue.
- When the API answers with an error, quote its correlation id (`correlationId` on the error).

## Contributing

See [CONTRIBUTING.md](https://github.com/transynq-io/transynq-sdk-node/blob/main/CONTRIBUTING.md) and the [code of conduct](https://github.com/transynq-io/transynq-sdk-node/blob/main/CODE_OF_CONDUCT.md).

## Licence

[MIT](https://github.com/transynq-io/transynq-sdk-node/blob/main/LICENSE) - Copyright (c) 2026 Transynq.

The Transynq name and logos are trademarks of Transynq and are not covered by the MIT licence; you may use them only to refer to Transynq.

---

<p align="center">
  <a href="https://transynq.io/"><img alt="Transynq" src="https://raw.githubusercontent.com/transynq-io/transynq-sdk-node/main/assets/brand/transynq-icon-64.png" width="40"></a><br>
  <a href="https://transynq.io/transport-management-system"><strong>Transynq TMS</strong></a> &middot; transport management software by <a href="https://transynq.io/">Transynq</a><br>
  <sub>Smarter Transport. Connected Operations.</sub>
</p>
