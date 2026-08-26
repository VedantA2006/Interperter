import { Lexer } from './src/lib/pine/lexer';
import { Parser } from './src/lib/pine/parser';

const code = "var test = 10\nr_color = color.new(#26a69a, 0) : mR < 0 ? color.new(#ef5350, 0) : color.new(#26a69a, 0)\nlabel.new(x, y, str.tostring(mR, \\\"#.##\\\") + \\\"%\\\", text_color=color.white, text_size=size.small)";

const lexer = new Lexer(code);
const parser = new Parser(lexer);
parser.parseProgram();
console.log("Errors:", parser.errors);
