export {};

const url = "http://127.0.0.1:3141/";
let server: ReturnType<typeof Bun.spawn> | undefined;

async function fetchPage(): Promise<Response | null> {
  try {
    return await fetch(url);
  } catch {
    return null;
  }
}

let response = await fetchPage();
if (!response) {
  server = Bun.spawn(["bun", "run", "scripts/serve.ts"], {
    stdout: "ignore",
    stderr: "pipe",
  });
  for (let attempt = 0; attempt < 50 && !response; attempt++) {
    await Bun.sleep(100);
    response = await fetchPage();
  }
}

try {
  if (!response?.ok) {
    const stderr = server?.stderr instanceof ReadableStream
      ? await new Response(server.stderr).text()
      : "";
    throw new Error(`UI server did not become ready. ${stderr}`.trim());
  }

  const html = await response.text();
  const required = [
    "RBMK-1000 — Unit Control Room",
    'id="cartogram"',
    'id="channelmap"',
    'id="slice"',
    'id="st-trends"',
    "data-bun-dev-server-script",
    "</html>",
  ];
  const missing = required.filter((token) => !html.includes(token));
  if (missing.length > 0) {
    throw new Error(`UI response is incomplete; missing: ${missing.join(", ")}`);
  }

  const scriptPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  if (!scriptPath) throw new Error("UI response has no executable bundle");
  const bundle = await fetch(new URL(scriptPath, url));
  const bundleText = await bundle.text();
  if (!bundle.ok || bundleText.length < 1_000) {
    throw new Error(`UI bundle is unavailable or unexpectedly short (${bundle.status})`);
  }

  console.log(
    `UI smoke passed: ${html.length} byte document + ${bundleText.length} byte bundle`,
  );
} finally {
  server?.kill();
  await server?.exited;
}
