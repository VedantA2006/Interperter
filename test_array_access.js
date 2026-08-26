const fs = require('fs');
const { Lexer } = require('./src/lib/pine/lexer.ts');
const { Parser } = require('./src/lib/pine/parser.ts');
const { Interpreter } = require('./src/lib/pine/interpreter.ts');

const bars = [];
for (let i = 0; i < 15; i++) {
  let o = 100, h = 110, l = 90, c = 105;
  if (i === 11) { h = 80; }
  if (i === 13) { h = 120; l = 85; }
  bars.push({ time: i, open: o, high: h, low: l, close: c, volume: 1000 });
}

let code = "x = high[2]";
const lexer = new Lexer(code);
const parser = new Parser(lexer);
const ast = parser.parseProgram();

const interpreter = new Interpreter(ast, bars, {});
const env = interpreter.runBar(13);
console.log("high[2] =", env.get('x'));
