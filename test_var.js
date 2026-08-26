const { Lexer } = require('./src/lib/pine/lexer.ts');
const { Parser } = require('./src/lib/pine/parser.ts');
const code = 'var float[] sslLvls = array.new_float()';
const lexer = new Lexer(code);
const parser = new Parser(lexer);
console.log(JSON.stringify(parser.parseProgram(), null, 2));
