import net from "node:net";

export interface PortFinderOptions {
  startPort?: number;
  endPort?: number;
  host?: string;
}

export class PortAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortAllocationError";
  }
}

/**
 * Check whether a single TCP port is currently free to bind on the host.
 */
export function isPortAvailable(
  port: number,
  host: string = "127.0.0.1",
): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen({ port, host, exclusive: true });
  });
}

/**
 * Scan a range of ports (default 3001..3010) and return the first available one.
 * If all ports in the range are occupied, throws PortAllocationError.
 */
export async function findAvailablePort(
  options: PortFinderOptions = {},
): Promise<number> {
  const { startPort = 3001, endPort = 3010, host = "127.0.0.1" } = options;

  if (startPort > endPort) {
    throw new PortAllocationError(
      `Invalid port range: startPort (${startPort}) cannot be greater than endPort (${endPort})`,
    );
  }

  for (let port = startPort; port <= endPort; port++) {
    const available = await isPortAvailable(port, host);
    if (available) {
      return port;
    }
  }

  throw new PortAllocationError(
    `No available ports found in range ${startPort}-${endPort} on host ${host}`,
  );
}
