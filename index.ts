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
import {
  TextDocument,
  type TextDocumentContentChangeEvent,
  type TextEdit,
} from "vscode-languageserver-textdocument";

const prettierCache: Map<string, typeof PrettierModule> = new Map();

interface FormattedTextDocument extends TextDocument {
  config: Promise<PrettierModule.Config | null>;
  formatted: Promise<string>;
}

const FormattedTextDocument = {
  create(uri: string, languageId: string, version: number, text: string) {
    const document = TextDocument.create(
      uri,
      languageId,
      version,
      text,
    ) as FormattedTextDocument;

    const prettier: typeof PrettierModule = require("prettier");
    prettierCache.set(uri, prettier);

    const prettierConfigPromise = prettier.resolveConfig(uri, {
      useCache: false,
      editorconfig: true,
    });

    document.config = prettierConfigPromise;
    document.formatted = prettierConfigPromise.then((config) =>
      prettier.format(text, {
        ...(config ?? {}),
        filepath: uri,
      }),
    );
    return document;
  },
  update(
    document: FormattedTextDocument,
    changes: TextDocumentContentChangeEvent[],
    version: number,
  ) {
    const newDocument = TextDocument.update(
      document,
      changes,
      version,
    ) as FormattedTextDocument;

    const prettier = prettierCache.get(newDocument.uri);
    if (prettier) {
      newDocument.formatted = newDocument.config.then((config) =>
        prettier.format(newDocument.getText(), {
          ...(config ?? {}),
          filepath: newDocument.uri,
        }),
      );
    }

    return newDocument;
  },
  applyEdits(document: FormattedTextDocument, edits: TextEdit[]) {
    return TextDocument.applyEdits(document, edits);
  },
};

const require = createRequire(import.meta.url);
export function run() {
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments<FormattedTextDocument>(
    FormattedTextDocument,
  );

  connection.onInitialize(() => {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        documentFormattingProvider: true,
      },
    };
  });

  documents.onDidOpen(async (params) => {
    const document = documents.get(params.document.uri);
    if (!document) {
      return;
    }

    await document.config;
    await connection.sendNotification("prettier/loaded");
  });

  connection.onDocumentFormatting(async (params) => {
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return [];
    }

    return [
      {
        newText: await document.formatted,
        range: Range.create(
          Position.create(0, 0),
          Position.create(document.lineCount, 0),
        ),
      },
    ];
  });

  documents.onDidClose((params) => {
    prettierCache.delete(params.document.uri);
  });

  documents.listen(connection);
  connection.listen();
}
