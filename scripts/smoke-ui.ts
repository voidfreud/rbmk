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
  // Catch the common browser failure where main.ts dereferences a missing
  // element and the animation loop dies on its first DOM update.
  const htmlIds = new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!),
  );
  const source = await Bun.file("packages/ui/src/main.ts").text();
  const staticDomRefs = [
    ...source.matchAll(/\$\s*(?:<[^>]+>\s*)?\(\s*"([^"]+)"\s*\)/g),
  ].map((match) => match[1]!);
  // Template-literal lookups ($(`ar-mode-${m}`)) resolve against the nearest
  // preceding for-loop that binds each hole: `for (const m of [..])` or
  // `for (let i = A; i < B; i++)` (with optional `+ k` offset in the hole).
  const domainOf = (before: string, name: string): (string | number)[] | null => {
    let match: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    const ofRe = new RegExp(`for\\s*\\(\\s*const ${name} of \\[([^\\]]*)\\]`, "g");
    while ((match = ofRe.exec(before))) last = match;
    if (last) {
      return last[1]!.split(",").map((item) => {
        const text = item.trim();
        const quoted = text.match(/^["'](.*)["']$/);
        return quoted ? quoted[1]! : Number(text);
      });
    }
    const numRe = new RegExp(
      `for\\s*\\(\\s*let ${name}\\s*=\\s*(\\d+)\\s*;\\s*${name}\\s*(<=?)\\s*(\\d+)`,
      "g",
    );
    while ((match = numRe.exec(before))) last = match;
    if (!last) return null;
    const lo = Number(last[1]);
    const hi = Number(last[3]);
    const out: number[] = [];
    for (let v = lo; last[2] === "<" ? v < hi : v <= hi; v++) out.push(v);
    return out;
  };
  const dynamicDomRefs: string[] = [];
  for (const match of source.matchAll(/\$\s*(?:<[^>]+>\s*)?\(\s*`([^`]+)`\s*\)/g)) {
    const template = match[1]!;
    const before = source.slice(0, match.index);
    const holes = [...template.matchAll(/\$\{\s*(\w+)\s*(?:\+\s*(\d+)\s*)?\}/g)];
    let domains = holes.map((hole) => {
      const domain = domainOf(before, hole[1]!);
      const offset = hole[2] ? Number(hole[2]) : 0;
      return domain?.map((v) => (typeof v === "number" ? v + offset : v)) ?? null;
    });
    if (domains.some((d) => d === null || d.length === 0)) continue;
    // Single-hole templates cover every current use; expand the product.
    let expanded = [template];
    for (let h = 0; h < holes.length; h++) {
      const next: string[] = [];
      for (const partial of expanded) {
        for (const value of domains[h]!) {
          next.push(partial.replace(holes[h]![0], String(value)));
        }
      }
      expanded = next;
    }
    dynamicDomRefs.push(...expanded);
  }
  const missingDomIds = [...new Set([...staticDomRefs, ...dynamicDomRefs])].filter(
    (id) => !htmlIds.has(id),
  );
  if (missingDomIds.length > 0) {
    throw new Error(`UI source references missing DOM ids: ${missingDomIds.join(", ")}`);
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
