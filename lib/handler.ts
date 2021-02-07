import {
  ImageConfig,
  imageConfigDefault,
} from 'next/dist/next-server/server/image-config';
import { parse as parseUrl } from 'url';
import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { Writable } from 'stream';

import { imageOptimizer } from './image-optimizer';
import { normalizeHeaders } from './normalized-headers';

let domains = [];
try {
  domains = JSON.parse(process.env.DOMAINS);
} catch (err) {
  console.error('Could not parse the provided domain list!');
  console.error(err);
}

const imageConfig: ImageConfig = {
  ...imageConfigDefault,
  domains,
};

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  const reqMock: any = {
    headers: normalizeHeaders(event.headers),
    method: event.requestContext.http.method,
    url: `/?${event.rawQueryString}`,
  };

  const resBuffers: Buffer[] = [];
  const resMock: any = new Writable();

  resMock.write = (chunk: Buffer | string) => {
    resBuffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };
  resMock._write = (chunk: Buffer | string) => {
    resMock.write(chunk);
  };
  const mockHeaders: Record<string, string | string[]> = {};
  resMock.writeHead = (_status: any, _headers: any) =>
    Object.assign(mockHeaders, _headers);
  resMock.getHeader = (name: string) => mockHeaders[name.toLowerCase()];
  resMock.getHeaders = () => mockHeaders;
  resMock.getHeaderNames = () => Object.keys(mockHeaders);
  resMock.setHeader = (name: string, value: string | string[]) =>
    (mockHeaders[name.toLowerCase()] = value);
  resMock._implicitHeader = () => {};

  const parsedUrl = parseUrl(reqMock.url, true);
  const result = await imageOptimizer(imageConfig, reqMock, resMock, parsedUrl);

  const normalizedHeaders: Record<string, string> = {};
  for (const [headerKey, headerValue] of Object.entries(mockHeaders)) {
    if (Array.isArray(headerValue)) {
      normalizedHeaders[headerKey] = headerValue.join(', ');
      continue;
    }

    normalizedHeaders[headerKey] = headerValue;
  }

  if (result.originCacheControl) {
    normalizedHeaders['cache-control'] = result.originCacheControl;
  } else {
    normalizedHeaders['cache-control'] = 'public, max-age=60';
  }

  return {
    statusCode: resMock.statusCode || 200,
    body: Buffer.concat(resBuffers).toString('base64'),
    isBase64Encoded: true,
    headers: normalizedHeaders,
  };
}
