"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var lexer_1 = require("./src/lib/pine/lexer");
var parser_1 = require("./src/lib/pine/parser");
var code = "\nfast = ta.sma(close, 10)\nslow = ta.sma(close, 30)\n\nr_color = mR > 0 ? color.new(#26a69a, 0) : mR < 0 ? color.new(#ef5350, 0) : color.new(#26a69a, 0)\nlabel.new(x, y, str.tostring(mR, \"#.##\") + \"R\", text_color=color.white, text_size=size.small)\n";
var lexer = new lexer_1.Lexer(code);
var parser = new parser_1.Parser(lexer);
parser.parseProgram();
console.log("Parser Errors:");
if (parser.errors.length === 0) {
    console.log("NO ERRORS!");
}
else {
    parser.errors.forEach(function (e) { return console.log(e); });
}
