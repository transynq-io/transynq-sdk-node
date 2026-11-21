import { ConnectionError, TimeoutError, errorFromResponse } from './errors.js';
import { FileUpload } from './files.js';
import { parseJson } from './json.js';
import { ApiResponse, FileDownload, ResponseBody, type RequestOptions } from './types.js';

/** The SDK version (semantic, independent of the API version). */
export const SDK_VERSION = '1.0.2';
export const API_KEY_HEADER = 'X-Transynq-APIKey';
export const CSRF_HEADER = 'X-CSRF-Token';
export const CORRELATION_HEADER = 'X-Correlation-Id';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

const REDACTED = new Set(['authorization', 'cookie', 'set-cookie', API_KEY_HEADER.toLowerCase(), CSRF_HEADER.toLowerCase(), 'proxy-authorization']);
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/** What a hook sees of a request about to be sent (credentials redacted). */
export interface RequestInfo {
  method: string;
  url: string;
  operationId: string;
  attempt: number;
  headers: Record<string, string>;
}

/** What a hook sees of an answer (cookies redacted). */
export interface ResponseInfo {
  request: RequestInfo;
  statusCode: number;
  elapsedMs: number;
  headers: Record<string, string>;
}

/** One debug line per attempt: never bodies or secrets. */
export type Logger = (message: string, details: Record<string, unknown>) => void;

/** Settings of a {@link TransynqClient}. */
export interface ClientOptions {
  /** The API host, for example `https://api.example.com`. */
  baseUrl: string;
  /** How requests authenticate; omit for anonymous calls. */
  credential?: Credential;
  /** Time allowed for one attempt, in milliseconds. Default 60 000. */
  timeoutMs?: number;
  /** Retries after the first attempt for retryable failures; 0 turns retries off. Default 2. */
  maxRetries?: number;
  /** First back-off delay (ms), doubled per attempt with full jitter. Default 500. */
  retryBaseDelayMs?: number;
  /** Upper bound of a computed back-off delay (ms). Default 8 000. */
  maxRetryDelayMs?: number;
  /** A `Retry-After` longer than this (ms) is not waited for. Default 60 000. */
  maxRetryAfterMs?: number;
  /** Appended to the `User-Agent`. */
  userAgentSuffix?: string;
  /** A custom `fetch` (a proxy agent, instrumentation, a test double). Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Receives one debug line per attempt. */
  logger?: Logger;
  /** Called before each attempt is sent. */
  onRequest?: (info: RequestInfo) => void;
  /** Called after each attempt is answered. */
  onResponse?: (info: ResponseInfo) => void;
  /** Waits between retries and polls (tests). Default: `setTimeout`. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Jitter source in [0, 1) (tests). Default `Math.random`. */
  jitter?: () => number;
}

/** A successful sign-in answer. */
export interface SignInResponse {
  statusCode: number;
  body: string;
  setCookies: string[];
}

/** Sends sign-in calls for credentials: no credential, no retries, errors mapped. */
export interface SignInTransport {
  postJson(path: string, body: string, headers: Record<string, string>, operationId: string): Promise<SignInResponse>;
}

/** A request as a credential sees it. */
export class CredentialRequest {
  /** What the credential applied (compared on a 401). */
  appliedState: unknown;

  /** @internal */
  constructor(
    readonly method: string,
    readonly url: string,
    readonly headers: Record<string, string>,
    readonly transport: SignInTransport,
  ) {}

  /** True for POST, PUT, PATCH and DELETE. */
  get isUnsafe(): boolean {
    return !['GET', 'HEAD', 'OPTIONS'].includes(this.method);
  }

  /** Sets (replaces) a header. */
  setHeader(name: string, value: string): void {
    for (const key of Object.keys(this.headers)) if (key.toLowerCase() === name.toLowerCase()) delete this.headers[key];
    this.headers[name] = value;
  }
}

/** How requests authenticate. */
export interface Credential {
  /** Adds headers before a request is sent, signing in first when needed. */
  apply(request: CredentialRequest): Promise<void>;
  /** Called on a 401; true when one retry with fresh credentials is worthwhile. */
  refreshAfterUnauthorized(request: CredentialRequest): Promise<boolean>;
}

type Scalar = string | number | boolean | Date;

function formatScalar(value: Scalar): string {
  if (value instanceof Date) return value.toISOString().replace('.000Z', 'Z');
  return String(value);
}

/** A request built by a generated service method. */
export class ApiRequest {
  private readonly pathValues = new Map<string, string>();
  readonly queryValues: Array<[string, string]> = [];
  json: string | undefined;
  hasClientId = false;
  readonly formTexts: Array<[string, string]> = [];
  readonly formFiles: Array<[string, FileUpload]> = [];

  constructor(
    readonly method: string,
    readonly pathTemplate: string,
    readonly operationId: string,
  ) {}

  path(name: string, value: Scalar): void {
    this.pathValues.set(name, encodeURIComponent(formatScalar(value)));
  }

  query(name: string, value: Scalar | Scalar[] | null | undefined): void {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const v of value) this.query(name, v);
      return;
    }
    this.queryValues.push([name, formatScalar(value)]);
  }

  jsonBody(body: unknown, clientIdCreate = false): void {
    if (body === null || body === undefined) return;
    this.json = JSON.stringify(body);
    this.hasClientId = clientIdCreate && carriesClientId(body);
  }

  formText(name: string, value: Scalar | null | undefined): void {
    if (value !== null && value !== undefined) this.formTexts.push([name, formatScalar(value)]);
  }

  formFile(name: string, value: FileUpload | FileUpload[] | null | undefined): void {
    if (!value) return;
    for (const f of Array.isArray(value) ? value : [value]) this.formFiles.push([name, f]);
  }

  url(baseUrl: string): string {
    let path = this.pathTemplate;
    for (const [name, value] of this.pathValues) path = path.replace(`{${name}}`, value);
    if (path.includes('{')) throw new TypeError(`${this.operationId}: path parameter missing in ${path}`);
    const query = this.queryValues.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return baseUrl.replace(/\/+$/, '') + path + (query ? `?${query}` : '');
  }

  retrySafe(options: RequestOptions | undefined): boolean {
    return SAFE.has(this.method) || Boolean(options?.idempotencyKey) || this.hasClientId;
  }

  body(): { body?: BodyInit; contentType?: string } {
    if (this.json !== undefined) return { body: this.json, contentType: 'application/json; charset=utf-8' };
    if (this.formTexts.length || this.formFiles.length) {
      const form = new FormData();
      for (const [name, value] of this.formTexts) form.append(name, value);
      for (const [name, file] of this.formFiles) form.append(name, file.toBlob(), file.fileName);
      return { body: form };
    }
    return {};
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function carriesClientId(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const id = (body as Record<string, unknown>)['id'];
  return typeof id === 'string' && UUID.test(id) && !/^[0-]+$/.test(id);
}

/** Response headers as a lower-case record (repeated values joined by `, `). */
export function headersOf(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function redact(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) result[k] = REDACTED.has(k.toLowerCase()) ? '[redacted]' : v;
  return result;
}

/** `Retry-After` in milliseconds. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, when - Date.now());
}

/** The file name of a `Content-Disposition` header. */
export function fileNameOf(disposition: string | null): string | undefined {
  if (!disposition) return undefined;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star?.[1]) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim();
}

function newCorrelationId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

/** The send loop: credentials, headers, timeouts, retries with back-off, error mapping. */
export class Transport implements SignInTransport {
  readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(readonly options: ClientOptions) {
    if (!/^https?:\/\//.test(options.baseUrl ?? '')) throw new TypeError('baseUrl must be an absolute http(s) URL');
    if ((options.maxRetries ?? 2) < 0) throw new RangeError('maxRetries must be 0 or more');
    this.userAgent = `transynq-sdk-node/${SDK_VERSION}${options.userAgentSuffix ? ` ${options.userAgentSuffix.trim()}` : ''}`;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
  }

  private standardHeaders(correlationId: string, options: RequestOptions | undefined): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': this.userAgent, Accept: 'application/json', [CORRELATION_HEADER]: correlationId };
    if (options?.ifMatch) h['If-Match'] = options.ifMatch;
    if (options?.idempotencyKey) h[IDEMPOTENCY_HEADER] = options.idempotencyKey;
    return { ...h, ...options?.headers };
  }

  private backOff(attempt: number): number {
    const base = this.options.retryBaseDelayMs ?? 500;
    const max = this.options.maxRetryDelayMs ?? 8000;
    return Math.min(max, base * 2 ** (attempt - 1)) * (this.options.jitter ?? Math.random)();
  }

  private log(operationId: string, attempt: number, outcome: number | string, elapsedMs: number, correlationId: string): void {
    this.options.logger?.(`Transynq ${operationId} attempt ${attempt} -> ${outcome}`, { operationId, attempt, outcome, elapsedMs, correlationId });
  }

  private async fetchOnce(url: string, init: RequestInit, timeoutMs: number, signal: AbortSignal | undefined): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TimeoutError('timeout')), timeoutMs);
    const onAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Sends with retries; returns a successful response (body unread). */
  async send(req: ApiRequest, options: RequestOptions | undefined): Promise<Response> {
    const correlationId = options?.correlationId ?? newCorrelationId();
    const maxRetries = Math.max(0, options?.maxRetries ?? this.options.maxRetries ?? 2);
    const timeoutMs = options?.timeoutMs ?? this.options.timeoutMs ?? 60_000;
    const credential = this.options.credential;
    const retrySafe = req.retrySafe(options);
    const url = req.url(this.options.baseUrl);
    let authRetried = false;
    for (let attempt = 1; ; attempt++) {
      const credRequest = new CredentialRequest(req.method, url, this.standardHeaders(correlationId, options), this);
      if (credential) await credential.apply(credRequest);
      const { body, contentType } = req.body();
      const headers = { ...credRequest.headers };
      if (contentType) headers['Content-Type'] = contentType;
      const info: RequestInfo = { method: req.method, url, operationId: req.operationId, attempt, headers: redact(headers) };
      this.options.onRequest?.(info);
      const started = Date.now();
      let response: Response;
      try {
        const init: RequestInit = { method: req.method, headers, redirect: 'manual' };
        if (body !== undefined) init.body = body;
        response = await this.fetchOnce(url, init, timeoutMs, options?.signal);
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        const timedOut = error instanceof TimeoutError || (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError';
        this.log(req.operationId, attempt, timedOut ? 'timeout' : 'network error', Date.now() - started, correlationId);
        if (retrySafe && attempt <= maxRetries) {
          await this.sleep(this.backOff(attempt), options?.signal);
          continue;
        }
        if (timedOut) throw new TimeoutError(`${req.operationId} timed out after ${timeoutMs} ms [correlation id ${correlationId}]`, { cause: error });
        throw new ConnectionError(`${req.operationId} could not reach the API: ${String(error)} [correlation id ${correlationId}]`, { cause: error });
      }
      const elapsedMs = Date.now() - started;
      this.log(req.operationId, attempt, response.status, elapsedMs, correlationId);
      this.options.onResponse?.({ request: info, statusCode: response.status, elapsedMs, headers: redact(headersOf(response)) });
      if (response.ok) return response;
      if (response.status === 401 && credential && !authRetried && (await credential.refreshAfterUnauthorized(credRequest))) {
        authRetried = true;
        attempt--;
        await discard(response);
        continue;
      }
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      if (
        RETRYABLE.has(response.status) &&
        (retrySafe || response.status === 429) &&
        attempt <= maxRetries &&
        (retryAfter === undefined || retryAfter <= (this.options.maxRetryAfterMs ?? 60_000))
      ) {
        await discard(response);
        await this.sleep(retryAfter ?? this.backOff(attempt), options?.signal);
        continue;
      }
      throw errorFromResponse(response.status, await response.text(), headersOf(response), req.operationId, retryAfter);
    }
  }

  async sendJson<T>(req: ApiRequest, options?: RequestOptions): Promise<ApiResponse<T>> {
    const response = await this.send(req, options);
    const text = await response.text();
    return new ApiResponse<T>(response.status, (text ? parseJson(text) : undefined) as T, headersOf(response));
  }

  async sendRaw(req: ApiRequest, options?: RequestOptions): Promise<ApiResponse<ResponseBody>> {
    const response = await this.send(req, options);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type')?.split(';')[0] || undefined;
    const body = new ResponseBody(bytes, contentType, fileNameOf(response.headers.get('content-disposition')), parseJson);
    return new ApiResponse(response.status, body, headersOf(response));
  }

  async sendDownload(req: ApiRequest, options?: RequestOptions): Promise<ApiResponse<FileDownload>> {
    const response = await this.send(req, options);
    return new ApiResponse(response.status, new FileDownload(response, fileNameOf(response.headers.get('content-disposition'))), headersOf(response));
  }

  /** Sign-in calls made by credentials: no credential, no retries, errors mapped. */
  async postJson(path: string, body: string, headers: Record<string, string>, operationId: string): Promise<SignInResponse> {
    const correlationId = newCorrelationId();
    const url = this.options.baseUrl.replace(/\/+$/, '') + path;
    const all = { ...this.standardHeaders(correlationId, undefined), ...headers, 'Content-Type': 'application/json; charset=utf-8' };
    const info: RequestInfo = { method: 'POST', url, operationId, attempt: 1, headers: redact(all) };
    this.options.onRequest?.(info);
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchOnce(url, { method: 'POST', headers: all, body, redirect: 'manual' }, this.options.timeoutMs ?? 60_000, undefined);
    } catch (error) {
      throw new ConnectionError(`${operationId} could not reach the API: ${String(error)} [correlation id ${correlationId}]`, { cause: error });
    }
    this.log(operationId, 1, response.status, Date.now() - started, correlationId);
    this.options.onResponse?.({ request: info, statusCode: response.status, elapsedMs: Date.now() - started, headers: redact(headersOf(response)) });
    const text = await response.text();
    if (!response.ok) throw errorFromResponse(response.status, text, headersOf(response), operationId, parseRetryAfter(response.headers.get('retry-after')));
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies = getSetCookie ? getSetCookie.call(response.headers) : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/);
    return { statusCode: response.status, body: text, setCookies: setCookies.filter(Boolean) };
  }
}

/** Reads and drops a body so the connection can be reused. */
async function discard(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // the body was already gone
  }
}
