# SACP TypeScript MVP Implementation Plan

This document outlines the implementation tasks for the SACP TypeScript MVP as described in [design.md](design.md).

## Project Setup

- [x] Initialize TypeScript project with `package.json`
- [x] Configure TypeScript (`tsconfig.json`)
- [x] Add `@agentclientprotocol/sdk` as a dependency
- [x] Set up project directory structure (`src/`, `test/`)

## sacp-ts Core Library

### Types and Interfaces

- [x] Define MCP-over-ACP message types (`McpConnectRequest`, `McpOverAcpMessage`, `McpDisconnectNotification`, etc.)
- [x] Define `McpServer` interface
- [x] Define `McpServerConfig` type for session requests
- [x] Define `McpContext` type for tool handlers
- [x] Define `ActiveSession` interface and `SessionMessage` type

### McpServerBuilder

- [x] Implement `McpServerBuilder` class
- [x] Implement `instructions()` method
- [x] Implement `tool()` method with schema and handler registration
- [x] Implement `build()` method that returns an `McpServer`
- [x] Generate unique IDs for MCP servers

### McpServer

- [x] Implement `McpServer` class
- [x] Implement `handleMessage()` to dispatch to registered tool handlers
- [x] Implement `acpUrl` getter to return `acp:` URL
- [x] Implement `toSessionConfig()` to generate session config

### McpOverAcpHandler

- [x] Implement `McpOverAcpHandler` class
- [x] Implement `register()` to register MCP servers by connection ID
- [x] Implement `handleConnect()` for `_mcp/connect` requests
- [x] Implement `handleMessage()` for `_mcp/message` requests
- [x] Implement `handleDisconnect()` for `_mcp/disconnect` notifications
- [x] Wire handler to intercept ACP client requests

### SessionBuilder

- [x] Implement `SessionBuilder` class
- [x] Implement `withMcpServer()` to attach MCP servers
- [x] Implement `cwd()` to set working directory
- [x] Implement `run()` to start session and execute callback

### ActiveSession

- [x] Implement `ActiveSession` class
- [x] Implement `sendPrompt()` to send prompts to the agent
- [x] Implement `readUpdate()` to read next update from agent
- [x] Implement `readToString()` to read all updates until completion

## patchwork-ts Library

### Patchwork Entry Point

- [x] Implement `connect()` function to spawn conductor and establish ACP connection
- [x] Implement `Patchwork` class with `think()` method

### ThinkBuilder

- [x] Implement `ThinkBuilder` class
- [x] Implement `text()` method for adding literal text
- [x] Implement `textln()` method for adding text with newline
- [x] Implement `display()` method for interpolating values
- [x] Implement `tool()` method to register a tool and reference it in the prompt
- [x] Implement `defineTool()` method to register a tool without prompt reference
- [x] Implement `run()` method to execute the prompt and return result
- [x] Implement automatic `return_result` tool generation from `Output` type parameter
- [ ] Implement JSON schema generation for output types

## Integration

- [x] Integrate `McpOverAcpHandler` with ACP SDK's `ClientSideConnection`
- [x] Implement stdio transport layer for conductor communication
- [x] Handle message routing between ACP client and MCP servers

## Testing

- [x] Write unit tests for `McpServerBuilder`
- [x] Write unit tests for `McpServer` message handling
- [x] Write unit tests for `McpOverAcpHandler`
- [x] Write unit tests for `ThinkBuilder` prompt composition
- [x] Write integration test with conductor and a mock agent
