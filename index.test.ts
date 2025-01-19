import { spawn } from "child_process";
import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

describe("prettierls", () => {
  const fileUri = "file://test.js";
  const fileText = "const a = 1  ;";
  const updatedFileText = "const a = 1 , b=2;";

  let client: MessageConnection;
  beforeEach(() => {
    client = runClient();
  });

  afterEach(async () => {
    await sendClose(client, fileUri);
    client.end();
  });

  it("should return no edits if file was not opened", async () => {
    const result = await sendFormat(client, fileUri);

    expect(result).toEqual([]);
  });

  it("should reformat file", async () => {
    await sendOpen(client, fileUri, fileText);
    const result = await sendFormat(client, fileUri);

    expect(result).toEqual([
      {
        newText: "const a = 1;\n",
        range: {
          start: {
            line: 0,
            character: 0,
          },
          end: {
            line: 1,
            character: 0,
          },
        },
      },
    ]);
  });

  it("should reformat file even if it was updated", async () => {
    await sendOpen(client, fileUri, fileText);
    const result = await sendFormat(client, fileUri);

    expect(result).toEqual([
      {
        newText: "const a = 1;\n",
        range: {
          start: {
            line: 0,
            character: 0,
          },
          end: {
            line: 1,
            character: 0,
          },
        },
      },
    ]);

    await sendChange(client, fileUri, updatedFileText);
    const result2 = await sendFormat(client, fileUri);

    expect(result2).toEqual([
      {
        newText: "const a = 1,\n  b = 2;\n",
        range: {
          start: {
            line: 0,
            character: 0,
          },
          end: {
            line: 1,
            character: 0,
          },
        },
      },
    ]);
  });
});

async function sendOpen(rpc: MessageConnection, uri: string, text: string) {
  await Promise.all([
    rpc.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "javascript",
        text,
        version: 1,
      },
    }),
    new Promise<void>((resolve) => {
      const disposable = rpc.onNotification("prettier/loaded", () => {
        disposable.dispose();
        resolve();
      });
    }),
  ]);
}

function sendChange(rpc: MessageConnection, uri: string, text: string) {
  return rpc.sendNotification("textDocument/didChange", {
    textDocument: {
      uri,
      version: 1,
    },
    contentChanges: [
      {
        text,
      },
    ],
  });
}

function sendFormat(rpc: MessageConnection, uri: string) {
  return rpc.sendRequest("textDocument/formatting", {
    textDocument: {
      uri,
    },
    options: {
      tabSize: 2,
      insertSpaces: true,
    },
  });
}

function sendClose(rpc: MessageConnection, uri: string) {
  return rpc.sendNotification("textDocument/didClose", {
    textDocument: {
      uri,
    },
  });
}

function runClient() {
  const process = spawn("bun", ["./bin/prettierls", "--stdio"], {
    stdio: "pipe",
  });

  const rpcClient = createMessageConnection(
    new StreamMessageReader(process.stdout),
    new StreamMessageWriter(process.stdin),
  );
  rpcClient.onUnhandledNotification((e) => {
    console.log("unhandled notification", e);
  });
  rpcClient.listen();

  return rpcClient;
}
