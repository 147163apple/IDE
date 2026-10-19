import { describe, expect, it } from "vitest";
import net from "node:net";
import {
  findAvailablePort,
  isPortAvailable,
  PortAllocationError,
} from "../../daemon/core/port-finder";

describe("Task 1.1: Port Finder", () => {
  it("should find an available port in the default range", async () => {
    const port = await findAvailablePort({ startPort: 3400, endPort: 3410 });
    expect(port).toBeGreaterThanOrEqual(3400);
    expect(port).toBeLessThanOrEqual(3410);
  });

  it("should skip occupied ports and find the next available port", async () => {
    const testPort = 3420;
    // Occupy 3420
    const blocker = net.createServer();
    await new Promise<void>((resolve) => {
      blocker.listen({ port: testPort, host: "127.0.0.1" }, () => resolve());
    });

    try {
      expect(await isPortAvailable(testPort)).toBe(false);
      const port = await findAvailablePort({ startPort: 3420, endPort: 3425 });
      expect(port).toBeGreaterThan(testPort);
      expect(port).toBeLessThanOrEqual(3425);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("should throw PortAllocationError when all ports in range are occupied", async () => {
    const startPort = 3430;
    const endPort = 3432;
    const blockers: net.Server[] = [];

    try {
      for (let p = startPort; p <= endPort; p++) {
        const s = net.createServer();
        await new Promise<void>((resolve) => {
          s.listen({ port: p, host: "127.0.0.1" }, () => resolve());
        });
        blockers.push(s);
      }

      await expect(findAvailablePort({ startPort, endPort })).rejects.toThrow(
        PortAllocationError,
      );
    } finally {
      for (const s of blockers) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }
  });

  it("should reject invalid range where startPort > endPort", async () => {
    await expect(
      findAvailablePort({ startPort: 3500, endPort: 3400 }),
    ).rejects.toThrow(PortAllocationError);
  });
});
