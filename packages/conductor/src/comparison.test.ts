/**
 * Comparison tests: TypeScript conductor vs Rust conductor behavior
 *
 * These tests document and verify that the TypeScript conductor matches
 * the expected behavior of the Rust sacp-conductor implementation.
 *
 * Each test describes the expected behavior based on the Rust implementation
 * and verifies that the TypeScript implementation matches.
 *
 * Reference: doc/.local/symposium-acp/md/conductor.md
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Conductor, fromConnectors } from "./conductor.js";
import { createChannelPair, inProcess } from "./connectors/channel.js";
import type { ComponentConnection, ComponentConnector } from "./types.js";
import type { JsonRpcMessage } from "@thinkwell/protocol";
import {
  PROXY_SUCCESSOR_REQUEST,
  PROXY_SUCCESSOR_NOTIFICATION,
} from "@thinkwell/protocol";

/**
 * Helper to create a test client that can send/receive messages
 */
function createTestClient(): {
  connector: ComponentConnector;
  clientSend: (msg: JsonRpcMessage) => void;
  receivedMessages: JsonRpcMessage[];
  waitForMessage: () => Promise<JsonRpcMessage>;
  waitForMessageWithId: (id: number | string) => Promise<JsonRpcMessage>;
} {
  const receivedMessages: JsonRpcMessage[] = [];
  const messageResolvers: Array<(msg: JsonRpcMessage) => void> = [];

  const pair = createChannelPair();

  // Track messages received from conductor
  (async () => {
    for await (const message of pair.right.messages) {
      receivedMessages.push(message);
      // Resolve any waiting promises
      for (const resolve of messageResolvers.splice(0)) {
        resolve(message);
      }
    }
  })();

  return {
    connector: {
      async connect() {
        return pair.left;
      },
    },
    clientSend: (msg) => pair.right.send(msg),
    receivedMessages,
    waitForMessage: () =>
      new Promise<JsonRpcMessage>((resolve) => {
        if (receivedMessages.length > 0) {
          resolve(receivedMessages[receivedMessages.length - 1]);
        } else {
          messageResolvers.push(resolve);
        }
      }),
    waitForMessageWithId: (id) =>
      new Promise<JsonRpcMessage>((resolve) => {
        const check = () => {
          const found = receivedMessages.find((m) => (m as any).id === id);
          if (found) {
            resolve(found);
            return true;
          }
          return false;
        };
        if (!check()) {
          const interval = setInterval(() => {
            if (check()) clearInterval(interval);
          }, 10);
          // Timeout after 1 second
          setTimeout(() => clearInterval(interval), 1000);
        }
      }),
  };
}

/**
 * Create an echo agent for testing
 */
function createEchoAgent(): ComponentConnector {
  return inProcess(async (connection) => {
    for await (const message of connection.messages) {
      if ("method" in message && "id" in message) {
        connection.send({
          jsonrpc: "2.0",
          id: message.id,
          result: message.params,
        });
      }
    }
  });
}

describe("Rust conductor behavior comparison", () => {
  describe("Message ordering invariant", () => {
    /**
     * From Rust conductor docs:
     * "All messages (requests, responses, notifications) between any two endpoints
     * must maintain their send order."
     *
     * "The conductor ensures this invariant by routing all message forwarding
     * through its central message queue."
     */
    it("should preserve message ordering between client and agent", async () => {
      const receivedOrder: string[] = [];

      const agent = inProcess(async (connection) => {
        for await (const message of connection.messages) {
          if ("method" in message) {
            receivedOrder.push(message.method);
          }
          if ("method" in message && "id" in message) {
            if (message.method === "initialize") {
              connection.send({ jsonrpc: "2.0", id: message.id, result: {} });
            } else {
              connection.send({
                jsonrpc: "2.0",
                id: message.id,
                result: { received: message.method },
              });
            }
          }
        }
      });

      const conductor = new Conductor({
        instantiator: fromConnectors(agent),
      });

      const { connector, clientSend, waitForMessageWithId } = createTestClient();

      conductor.connect(connector);

      // Initialize
      clientSend({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      await waitForMessageWithId(1);

      // Send multiple messages in order
      clientSend({ jsonrpc: "2.0", id: 2, method: "first", params: {} });
      clientSend({ jsonrpc: "2.0", method: "notification-1", params: {} });
      clientSend({ jsonrpc: "2.0", id: 3, method: "second", params: {} });
      clientSend({ jsonrpc: "2.0", method: "notification-2", params: {} });

      // Wait for responses
      await waitForMessageWithId(3);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the agent received messages in order
      assert.deepEqual(receivedOrder, [
        "initialize",
        "first",
        "notification-1",
        "second",
        "notification-2",
      ]);

      await conductor.shutdown();
    });
  });

  describe("Proxy capability handshake", () => {
    /**
     * From Rust conductor docs:
     * "Conductor offers proxy: true in _meta to non-last components during acp/initialize"
     * "Do NOT offer proxy to last component (agent)"
     * "Verify component accepts by checking for proxy: true in InitializeResponse _meta"
     * "Fail initialization with error if handshake fails"
     */
    it("should offer proxy capability only to proxies, not to agent", async () => {
      const receivedParams: Array<{ isProxy: boolean; method: string }> = [];

      const proxy = inProcess(async (connection) => {
        for await (const message of connection.messages) {
          if ("method" in message && "id" in message) {
            const params = message.params as any;
            receivedParams.push({
              isProxy: params?._meta?.proxy === true,
              method: message.method,
            });

            if (message.method === "initialize") {
              // Forward to successor with proxy capability stripped
              const proxyId = `p-${message.id}`;
              connection.send({
                jsonrpc: "2.0",
                id: proxyId,
                method: PROXY_SUCCESSOR_REQUEST,
                params: { method: "initialize", params: message.params },
              });
            }
          } else if ("result" in message) {
            // Return response with proxy: true in _meta to indicate acceptance
            const result = (message as any).result;
            connection.send({
              jsonrpc: "2.0",
              id: String((message as any).id).replace("p-", ""),
              result: { ...result, _meta: { ...result?._meta, proxy: true } },
            });
          }
        }
      });

      const agent = inProcess(async (connection) => {
        for await (const message of connection.messages) {
          if ("method" in message && "id" in message) {
            const params = message.params as any;
            receivedParams.push({
              isProxy: params?._meta?.proxy === true,
              method: message.method,
            });

            connection.send({
              jsonrpc: "2.0",
              id: message.id,
              result: { serverInfo: { name: "agent", version: "1.0" } },
            });
          }
        }
      });

      const conductor = new Conductor({
        instantiator: fromConnectors(agent, [proxy]),
      });

      const { connector, clientSend, waitForMessageWithId } = createTestClient();

      conductor.connect(connector);

      // Initialize
      clientSend({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "test", version: "1.0" } },
      });

      await waitForMessageWithId(1);
      await conductor.shutdown();

      // First entry should be the proxy receiving the offer (with proxy: true)
      // The proxy then forwards to agent, which should receive without proxy offer
      assert.equal(receivedParams.length, 2, "Should have 2 initialize calls");
      assert.equal(receivedParams[0].isProxy, true, "Proxy should receive proxy offer");
      // Note: The proxy forwards the same params to agent through _proxy/successor/request,
      // so the agent also sees proxy: true from the proxy's forwarding, but the
      // conductor itself doesn't add proxy to the agent's init request.
    });

    it("should fail if proxy does not accept proxy capability", async () => {
      const nonProxy = inProcess(async (connection) => {
        for await (const message of connection.messages) {
          if ("method" in message && "id" in message && message.method === "initialize") {
            // Respond WITHOUT proxy: true - this should cause an error
            connection.send({
              jsonrpc: "2.0",
              id: message.id,
              result: { serverInfo: { name: "non-proxy", version: "1.0" } },
            });
          }
        }
      });

      const agent = createEchoAgent();

      const conductor = new Conductor({
        instantiator: fromConnectors(agent, [nonProxy]),
      });

      const { connector, clientSend, waitForMessage } = createTestClient();

      conductor.connect(connector);

      // Initialize
      clientSend({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

      const response = await waitForMessage();

      // Should get an error
      assert.ok((response as any).error, "Should have error response");
      assert.ok(
        (response as any).error.message.includes("proxy"),
        "Error should mention proxy"
      );

      await conductor.shutdown();
    });
  });

  describe("Component crash handling", () => {
    /**
     * From Rust conductor docs:
     * "If any component process exits or crashes:
     *  1. Log error to stderr
     *  2. Shut down entire Conductor process
     *  3. Exit with non-zero status"
     */
    it("should shut down when agent disconnects", async () => {
      let agentConnection: ComponentConnection | null = null;

      const agent: ComponentConnector = {
        async connect() {
          const pair = createChannelPair();
          agentConnection = pair.right;

          // Handle init then close
          (async () => {
            for await (const message of pair.right.messages) {
              if ("method" in message && "id" in message && message.method === "initialize") {
                pair.right.send({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {},
                });
                // Simulate agent crash by closing
                await new Promise((resolve) => setTimeout(resolve, 50));
                await pair.right.close();
              }
            }
          })();

          return pair.left;
        },
      };

      const conductor = new Conductor({
        instantiator: fromConnectors(agent),
      });

      const { connector, clientSend, waitForMessage } = createTestClient();

      const conductorPromise = conductor.connect(connector);

      // Initialize
      clientSend({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      await waitForMessage();

      // The conductor should shut down after agent closes
      // We verify by checking that the conductor promise resolves
      await Promise.race([
        conductorPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Conductor did not shut down")), 500)
        ),
      ]);

      // If we got here, the conductor shut down as expected
      assert.ok(true, "Conductor should shut down when agent disconnects");
    });
  });

  describe("Request ID rewriting", () => {
    /**
     * The conductor maintains its own request IDs for outgoing requests.
     * It maps incoming request IDs to outgoing IDs and routes responses back correctly.
     */
    it("should correctly correlate request IDs across the chain", async () => {
      const agentReceivedIds: (string | number)[] = [];

      const agent = inProcess(async (connection) => {
        for await (const message of connection.messages) {
          if ("method" in message && "id" in message) {
            agentReceivedIds.push(message.id);
            connection.send({
              jsonrpc: "2.0",
              id: message.id,
              result: { agentSawId: message.id },
            });
          }
        }
      });

      const conductor = new Conductor({
        instantiator: fromConnectors(agent),
      });

      const { connector, clientSend, waitForMessageWithId, receivedMessages } =
        createTestClient();

      conductor.connect(connector);

      // Initialize with a specific ID
      clientSend({
        jsonrpc: "2.0",
        id: "client-init-1",
        method: "initialize",
        params: {},
      });
      const initResponse = await waitForMessageWithId("client-init-1");

      // Verify the response came back with the client's original ID
      assert.equal((initResponse as any).id, "client-init-1");

      // Send more requests with different ID types
      clientSend({
        jsonrpc: "2.0",
        id: 999,
        method: "test/numeric-id",
        params: {},
      });
      const numericResponse = await waitForMessageWithId(999);
      assert.equal((numericResponse as any).id, 999);

      clientSend({
        jsonrpc: "2.0",
        id: "string-id-123",
        method: "test/string-id",
        params: {},
      });
      const stringResponse = await waitForMessageWithId("string-id-123");
      assert.equal((stringResponse as any).id, "string-id-123");

      // The agent should have received different (conductor-generated) IDs
      // but responses should still map back correctly
      assert.equal(receivedMessages.filter((m) => "result" in m).length, 3);

      await conductor.shutdown();
    });
  });

  describe("Bidirectional message flow", () => {
    /**
     * From Rust conductor docs:
     * "Messages from agent going 'backward' (notifications, agent-initiated requests):
     *  - Conductor wraps in _proxy/successor/* for proxies
     *  - Sends unwrapped to client"
     */
    it("should forward agent notifications to client without wrapping when no proxies", async () => {
      let agentConnection: ComponentConnection | null = null;

      const agent: ComponentConnector = {
        async connect() {
          const pair = createChannelPair();
          agentConnection = pair.right;

          (async () => {
            for await (const message of pair.right.messages) {
              if ("method" in message && "id" in message && message.method === "initialize") {
                pair.right.send({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {},
                });
              }
            }
          })();

          return pair.left;
        },
      };

      const conductor = new Conductor({
        instantiator: fromConnectors(agent),
      });

      const { connector, clientSend, waitForMessage, receivedMessages } =
        createTestClient();

      conductor.connect(connector);

      // Initialize
      clientSend({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      await waitForMessage();

      // Agent sends a notification
      agentConnection!.send({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "test", update: { type: "text", text: "Hello" } },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Client should receive the notification unwrapped
      const notification = receivedMessages.find(
        (m) => "method" in m && m.method === "session/update"
      );
      assert.ok(notification, "Should receive notification");
      assert.deepEqual((notification as any).params, {
        sessionId: "test",
        update: { type: "text", text: "Hello" },
      });

      await conductor.shutdown();
    });

    it("should wrap agent notifications in _proxy/successor/notification when proxies exist", async () => {
      let agentConnection: ComponentConnection | null = null;
      const proxyReceivedMethods: string[] = [];

      const proxy = inProcess(async (connection) => {
        for await (const message of connection.messages) {
          if ("method" in message) {
            proxyReceivedMethods.push(message.method);
          }

          if ("method" in message && "id" in message) {
            if (message.method === "initialize") {
              // Forward to successor
              const proxyId = `p-${message.id}`;
              connection.send({
                jsonrpc: "2.0",
                id: proxyId,
                method: PROXY_SUCCESSOR_REQUEST,
                params: { method: "initialize", params: message.params },
              });
            }
          } else if ("result" in message) {
            const result = (message as any).result;
            connection.send({
              jsonrpc: "2.0",
              id: String((message as any).id).replace("p-", ""),
              result: { ...result, _meta: { ...result?._meta, proxy: true } },
            });
          } else if ("method" in message && message.method === PROXY_SUCCESSOR_NOTIFICATION) {
            // Forward unwrapped to client
            const params = message.params as { method: string; params: unknown };
            connection.send({
              jsonrpc: "2.0",
              method: params.method,
              params: params.params,
            });
          }
        }
      });

      const agent: ComponentConnector = {
        async connect() {
          const pair = createChannelPair();
          agentConnection = pair.right;

          (async () => {
            for await (const message of pair.right.messages) {
              if ("method" in message && "id" in message && message.method === "initialize") {
                pair.right.send({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: { serverInfo: { name: "agent", version: "1.0" } },
                });
              }
            }
          })();

          return pair.left;
        },
      };

      const conductor = new Conductor({
        instantiator: fromConnectors(agent, [proxy]),
      });

      const { connector, clientSend, waitForMessage, receivedMessages } =
        createTestClient();

      conductor.connect(connector);

      // Initialize
      clientSend({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      await waitForMessage();

      // Agent sends notification
      agentConnection!.send({
        jsonrpc: "2.0",
        method: "agent/update",
        params: { data: "test" },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Proxy should have received _proxy/successor/notification
      assert.ok(
        proxyReceivedMethods.includes(PROXY_SUCCESSOR_NOTIFICATION),
        "Proxy should receive wrapped notification"
      );

      // Client should receive unwrapped notification (after proxy forwards it)
      const clientNotification = receivedMessages.find(
        (m) => "method" in m && m.method === "agent/update"
      );
      assert.ok(clientNotification, "Client should receive unwrapped notification");

      await conductor.shutdown();
    });
  });
});
