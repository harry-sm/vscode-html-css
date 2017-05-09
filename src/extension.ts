'use strict';

// (c) 2016-2017 Ecmel Ercan

import * as vsc from 'vscode';
import * as lst from 'vscode-languageserver-types';
import * as css from 'vscode-css-languageservice';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

let service = css.getCSSLanguageService();
let map: { [index: string]: vsc.CompletionItem[]; } = {};
let regex = /[\.\#]([\w-]+)/g;
let dot = vsc.CompletionItemKind.Class;
let hash = vsc.CompletionItemKind.Reference;

class Snippet {

  private _document: lst.TextDocument;
  private _stylesheet: css.Stylesheet;
  private _position: lst.Position;

  constructor(content: string, character?: number) {
    this._document = lst.TextDocument.create('', 'css', 1, content);
    this._stylesheet = service.parseStylesheet(this._document);
    this._position = new vsc.Position(this._document.lineCount - 1, character ? character : 0);
  }

  public get document(): lst.TextDocument {
    return this._document;
  }

  public get stylesheet(): css.Stylesheet {
    return this._stylesheet;
  }

  public get position(): lst.Position {
    return this._position;
  }
}

class ClassServer implements vsc.CompletionItemProvider {

  private regex = [
    /(class|id)=["|']([^"^']*$)/i,
    /(\.|\#)[^\.^\#^\<^\>]*$/i,
    /<style[\s\S]*>([\s\S]*)<\/style>/ig
  ];

  provideCompletionItems(document: vsc.TextDocument, position: vsc.Position, token: vsc.CancellationToken): vsc.CompletionList {
    let start = new vsc.Position(0, 0);
    let range = new vsc.Range(start, position);
    let text = document.getText(range);

    let tag = this.regex[0].exec(text);
    if (!tag) {
      tag = this.regex[1].exec(text);
    }
    if (tag) {
      let internal: lst.SymbolInformation[] = [];
      let style;
      while (style = this.regex[2].exec(document.getText())) {
        let snippet = new Snippet(style[1]);
        let symbols = service.findDocumentSymbols(snippet.document, snippet.stylesheet);
        for (let symbol of symbols) {
          internal.push(symbol);
        }
      }
      pushSymbols('style', internal);

      let items: { [index: string]: vsc.CompletionItem; } = {};
      for (let key in map) {
        for (let item of map[key]) {
          items[item.label] = item;
        }
      }

      let id = tag[0].startsWith('id') || tag[0].startsWith('#');
      let ci: vsc.CompletionItem[] = [];
      for (let item in items) {
        if ((id && items[item].kind === hash) || !id && items[item].kind === dot) {
          ci.push(items[item]);
        }
      }
      return new vsc.CompletionList(ci);
    }
    return null;
  }

  resolveCompletionItem(item: vsc.CompletionItem, token: vsc.CancellationToken): vsc.CompletionItem {
    return null;
  }
}

function pushSymbols(key: string, symbols: lst.SymbolInformation[]): void {
  let ci: vsc.CompletionItem[] = [];
  for (let i = 0; i < symbols.length; i++) {
    if (symbols[i].kind !== 5) {
      continue;
    }
    let symbol;
    while (symbol = regex.exec(symbols[i].name)) {
      let item = new vsc.CompletionItem(symbol[1]);
      item.kind = symbol[0].startsWith('.') ? dot : hash;
      item.detail = path.basename(key);
      ci.push(item);
    }
  }
  map[key] = ci;
}

function parse(uri: vsc.Uri): void {
  fs.readFile(uri.fsPath, 'utf8', function (err: any, data: string) {
    if (err) {
      delete map[uri.fsPath];
    } else {
      let doc = lst.TextDocument.create(uri.fsPath, 'css', 1, data);
      let symbols = service.findDocumentSymbols(doc, service.parseStylesheet(doc));
      pushSymbols(uri.fsPath, symbols);
    }
  });
}

function parseRemote(url: string) {
  https.get(url, res => {
    let styles = '';
    res.on('data', d => {
      styles += d.toString();
    }).on('end', () => {
      let doc = lst.TextDocument.create(url, 'css', 1, styles);
      let symbols = service.findDocumentSymbols(doc, service.parseStylesheet(doc));
      pushSymbols(url, symbols);
    });
  })
}

function parseRemoteConfig() {
  let remoteCssConfig = vsc.workspace.getConfiguration('css');
  let urls = remoteCssConfig.get('remoteStyleSheets') as string[];
  urls.forEach((url) => parseRemote(url));
}

export function activate(context: vsc.ExtensionContext) {

  if (vsc.workspace.rootPath) {

    let glob = '**/*.css';

    vsc.workspace.findFiles(glob, '').then(function (uris: vsc.Uri[]) {
      for (let i = 0; i < uris.length; i++) {
        parse(uris[i]);
      }
    });

    parseRemoteConfig();

    let watcher = vsc.workspace.createFileSystemWatcher(glob);

    watcher.onDidCreate(function (uri: vsc.Uri) {
      parse(uri);
    });
    watcher.onDidChange(function (uri: vsc.Uri) {
      parse(uri);
    });
    watcher.onDidDelete(function (uri: vsc.Uri) {
      delete map[uri.fsPath];
    });

    context.subscriptions.push(watcher);
  };

  let classServer = new ClassServer();

  context.subscriptions.push(vsc.languages.registerCompletionItemProvider([
    'html',
    'laravel-blade',
    'razor',
    'vue',
    'blade',
    'pug',
    'jade',
    'handlebars',
    'php',
    'twig'
  ], classServer));

  let wp = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\.\"\,\<\>\/\?\s]+)/g;

  context.subscriptions.push(vsc.languages.setLanguageConfiguration('laravel-blade', { wordPattern: wp }));
  context.subscriptions.push(vsc.languages.setLanguageConfiguration('razor', { wordPattern: wp }));
  context.subscriptions.push(vsc.languages.setLanguageConfiguration('vue', { wordPattern: wp }));
  context.subscriptions.push(vsc.languages.setLanguageConfiguration('blade', { wordPattern: wp }));
  context.subscriptions.push(vsc.languages.setLanguageConfiguration('pug', { wordPattern: wp }));
  context.subscriptions.push(vsc.languages.setLanguageConfiguration('jade', { wordPattern: wp }));
  context.subscriptions.push(vsc.languages.setLanguageConfiguration('handlebars', { wordPattern: wp }));
  context.subscriptions.push(vsc.languages.setLanguageConfiguration('php', { wordPattern: wp }));
  context.subscriptions.push(vsc.languages.setLanguageConfiguration('twig', { wordPattern: wp }));

  context.subscriptions.push(vsc.workspace.onDidChangeConfiguration((e) => parseRemoteConfig()));
}

export function deactivate() {
}
