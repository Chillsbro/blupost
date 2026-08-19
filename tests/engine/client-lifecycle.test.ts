import {expect, test} from "bun:test";
import {resolve} from "node:path";
import {createEngineClient} from "../../src/engine/createEngineClient.js";

test.serial(
  "stopping during binary resolution prevents a late engine spawn",
  async () => {
    const previous = process.env.BLUPOST_ENGINE;
    process.env.BLUPOST_ENGINE = "/path/that/must/not/be-spawned";
    try {
      const client = createEngineClient();
      const starting = client.start();
      const firstStop = client.stop();
      const secondStop = client.stop();

      expect(firstStop).toBe(secondStop);
      await firstStop;
      await expect(starting).rejects.toThrow("engine process has stopped");
    } finally {
      if (previous === undefined) delete process.env.BLUPOST_ENGINE;
      else process.env.BLUPOST_ENGINE = previous;
    }
  }
);

test.serial(
  "rejects a response whose operation does not match its request",
  async () => {
    const binary = resolve(import.meta.dir, "../support/wrongOperationEngine.ts");

    const previous = process.env.BLUPOST_ENGINE;
    process.env.BLUPOST_ENGINE = binary;
    const client = createEngineClient();
    try {
      await expect(client.start()).rejects.toThrow(
        "engine returned the wrong operation for a request"
      );
      await expect(client.connect()).rejects.toThrow(
        "engine returned the wrong operation for a request"
      );
    } finally {
      await client.stop();
      if (previous === undefined) delete process.env.BLUPOST_ENGINE;
      else process.env.BLUPOST_ENGINE = previous;
    }
  }
);

test.serial("poisons the client after an error with the wrong request ID", async () => {
  const binary = resolve(import.meta.dir, "../support/wrongRequestErrorEngine.ts");
  const previous = process.env.BLUPOST_ENGINE;
  process.env.BLUPOST_ENGINE = binary;
  const client = createEngineClient();
  try {
    await client.start();
    await expect(client.connect()).rejects.toThrow(
      "engine returned an uncorrelated error response"
    );
    await expect(client.connect()).rejects.toThrow(
      "engine returned an uncorrelated error response"
    );
  } finally {
    await client.stop();
    if (previous === undefined) delete process.env.BLUPOST_ENGINE;
    else process.env.BLUPOST_ENGINE = previous;
  }
});

test.serial("poisons the client when the versioned handshake is rejected", async () => {
  const binary = resolve(import.meta.dir, "../support/rejectedHelloEngine.ts");
  const previous = process.env.BLUPOST_ENGINE;
  process.env.BLUPOST_ENGINE = binary;
  const client = createEngineClient();
  try {
    await expect(client.start()).rejects.toThrow("synthetic hello rejection");
    await expect(client.connect()).rejects.toThrow("synthetic hello rejection");
  } finally {
    await client.stop();
    if (previous === undefined) delete process.env.BLUPOST_ENGINE;
    else process.env.BLUPOST_ENGINE = previous;
  }
});
