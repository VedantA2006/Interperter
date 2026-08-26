const { Lexer } = require('./src/lib/pine/lexer.ts');
const { Parser } = require('./src/lib/pine/parser.ts');
const { Interpreter } = require('./src/lib/pine/interpreter.ts');

const code = 'x = lookLong and (bar_index - setupBarL) > expireBars';
const lexer = new Lexer(code);
const parser = new Parser(lexer);
console.log(JSON.stringify(parser.parseProgram(), null, 2));
