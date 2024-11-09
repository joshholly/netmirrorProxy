import { getUrl } from "../utils";

const m3u8ContentTypes: string[] = [
  "application/vnd.",
  "video/mp2t",
  "application/x-mpegurl",
  "application/mpegurl",
  "application/x-mpegurl",
  "application/vnd.apple.mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "video/x-mpegurl",
  "application/vnd.apple.mpegurl.audio",
  "application/vnd.apple.mpegurl.video",
];

export const M3u8ProxyV2 = async (
  request: Request<unknown>
): Promise<Response> => {
  const url = new URL(request.url);

  const scrapeUrlString = url.searchParams.get("url");
  const scrapeHeadersString = url.searchParams.get("headers");

  let scrapeHeadersObject: ScrapeHeaders = null;
  if (scrapeHeadersString) {
    try {
      scrapeHeadersObject = JSON.parse(scrapeHeadersString);
    } catch (e) {
      console.log(e);
      console.log(
        "[M3u8 Proxy V2] Malformed scrape headers, could no parse using DEFAULT headers"
      );
      scrapeHeadersObject = null;
    }
  }

  if (!scrapeUrlString) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "no scrape url provided",
      }),
      {
        status: 400,
      }
    );
  }

  const scrapeUrl = new URL(scrapeUrlString);
  const headers: {
    [key: string]: string;
  } = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cookie": "t_hash_t=52d244de1633e404cc1aad9ccf1d390a%3A%3Adfdc52da49aea535cf817466bf5e4287%3A%3A1729757185%3A%3Asu; SE_0UABA3VF0B9O4BUEJ395QE759W=0QF4ON35DOLKT6V8Y5F2KL50HI; pv_recentplay=SE_0UABA3VF0B9O4BUEJ395QE759W; recentplay=81672158; 81672158=283%3A7707; ott=pv; hd=on; cf_clearance=hMOszDqQjj.wGW_CC70L2IOW6Mtap.BlVi8TfOyAqjc-1729767123-1.2.1.1-CRcFEESgKDz8gQblfMbT9tbH5luji.16EvcF8tGfX6nOnCuyzDlPpIzMgibDaS7iSFg7o0f543skA.Acjss_dZOJjKHb1CS.fyBbTRiCTWL5P6PaoR2x6ziI8MZXJ1YT4DJKGCYSN1HFZfil7qTW5mRECqq0lB.7AjS8ChBSnb9fuZolxQ8FNV4FHaSWxG7kHgv1wU7ovXPH0vRS3MNriDO3E1MEIuZU.Qo7POdonCIWNt0rP9e5ko1xcwyK6T5ODYjvElTl01bheKkecu7ll75bHEsMvNkhicrfIjYIGnBWylpe9PPgY1LwYFwIiikq338HFKzK4KfgRazgSHdRairxkpJi_mOxdoYlzdRGfae5tHIjVHsUds9N8zi6uyjjDXGPprwlGhkrmOr_99LyVw; t_hash=628ae46cddd3b16915c7cc28adf30d9c%3A%3A1729768118%3A%3Asu; 0QF4ON35DOLKT6V8Y5F2KL50HI=1330%3A3045",
    ...(typeof scrapeHeadersObject == "object" ? scrapeHeadersObject : {}),
  };

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    headers["Range"] = rangeHeader;
  }

  const response = await fetch(scrapeUrlString, {
    headers: headers,
  });

  // get the content type of the response
  const responseContentType = response.headers
    .get("Content-Type")
    ?.toLowerCase();
  let responseBody: BodyInit | null = response.body;

  const isM3u8 =
    scrapeUrl.pathname.endsWith(".m3u8") ||
    (responseContentType &&
      m3u8ContentTypes.some((name) => responseContentType.includes(name)));

  console.log(`Is m3u8: ${isM3u8}`);

  if (isM3u8) {
    const baseUrl =
      scrapeUrl.origin +
      scrapeUrl.pathname.substring(0, scrapeUrl.pathname.lastIndexOf("/") + 1);
    const m3u8File = await response.text();
    const m3u8FileChunks = m3u8File.split("\n");
    const m3u8AdjustedChunks: string[] = [];
    for (let line of m3u8FileChunks) {
      // Handle LANGUAGE="..." replacement (removing the third letter)
      if (line.includes('LANGUAGE="')) {
        line = line.replace(/LANGUAGE="([a-z]{3})"/i, (match, lang) => {
          // Custom mappings for specific languages
          const languageMappings = {
            spa: "es",
            por: "pt",
            pol: "pl",
            tur: "tr",
            rus: "ru",
            ita: "it",
          };
          const newLang = languageMappings[lang as keyof typeof languageMappings] || lang.slice(0, 2); // Use mapped or reduce to two characters
          return `LANGUAGE="${newLang}"`;
        });
      }

      // Replace URI="..." for entries like #EXT-X-MEDIA
      if (line.includes('URI="')) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch) {
          const originalUri = uriMatch[1];
          const searchParams = new URLSearchParams();
          searchParams.set("url", originalUri);
          if (scrapeHeadersString) {
            searchParams.set("headers", scrapeHeadersString);
          }
          // Replace URI="..." with the adjusted /proxy URL
          line = line.replace(
            uriMatch[0],
            `URI="/proxy?${searchParams.toString()}"`
          );
        }
      }

      // Handle media URLs after #EXTINF, e.g., file names like 9758_000.jpg
      if (line.match(/\.(jpg|jpeg|png|mp4|ts|html|js)(\?.*)?$/i)) {
        const filename = line.trim();
        const fullUrl = baseUrl + filename;

        const searchParams = new URLSearchParams();
        searchParams.set("url", fullUrl);
        if (scrapeHeadersString)
          searchParams.set("headers", scrapeHeadersString);

        // Replace filename with the proxy URL
        line = `/proxy?${searchParams.toString()}`;
      }

      // Handle media URLs after #EXTINF
      if (line.startsWith("http")) {
        const url = getUrl(line, scrapeUrl);
        const searchParams = new URLSearchParams();
        searchParams.set("url", url.toString());
        if (scrapeHeadersString)
          searchParams.set("headers", scrapeHeadersString);

        // Replace media URLs with proxy
        line = `/proxy?${searchParams.toString()}`;
      }

      // Add the modified or unmodified line back to the adjusted chunks
      m3u8AdjustedChunks.push(line);
    }

    responseBody = m3u8AdjustedChunks.join("\n");
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

type ScrapeHeaders =
  | string
  | null
  | {
      [key: string]: string;
    };
