const fs = require('fs');
const { Lexer } = require('./src/lib/pine/lexer.ts');
const { Parser } = require('./src/lib/pine/parser.ts');

let code = 'bullFVG = low > high[2]';
const lexer = new Lexer(code);
const parser = new Parser(lexer);
const ast = parser.parseProgram();
console.log(JSON.stringify(ast, null, 2));
