"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
var lexer_1 = require("./src/lib/pine/lexer");
var parser_1 = require("./src/lib/pine/parser");
var dbPath = path_1.default.join(process.cwd(), 'local_db.json');
var dbRaw = fs_1.default.readFileSync(dbPath, 'utf8');
var db = JSON.parse(dbRaw);
var code = db.strategyVersions[0].sourceCode;
var lexer = new lexer_1.Lexer(code);
var parser = new parser_1.Parser(lexer);
parser.parseProgram();
console.log("Parser Errors:", parser.errors.length);
if (parser.errors.length > 0) {
    parser.errors.slice(0, 10).forEach(function (e) { return console.log(e); });
}
