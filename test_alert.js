const fs = require('fs');
const { Lexer } = require('./src/lib/pine/lexer.ts');
const { Parser } = require('./src/lib/pine/parser.ts');
const { Interpreter } = require('./src/lib/pine/interpreter.ts');

let code = "alert('{\"action\":\"buy\"}', alert.freq_once_per_bar)";
const lexer = new Lexer(code);
const parser = new Parser(lexer);
const ast = parser.parseProgram();

let warns = [];
const strategyCtx = {
  position_size: 0,
  entry: (id, dir) => warns.push('entry: ' + dir),
  close: () => {},
  exit: () => {},
  cancel: () => {}
};
const interpreter = new Interpreter(ast, [{time:0, open:0, high:0, low:0, close:0, volume:0}], strategyCtx);
interpreter.runBar(0);
console.log('Result:', warns);
