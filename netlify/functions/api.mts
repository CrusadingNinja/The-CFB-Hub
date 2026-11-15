import type { Config, Context } from "@netlify/functions";
import serverModule from "../../server.js";

interface ServerAdapter {
  dispatchApiRequest: (
    method: string,
    urlString: string
  ) => Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }>;
}

const { dispatchApiRequest } = serverModule as ServerAdapter;

/**
 * Routes Netlify /api/* requests to the shared Node API handlers in server.js.
 */
export default async (req: Request, _context: Context) => {
  const reqUrl = new URL(req.url);
  const result = await dispatchApiRequest(
    req.method,
    reqUrl.pathname + reqUrl.search
  );

  const hasEmptyBodyStatus =
    req.method === "HEAD" ||
    result.statusCode === 204 ||
    result.statusCode === 304;

  return new Response(hasEmptyBodyStatus ? null : result.body, {
    status: result.statusCode,
    headers: result.headers
  });
};

export const config: Config = {
  path: ["/api/*"]
};
