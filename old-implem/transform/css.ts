// CSS/SCSS source tracking - resolves browser CSS locations back to source files
// using postcss and source maps

export interface CssSourceLocation {
  file: string;
  line: number;
  column: number;
}

export function resolveCssSource(
  cssFile: string,
  line: number,
  sourceMap?: string
): CssSourceLocation | null {
  // TODO: Parse source map to resolve SCSS → CSS mapping
  return { file: cssFile, line, column: 0 };
}
