import { createRequire } from "module";
import {
  createConnection,
  Position,
  ProposedFeatures,
  Range,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import type * as PrettierModule from "prettier";
import { TextDocument } from "vscode-languageserver-textdocument";

const prettierCache: Map<string, typeof PrettierModule> = new Map();
const prettierConfigCache: Map<string, PrettierModule.Config> = new Map();

const require = createRequire(import.meta.url);
export function run() {
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  connection.onInitialize(() => {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        documentFormattingProvider: true,
      },
    };
  });

  documents.onDidOpen(async (params) => {
    if (!prettierCache.has(params.document.uri)) {
      const prettierPath = require.resolve("prettier", {
        paths: [params.document.uri.replace(/^file:\/\//g, "")],
      });
      const prettier: typeof PrettierModule = require(prettierPath);
      prettierCache.set(params.document.uri, prettier);

      const prettierConfig = await prettier.resolveConfig(params.document.uri, {
        useCache: false,
        editorconfig: true,
      });
      prettierConfigCache.set(params.document.uri, prettierConfig ?? {});
    }

    await connection.sendNotification("prettier/loaded");
  });

  connection.onDocumentFormatting(async (params) => {
    const prettier = prettierCache.get(params.textDocument.uri);
    if (!prettier) {
      return [];
    }

    const prettierConfig = prettierConfigCache.get(params.textDocument.uri)!;
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    const newText = await prettier.format(document.getText(), {
      ...prettierConfig,
      filepath: params.textDocument.uri,
    });

    return [
      {
        newText,
        range: Range.create(
          Position.create(0, 0),
          Position.create(document.lineCount, 0),
        ),
      },
    ];
  });

  documents.onDidClose((params) => {
    prettierCache.delete(params.document.uri);
    prettierConfigCache.delete(params.document.uri);
  });

  documents.listen(connection);
  connection.listen();
}
