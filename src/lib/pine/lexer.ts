import { Token, TokenType } from './types';

const KEYWORDS: Record<string, TokenType> = {
  'if': TokenType.If,
  'else': TokenType.Else,
  'for': TokenType.For,
  'to': TokenType.To,
  'while': TokenType.While,
  'break': TokenType.Break,
  'var': TokenType.Var,
  'and': TokenType.And,
  'or': TokenType.Or,
  'not': TokenType.Not,
  'true': TokenType.Boolean,
  'false': TokenType.Boolean,
};

export class Lexer {
  private input: string;
  private position: number = 0;
  private readPosition: number = 0;
  private ch: string | null = '';
  private line: number = 1;
  private column: number = 0;
  
  private indentStack: number[] = [0];
  private pendingTokens: Token[] = [];
  private parenthesesCount = 0;

  constructor(input: string) {
    this.input = input;
    this.readChar();
  }

  private readChar() {
    if (this.readPosition >= this.input.length) {
      this.ch = null;
    } else {
      this.ch = this.input[this.readPosition];
    }
    
    if (this.ch === '\n') {
      this.line++;
      this.column = 0;
    } else {
      this.column++;
    }
    
    this.position = this.readPosition;
    this.readPosition++;
  }

  private peekChar(): string | null {
    if (this.readPosition >= this.input.length) {
      return null;
    }
    return this.input[this.readPosition];
  }

  public nextToken(): Token {
    if (this.pendingTokens.length > 0) {
      return this.pendingTokens.shift()!;
    }

    let tok: Token;
    this.skipInlineWhitespace();

    // Pine scripts commonly contain comments and compiler annotations such as
    // //@version=6; they should not become Illegal tokens.
    if (this.ch === '/' && this.peekChar() === '/') {
      this.skipComment();
      if (this.ch === '\n' || this.ch === '\r') this.readChar();
      return this.nextToken();
    }

    if (this.ch === null) {
      // Emit remaining dedents
      while (this.indentStack.length > 1) {
        this.indentStack.pop();
        this.pendingTokens.push(this.createToken(TokenType.Dedent, ''));
      }
      this.pendingTokens.push(this.createToken(TokenType.EOF, ''));
      return this.pendingTokens.shift()!;
    }

    switch (this.ch) {
      case '\n':
      case '\r':
        return this.handleNewline();
      case '=':
        if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.Equals, ch + this.ch);
        } else if (this.peekChar() === '>') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.Arrow, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.Assign, this.ch);
        }
        break;
      case ':':
        if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.Reassign, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.Colon, this.ch);
        }
        break;
      case '!':
        if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.NotEquals, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.Illegal, this.ch);
        }
        break;
      case '+':
        if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.PlusAssign, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.Plus, this.ch);
        }
        break;
      case '-':
        if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.MinusAssign, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.Minus, this.ch);
        }
        break;
      case '*':
        if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.MultiplyAssign, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.Multiply, this.ch);
        }
        break;
      case '/':
        if (this.peekChar() === '/') {
          this.skipComment();
          // After a comment, we might be at a newline or EOF. Just recurse.
          return this.nextToken();
        } else if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.DivideAssign, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.Divide, this.ch);
        }
        break;
      case '<':
        if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.LessThanOrEqual, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.LessThan, this.ch);
        }
        break;
      case '>':
        if (this.peekChar() === '=') {
          const ch = this.ch;
          this.readChar();
          tok = this.createToken(TokenType.GreaterThanOrEqual, ch + this.ch);
        } else {
          tok = this.createToken(TokenType.GreaterThan, this.ch);
        }
        break;
      case '(':
        this.parenthesesCount++;
        tok = this.createToken(TokenType.LParen, this.ch);
        break;
      case ')':
        this.parenthesesCount--;
        tok = this.createToken(TokenType.RParen, this.ch);
        break;
      case '[':
        tok = this.createToken(TokenType.LBracket, this.ch);
        break;
      case ']':
        tok = this.createToken(TokenType.RBracket, this.ch);
        break;
      case '{':
      case '}':
        // Skip curly braces completely, Pine Script uses indentation
        this.readChar();
        return this.nextToken();
      case ',':
        tok = this.createToken(TokenType.Comma, this.ch);
        break;
      case '.':
        tok = this.createToken(TokenType.Dot, this.ch);
        break;
      case '?':
        tok = this.createToken(TokenType.Question, this.ch);
        break;
      case '#':
        tok = this.createToken(TokenType.String, this.readHexColor());
        return tok;
      case '"':
      case "'":
        tok = this.createToken(TokenType.String, this.readString(this.ch));
        break;
      default:
        if (this.isLetter(this.ch)) {
          const literal = this.readIdentifier();
          const type = this.lookupIdent(literal);
          return this.createToken(type, literal);
        } else if (this.isDigit(this.ch)) {
          return this.createToken(TokenType.Number, this.readNumber());
        } else {
          tok = this.createToken(TokenType.Illegal, this.ch);
        }
    }

    this.readChar();
    return tok;
  }

  private handleNewline(): Token {
    const newlineToken = this.createToken(TokenType.Newline, '\\n');
    
    // Consume all contiguous newlines and carriage returns
    while (this.ch === '\n' || this.ch === '\r') {
      this.readChar();
    }
    
    // If we're inside parentheses, ignore indentation and newlines entirely
    if (this.parenthesesCount > 0) {
      return this.nextToken();
    }

    // Now we are at the start of a new line (or EOF)
    // Count leading spaces
    let spaceCount = 0;
    while (this.ch === ' ' || this.ch === '\t') {
      if (this.ch === '\t') spaceCount += 4;
      else spaceCount += 1;
      this.readChar();
    }

    // Ignore empty lines (lines that end with newline/comment immediately after spaces)
    if (this.ch === '\n' || this.ch === '\r' || (this.ch === '/' && this.peekChar() === '/')) {
      return this.nextToken();
    }

    // Compare with current indent
    const currentIndent = this.indentStack[this.indentStack.length - 1];

    if (spaceCount > currentIndent) {
      // It's an indent
      this.indentStack.push(spaceCount);
      this.pendingTokens.push(this.createToken(TokenType.Indent, ''));
    } else if (spaceCount < currentIndent) {
      // It's one or more dedents
      while (this.indentStack.length > 1 && spaceCount < this.indentStack[this.indentStack.length - 1]) {
        this.indentStack.pop();
        this.pendingTokens.push(this.createToken(TokenType.Dedent, ''));
      }
      if (spaceCount !== this.indentStack[this.indentStack.length - 1]) {
        // Indentation error, but we'll try to recover
        this.indentStack.push(spaceCount); 
      }
    }

    // Always emit Newline as a statement terminator
    if (this.pendingTokens.length > 0) {
      const first = newlineToken;
      return first;
    }
    
    return newlineToken;
  }

  private createToken(type: TokenType, literal: string): Token {
    return { type, literal, line: this.line, column: this.column };
  }

  private skipInlineWhitespace() {
    while (this.ch !== null && (this.ch === ' ' || this.ch === '\t')) {
      this.readChar();
    }
  }

  private skipComment() {
    while (this.ch !== null && this.ch !== '\n' && this.ch !== '\r') {
      this.readChar();
    }
  }

  private readIdentifier(): string {
    const position = this.position;
    while (this.ch !== null && (this.isLetter(this.ch) || this.isDigit(this.ch) || this.ch === '_')) {
      this.readChar();
    }
    return this.input.substring(position, this.position);
  }

  private readNumber(): string {
    const position = this.position;
    let hasDot = false;
    while (this.ch !== null && (this.isDigit(this.ch) || (this.ch === '.' && !hasDot))) {
      if (this.ch === '.') hasDot = true;
      this.readChar();
    }
    return this.input.substring(position, this.position);
  }

  private readString(quote: string): string {
    let result = '';
    this.readChar(); // consume quote
    while (this.ch !== null && this.ch !== quote) {
      if (this.ch === '\\') {
        this.readChar();
        if (this.ch === 'n') result += '\n';
        else if (this.ch === 'r') result += '\r';
        else if (this.ch === 't') result += '\t';
        else result += this.ch; // covers \\, \", \' etc.
      } else {
        result += this.ch;
      }
      this.readChar();
    }
    return result;
  }

  private readHexColor(): string {
    const position = this.position;
    this.readChar(); // consume '#'
    while (this.ch !== null && (this.isDigit(this.ch) || (this.ch >= 'a' && this.ch <= 'f') || (this.ch >= 'A' && this.ch <= 'F'))) {
      this.readChar();
    }
    return this.input.substring(position, this.position);
  }

  private isLetter(ch: string): boolean {
    return ('a' <= ch && ch <= 'z') || ('A' <= ch && ch <= 'Z') || ch === '_';
  }

  private isDigit(ch: string): boolean {
    return '0' <= ch && ch <= '9';
  }

  private lookupIdent(ident: string): TokenType {
    if (ident in KEYWORDS) {
      return KEYWORDS[ident];
    }
    return TokenType.Identifier;
  }
}
