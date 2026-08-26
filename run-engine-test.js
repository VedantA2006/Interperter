"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
var lexer_1 = require("./src/lib/pine/lexer");
var parser_1 = require("./src/lib/pine/parser");
var interpreter_1 = require("./src/lib/pine/interpreter");
var dbPath = path_1.default.join(process.cwd(), 'local_db.json');
var dbRaw = fs_1.default.readFileSync(dbPath, 'utf8');
var db = JSON.parse(dbRaw);
var code = db.strategyVersions[0].sourceCode;
var lexer = new lexer_1.Lexer(code);
var parser = new parser_1.Parser(lexer);
var program = parser.parseProgram();
var bars = [
    { time: 1000, open: 1, high: 2, low: 0, close: 1.5, volume: 100 },
    { time: 2000, open: 1.5, high: 2.5, low: 0.5, close: 2.0, volume: 100 },
    { time: 3000, open: 2.0, high: 3.0, low: 1.0, close: 2.5, volume: 100 },
    { time: 4000, open: 2.5, high: 3.5, low: 1.5, close: 1.0, volume: 100 },
];
var stratCtx = {
    position_size: 0,
    entry: function (id) { return console.log('ENTRY', id); },
    close: function (id) { return console.log('CLOSE', id); },
    exit: function (id) { return console.log('EXIT', id); },
    cancel: function (id) { return console.log('CANCEL', id); }
};
var interpreter = new interpreter_1.Interpreter(program, bars, stratCtx);
for (var i = 0; i < bars.length; i++) {
    interpreter.runBar(i);
    console.log('Ran bar', i);
}
console.log('Success!');
