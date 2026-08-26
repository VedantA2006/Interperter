import { Lexer } from './src/lib/pine/lexer';
import { Parser } from './src/lib/pine/parser';

const code = `
fast = ta.sma(close, 10)
slow = ta.sma(close, 30)

r_color = mR > 0 ? color.new(#26a69a, 0) : mR < 0 ? color.new(#ef5350, 0) : color.new(#26a69a, 0)
label.new(x, y, str.tostring(mR, "#.##") + "R", text_color=color.white, text_size=size.small)
`;

const lexer = new Lexer(code);
const parser = new Parser(lexer);
parser.parseProgram();

console.log("Parser Errors:");
if (parser.errors.length === 0) {
  console.log("NO ERRORS!");
} else {
  parser.errors.forEach(e => console.log(e));
}
