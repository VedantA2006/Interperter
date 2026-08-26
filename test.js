const { Lexer } = require('./src/lib/pine/lexer.js') || {};
const { Parser } = require('./src/lib/pine/parser.js') || {};

// Wait, I can't require TS files directly. I will just copy the lexer and parser classes into a standalone JS script to test!
