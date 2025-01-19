import { createRequire } from "module";
import {
  createConnection,
  Position,
  ProposedFeatures,
  Range,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import type * as PrettierModule from "prettier";

const prettierCache: Map<string, typeof PrettierModule> = new Map();
const prettierConfigCache: Map<string, PrettierModule.Config> = new Map();
const fileContent = new Map<
  string,
  { text: string; lineCount: number; lastColumn: number }
>();

const require = createRequire(import.meta.url);
export function run() {
  const connection = createConnection(ProposedFeatures.all);

  connection.onInitialize(() => {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        documentFormattingProvider: true,
      },
    };
  });

  connection.onDidOpenTextDocument(async (params) => {
    if (!prettierCache.has(params.textDocument.uri)) {
      const prettier: typeof PrettierModule = require("prettier");
      prettierCache.set(params.textDocument.uri, prettier);

      const prettierConfig = await prettier.resolveConfig(
        params.textDocument.uri,
        {
          useCache: false,
          editorconfig: true,
        },
      );
      prettierConfigCache.set(params.textDocument.uri, prettierConfig ?? {});
    }

    fileContent.set(params.textDocument.uri, {
      text: params.textDocument.text,
      lineCount: params.textDocument.text.split("\n").length,
      lastColumn: params.textDocument.text.length,
    });
    await connection.sendNotification("prettier/loaded");
    console.log("loaded prettier");
  });

  connection.onDidChangeTextDocument(async (params) => {
    let lastLine = 0;
    let lastColumn = 0;

    for (const line of params.contentChanges[0].text.split("\n")) {
      lastLine++;
      lastColumn = line.length;
    }
    fileContent.set(params.textDocument.uri, {
      text: params.contentChanges[0].text,
      lineCount: lastLine,
      lastColumn,
    });
  });

  connection.onDocumentFormatting(async (params) => {
    const prettier = prettierCache.get(params.textDocument.uri);
    if (!prettier) {
      return [];
    }

    const prettierConfig = prettierConfigCache.get(params.textDocument.uri)!;
    const content = fileContent.get(params.textDocument.uri);

    if (!content) {
      return [];
    }

    const newText = await prettier.format(content.text, {
      ...prettierConfig,
      filepath: params.textDocument.uri,
    });

    return [
      {
        newText,
        range: Range.create(
          Position.create(0, 0),
          Position.create(content.lineCount, content.lastColumn),
        ),
      },
    ];
  });

  connection.onDidCloseTextDocument((params) => {
    prettierCache.delete(params.textDocument.uri);
    prettierConfigCache.delete(params.textDocument.uri);
    fileContent.delete(params.textDocument.uri);
  });

  connection.listen();
}
