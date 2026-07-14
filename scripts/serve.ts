import index from "../packages/ui/index.html";

const server = Bun.serve({
  port: 3141,
  routes: { "/": index },
  development: true,
});

console.log(`RBMK control room: ${server.url}`);
