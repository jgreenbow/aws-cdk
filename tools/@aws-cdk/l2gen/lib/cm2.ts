import * as fs from 'fs-extra';
import { existingType } from "./type";
import { SourceFile, ISourceModule } from './source-module';

// Missing from upstream CodeMaker
// - In-memory generation
// - Looking at current file
// - Distinguishing setup from code (deduping setup code like imports)
// - Block always indents
// - Need to be able to write partial lines (for rendering object literals)

export type CodePart = string | IRenderable;

export class CM2 {
  public readonly currentModule: SourceFile;

  private readonly buffer: WriteBuffer;
  private readonly indents = new Array<string>();
  private readonly helpers = new Map<string, IHelper>();

  constructor(public readonly fileName: string) {
    this.currentModule = new SourceFile(fileName);
    this.buffer = new WriteBuffer();
  }

  public render() {
    return [
      ...this.renderHelpers('top'),
      this.buffer.render(),
      ...this.renderHelpers('bottom'),
    ].join('')
  }

  public save() {
    fs.writeFileSync(this.fileName, this.render());
  }

  public add(...xs: Array<CodePart>) {
    for (const x of xs) {
      if (typeof x === 'string') {
        this.write(x);
      } else {
        x.render(this);
      }
    }
  }

  public line(...xs: Array<CodePart>) {
    this.add(...xs, '\n');
  }

  public write(x: string) {
    // FIXME: Write the indent only if followed by non-whitespace, otherwise we will not be able to unindent
    // correctly.

    this.buffer?.write(x.replace(/\n/g, `\n${this.currentIndent}`));
  }

  public addHelper(helper: IHelper) {
    this.helpers.set(helper.identifier, helper);
  }

  public openBlock(...xs: CodePart[]) {
    this.add(...xs, ' {');
    this.indent('  ');
    this.write('\n');
  }

  public closeBlock() {
    this.unindent();
    this.line('}');
  }

  public docBlock(lines: string[]) {
    const flat = lines.flatMap(l => l.split('\n'));

    let i = 0;
    while (i < flat.length) {
      if (flat[i] === '' && (
        (i === 0 || i === flat.length - 1 || (i < flat.length - 1 && flat[i + 1] === '')))) {
        flat.splice(i, 1);
      } else {
        i += 1;
      }
    }

    this.line('/**');
    for (const l of flat) {
      this.line(` * ${l}`);
    }
    this.line(' */');
  }

  public typeInThisFile(name: string) {
    return existingType(name, this.currentModule);
  }

  public indent(add: string) {
    this.indents.push(add);
  }

  public unindent() {
    this.indents.pop();
  }

  private get currentIndent() {
    return this.indents.join('');
  }

  private renderHelpers(where: IHelper['position']): string[] {
    const hs = Array.from(this.helpers.values()).filter(h => h.position === where);
    if (hs.length === 0) { return []; }

    const f = new CM2(this.fileName);
    for (const helper of hs) {
      helper.render(f);
    }

    return [f.render()];
  }
}

export interface IRenderable {
  render(code: CM2): void;
}

class WriteBuffer {
  private readonly parts = new Array<string>();

  constructor() {
  }

  public prepend(x: string) {
    this.parts.unshift(x);
  }

  public write(x: string) {
    this.parts.push(x);
  }

  public render() {
    return this.parts.join('');
  }
}

export interface IHelper extends IRenderable {
  readonly position: 'top' | 'bottom';
  readonly identifier: string;
}

export class SymbolImport implements IHelper {
  public readonly position = 'top';
  public readonly identifier: string;

  constructor(public readonly symbolName: string, public readonly module: ISourceModule) {
    this.identifier = `${module.identifier}.${symbolName}`;
  }

  public render(code: CM2) {
    code.add(`import { ${this.symbolName} } from '${this.module.importName(code)}';`);
  }
}

export class HelperFunction implements IHelper {
  public readonly position = 'bottom';
  public readonly identifier: string;

  constructor(public readonly functionName: string, private readonly block: (x: CM2) => void) {
    this.identifier = functionName;
  }

  public render(code: CM2) {
    this.block(code);
  }
}