import { Lexer } from './lexer';
import {
  Token,
  TokenType,
  Program,
  Statement,
  Expression,
  VariableDeclaration,
  Assignment,
  Identifier,
  BlockStatement,
  IfStatement,
  ForStatement,
  ExpressionStatement,
  FunctionCall,
  MemberExpression,
  ArrayAccess,
  BinaryExpression,
  UnaryExpression,
  Literal,
  TernaryExpression,
  WhileStatement,
  BreakStatement,
  ReturnStatement,
  SwitchStatement,
  TypeDeclaration
} from './types';

enum Precedence {
  LOWEST = 1,
  ASSIGN,      // =
  TERNARY,     // ?
  LOGICAL,     // and, or
  EQUALS,      // ==
  LESSGREATER, // > or <
  SUM,         // +
  PRODUCT,     // *
  PREFIX,      // -X or not X
  CALL,        // myFunction(X)
  INDEX,       // array[index]
  MEMBER       // obj.prop
}

const PRECEDENCES: Partial<Record<TokenType, Precedence>> = {
  [TokenType.Assign]: Precedence.ASSIGN,
  [TokenType.Reassign]: Precedence.ASSIGN,
  [TokenType.PlusAssign]: Precedence.ASSIGN,
  [TokenType.MinusAssign]: Precedence.ASSIGN,
  [TokenType.MultiplyAssign]: Precedence.ASSIGN,
  [TokenType.DivideAssign]: Precedence.ASSIGN,
  [TokenType.Arrow]: Precedence.ASSIGN,
  [TokenType.And]: Precedence.LOGICAL,
  [TokenType.Or]: Precedence.LOGICAL,
  [TokenType.Equals]: Precedence.EQUALS,
  [TokenType.NotEquals]: Precedence.EQUALS,
  [TokenType.LessThan]: Precedence.LESSGREATER,
  [TokenType.GreaterThan]: Precedence.LESSGREATER,
  [TokenType.LessThanOrEqual]: Precedence.LESSGREATER,
  [TokenType.GreaterThanOrEqual]: Precedence.LESSGREATER,
  [TokenType.Plus]: Precedence.SUM,
  [TokenType.Minus]: Precedence.SUM,
  [TokenType.Multiply]: Precedence.PRODUCT,
  [TokenType.Divide]: Precedence.PRODUCT,
  [TokenType.Modulo]: Precedence.PRODUCT,
  [TokenType.LParen]: Precedence.CALL,
  [TokenType.LBracket]: Precedence.INDEX,
  [TokenType.Dot]: Precedence.MEMBER,
  [TokenType.Question]: Precedence.TERNARY,
};

type PrefixParseFn = () => Expression | null;
type InfixParseFn = (left: Expression) => Expression | null;

export class Parser {
  private lexer: Lexer;
  private currentToken: Token;
  private peekToken: Token;
  public errors: string[] = [];

  private prefixParseFns: Map<TokenType, PrefixParseFn> = new Map();
  private infixParseFns: Map<TokenType, InfixParseFn> = new Map();

  constructor(lexer: Lexer) {
    this.lexer = lexer;
    // @ts-ignore
    this.currentToken = null;
    // @ts-ignore
    this.peekToken = null;

    this.registerPrefix(TokenType.Identifier, this.parseIdentifier.bind(this));
    this.registerPrefix(TokenType.Number, this.parseNumberLiteral.bind(this));
    this.registerPrefix(TokenType.String, this.parseStringLiteral.bind(this));
    this.registerPrefix(TokenType.HexColor, this.parseStringLiteral.bind(this));
    this.registerPrefix(TokenType.Boolean, this.parseBooleanLiteral.bind(this));
    this.registerPrefix(TokenType.Minus, this.parsePrefixExpression.bind(this));
    this.registerPrefix(TokenType.Not, this.parsePrefixExpression.bind(this));
    this.registerPrefix(TokenType.LParen, this.parseGroupedExpression.bind(this));

    this.registerInfix(TokenType.Plus, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.Minus, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.Multiply, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.Divide, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.Modulo, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.Assign, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.Reassign, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.PlusAssign, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.MinusAssign, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.MultiplyAssign, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.DivideAssign, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.Arrow, this.parseFunctionDeclarationExpr.bind(this));
    this.registerInfix(TokenType.Equals, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.NotEquals, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.And, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.Or, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.LessThan, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.GreaterThan, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.LessThanOrEqual, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.GreaterThanOrEqual, this.parseBinaryExpression.bind(this));
    this.registerInfix(TokenType.LParen, this.parseCallExpression.bind(this));
    this.registerInfix(TokenType.LBracket, this.parseArrayAccess.bind(this));
    this.registerInfix(TokenType.Dot, this.parseMemberExpression.bind(this));
    this.registerInfix(TokenType.Question, this.parseTernaryExpression.bind(this));

    this.nextToken();
    this.nextToken();
  }

  private nextToken() {
    this.currentToken = this.peekToken;
    this.peekToken = this.lexer.nextToken();
  }

  private registerPrefix(tokenType: TokenType, fn: PrefixParseFn) {
    this.prefixParseFns.set(tokenType, fn);
  }

  private registerInfix(tokenType: TokenType, fn: InfixParseFn) {
    this.infixParseFns.set(tokenType, fn);
  }

  private peekPrecedence(): number {
    return PRECEDENCES[this.peekToken.type] || Precedence.LOWEST;
  }

  private currentPrecedence(): number {
    return PRECEDENCES[this.currentToken.type] || Precedence.LOWEST;
  }

  public parseProgram(): Program {
    const program: Program = {
      type: 'Program',
      body: []
    };

    while (this.currentToken.type !== TokenType.EOF) {
      if (this.currentToken.type === TokenType.Newline || this.currentToken.type === TokenType.Indent || this.currentToken.type === TokenType.Dedent) {
        this.nextToken();
        continue;
      }
      
      const stmt = this.parseStatement();
      if (stmt !== null) {
        program.body.push(stmt);
      }
      
      this.nextToken();
    }

    return program;
  }

  private parseStatement(): Statement | null {
    let isVar = false;
    if (this.currentToken.type === TokenType.Var) {
      isVar = true;
      this.nextToken(); // consume 'var'
    }

    // Handle variable declarations with or without types
    // e.g. int x = 1, float[] y = ..., var string[] z = ...
    if (this.currentToken.type === TokenType.Identifier) {
      // Check if this is a type declaration followed by an identifier
      // Type can be simple (int) or array (int[])
      let isTypeDecl = false;
      
      // Lookahead to see if it's an assignment or a type declaration
      let peekObj = this.peekToken;
      if (peekObj.type === TokenType.LBracket) {
        // Might be int[] x = ...
        // We'd need to peek further, but let's just use a heuristic:
        // If it's an array access in a statement context followed by an Identifier, it's a type.
      }
      
      // If we know it's Var, it MUST be a variable declaration or assignment
      if (
        isVar || 
        this.peekToken.type === TokenType.Assign || 
        this.peekToken.type === TokenType.Reassign || 
        this.peekToken.type === TokenType.PlusAssign || 
        this.peekToken.type === TokenType.MinusAssign || 
        this.peekToken.type === TokenType.MultiplyAssign || 
        this.peekToken.type === TokenType.DivideAssign || 
        this.peekToken.type === TokenType.Identifier || 
        this.peekToken.type === TokenType.LBracket
      ) {
         const decl = this.tryParseVariableDeclaration(isVar);
         if (decl) return decl;
      }
    }

    switch (this.currentToken.type) {
      case TokenType.Type:
        return this.parseTypeDeclaration();
      case TokenType.If:
        return this.parseIfStatement();
      case TokenType.Switch:
        return this.parseSwitchStatement();
      case TokenType.Return:
        return this.parseReturnStatement();
      case TokenType.LBracket:
        return this.parseTupleAssignment();
      case TokenType.For:
        return this.parseForStatement();
      case TokenType.While:
        return this.parseWhileStatement();
      case TokenType.Break:
        const stmt: BreakStatement = { type: 'BreakStatement' };
        this.nextToken();
        return stmt;
      default:
        // Could be a function declaration if it's Identifier(args) =>
        const exprStmt = this.parseExpressionStatement();
        // If the parsed expression is a BinaryExpression with '=>', convert to FunctionDeclaration
        if (exprStmt && exprStmt.expression && exprStmt.expression.type === 'BinaryExpression' && exprStmt.expression.operator === '=>') {
           const bin = exprStmt.expression;
           if (bin.left.type === 'FunctionCall' && bin.left.callee.type === 'Identifier') {
              const params: Identifier[] = [];
              bin.left.arguments.forEach(arg => {
                 if (arg.type === 'Identifier') params.push(arg);
                 // If arg has a type (which parsed weirdly), just grab the identifier
              });
              
              // We need the body! But wait, '=>' is parsed by BinaryExpression, which expects an Expression right side!
              // BlockStatement is NOT an Expression!
           }
        }
        return exprStmt;
    }
  }

  private tryParseVariableDeclaration(isVar: boolean): Statement | null {
    // This is a custom parser for variable declarations to handle optional types
    // e.g. var float[] myVar = ...
    let varType: Identifier | undefined;
    let isArrayType = false;
    let identifier: Identifier;
    
    // Save state in case we need to backtrack (though our lexer doesn't support backtrack easily, we'll just push forward)
    let firstIdent = { type: 'Identifier' as const, name: this.currentToken.literal };
    this.nextToken(); // consume first ident
    
    if (this.currentToken.type === TokenType.LBracket) {
       this.nextToken(); // consume '['
       if ((this.currentToken.type as any) === TokenType.RBracket) {
          this.nextToken(); // consume ']'
          isArrayType = true;
       }
    }
    
    if (this.currentToken.type === TokenType.Identifier) {
       // firstIdent was a type!
       varType = firstIdent;
       identifier = { type: 'Identifier' as const, name: this.currentToken.literal };
       this.nextToken(); // consume identifier
    } else {
       // firstIdent was the variable name
       identifier = firstIdent;
    }
    
    if (
      this.currentToken.type === TokenType.Assign || 
      this.currentToken.type === TokenType.Reassign ||
      this.currentToken.type === TokenType.PlusAssign ||
      this.currentToken.type === TokenType.MinusAssign ||
      this.currentToken.type === TokenType.MultiplyAssign ||
      this.currentToken.type === TokenType.DivideAssign
    ) {
       const operator = this.currentToken.literal;
       const isReassign = this.currentToken.type !== TokenType.Assign;
       this.nextToken(); // consume = or := or += etc.
       const value = this.parseExpression(Precedence.LOWEST);
       if (isReassign && !isVar && !varType) {
          return value ? { type: 'Assignment', identifier, value, operator } : null;
       }
       return value ? { type: 'VariableDeclaration', identifier, value, varType, isArrayType, isVar } : null;
    }
    
    // If it's not an assignment, it might just be an expression statement that started with an identifier
    // We can't backtrack easily, so this is a limitation. But in Pine Script, statements starting with 'var' or 'Type' are assignments.
    this.errors.push(`Expected assignment after identifier ${identifier.name} at line ${this.currentToken.line}`);
    return null;
  }

  // parseVariableDeclaration and parseAssignment removed in favor of tryParseVariableDeclaration

  private parseIfStatement(): IfStatement | null {
    this.nextToken(); // consume 'if'
    
    const condition = this.parseExpression(Precedence.LOWEST);
    if (!condition) return null;
    
    if (this.peekToken.type === TokenType.Newline) {
      this.nextToken();
    }
    
    const consequence = this.parseBlockStatement();
    let alternative: BlockStatement | IfStatement | undefined;
    
    // After parsing block statement, currentToken is the LAST token of the block (the Dedent).
    // Peek token is the first token of the next line.
    while (this.peekToken.type === TokenType.Newline) {
      this.nextToken();
    }
    
    if (this.peekToken.type === TokenType.Else) {
      this.nextToken(); // make Else the current token
      
      if ((this.peekToken.type as unknown) === TokenType.If) {
        this.nextToken(); // make If the current token
        const elseIfStmt = this.parseIfStatement();
        if (elseIfStmt) alternative = elseIfStmt;
      } else {
        alternative = this.parseBlockStatement();
      }
    }
    
    return { type: 'IfStatement', condition, consequence, alternative };
  }

  private parseSwitchStatement(): SwitchStatement | null {
    this.nextToken(); // consume 'switch'
    
    let expression: Expression | undefined;
    if (this.currentToken.type !== TokenType.Newline && this.currentToken.type !== TokenType.Indent) {
      const expr = this.parseExpression(Precedence.LOWEST);
      if (expr) expression = expr;
    }
    
    while (this.peekToken.type === TokenType.Newline) {
      this.nextToken();
    }
    
    if (!this.expectPeek(TokenType.Indent)) return null;
    
    const cases: { condition?: Expression; consequence: BlockStatement }[] = [];
    let defaultCase: BlockStatement | undefined;
    
    while (this.peekToken.type !== TokenType.Dedent && this.peekToken.type !== TokenType.EOF) {
      this.nextToken();
      if (this.currentToken.type === TokenType.Newline || this.currentToken.type === TokenType.Indent) continue;
      
      if (this.currentToken.type === TokenType.Arrow) {
        // default case (=>)
        this.nextToken();
        const consequence = this.parseSwitchCaseBlock();
        defaultCase = consequence;
      } else {
        const condition = this.parseExpression(Precedence.ASSIGN);
        if (this.expectPeek(TokenType.Arrow)) {
          this.nextToken(); // consume =>
          const consequence = this.parseSwitchCaseBlock();
          if (condition) cases.push({ condition, consequence });
        }
      }
    }
    
    if (this.peekToken.type === TokenType.Dedent) this.nextToken();
    
    return { type: 'SwitchStatement', expression, cases, defaultCase };
  }

  private parseSwitchCaseBlock(): BlockStatement {
    // A case block can be inline expression or an indented block
    if (this.currentToken.type === TokenType.Newline || this.peekToken.type === TokenType.Newline || this.peekToken.type === TokenType.Indent) {
      return this.parseBlockStatement();
    }
    // Inline expression
    const expr = this.parseExpression(Precedence.LOWEST);
    return { type: 'BlockStatement', statements: expr ? [{ type: 'ExpressionStatement', expression: expr }] : [] };
  }

  private parseReturnStatement(): ReturnStatement | null {
    this.nextToken(); // consume 'return'
    if (this.currentToken.type === TokenType.Newline || this.currentToken.type === TokenType.EOF || this.currentToken.type === TokenType.Dedent) {
      return { type: 'ReturnStatement' };
    }
    const argument = this.parseExpression(Precedence.LOWEST);
    return { type: 'ReturnStatement', argument: argument || undefined };
  }

  private parseTupleAssignment(): Statement | null {
    this.nextToken(); // consume '['
    const identifiers: Identifier[] = [];
    
    while (this.currentToken.type !== TokenType.RBracket && this.currentToken.type !== TokenType.EOF) {
      if (this.currentToken.type === TokenType.Identifier) {
        identifiers.push({ type: 'Identifier', name: this.currentToken.literal });
      }
      this.nextToken();
    }
    
    if (this.currentToken.type === TokenType.RBracket) {
      this.nextToken(); // consume ']'
    }
    
    if ((this.currentToken.type as unknown as TokenType) === TokenType.Assign || (this.currentToken.type as unknown as TokenType) === TokenType.Reassign) {
      const isReassign = (this.currentToken.type as unknown as TokenType) === TokenType.Reassign;
      this.nextToken(); // consume '=' or ':='
      const value = this.parseExpression(Precedence.LOWEST);
      if (!value) return null;
      if (isReassign) {
         return { type: 'TupleAssignment', identifiers, value };
      }
      return { type: 'TupleDeclaration', identifiers, value };
    }
    
    this.errors.push(`Expected assignment after tuple declaration at line ${this.currentToken.line}`);
    return null;
  }

  private parseForStatement(): ForStatement | null {
    if (!this.expectPeek(TokenType.Identifier)) return null;
    const identifier = { type: 'Identifier' as const, name: this.currentToken.literal };
    
    if (!this.expectPeek(TokenType.Assign)) return null;
    this.nextToken();
    
    const startValue = this.parseExpression(Precedence.LOWEST);
    if (!startValue) return null;
    
    if (!this.expectPeek(TokenType.To)) return null;
    this.nextToken();
    
    const endValue = this.parseExpression(Precedence.LOWEST);
    if (!endValue) return null;
    
    const body = this.parseBlockStatement();
    
    return { type: 'ForStatement', identifier, startValue, endValue, body };
  }

  private parseWhileStatement(): WhileStatement | null {
    this.nextToken(); // consume 'while'
    
    const condition = this.parseExpression(Precedence.LOWEST);
    if (!condition) return null;
    
    const body = this.parseBlockStatement();
    
    return { type: 'WhileStatement', condition, body };
  }

  private parseBlockStatement(): BlockStatement {
    const block: BlockStatement = { type: 'BlockStatement', statements: [] };
    
    while (this.peekToken.type === TokenType.Newline) {
      this.nextToken();
    }
    
    if (!this.expectPeek(TokenType.Indent)) {
      return block;
    }
    
    while (this.peekToken.type !== TokenType.Dedent && this.peekToken.type !== TokenType.EOF) {
      this.nextToken();
      
      if (this.currentToken.type === TokenType.Newline || this.currentToken.type === TokenType.Indent) {
        continue;
      }
      
      const stmt = this.parseStatement();
      if (stmt !== null) {
        block.statements.push(stmt);
      }
    }
    
    if (this.peekToken.type === TokenType.Dedent) {
      this.nextToken(); // consume Dedent so it's the currentToken (last token of the block)
    }
    
    return block;
  }

  private parseExpressionStatement(): ExpressionStatement | null {
    const expression = this.parseExpression(Precedence.LOWEST);
    if (!expression) return null;
    return { type: 'ExpressionStatement', expression };
  }

  private parseExpression(precedence: number): Expression | null {
    const prefix = this.prefixParseFns.get(this.currentToken.type);
    
    if (!prefix) {
      this.errors.push(`No prefix parse function for ${this.currentToken.type} found at line ${this.currentToken.line}`);
      return null;
    }
    
    let leftExp = prefix();
    if (!leftExp) return null;
    
    while (
      this.peekToken.type !== TokenType.EOF && 
      this.peekToken.type !== TokenType.Newline &&
      this.peekToken.type !== TokenType.Indent &&
      this.peekToken.type !== TokenType.Dedent &&
      precedence < this.peekPrecedence()
    ) {
      const infix = this.infixParseFns.get(this.peekToken.type);
      if (!infix) return leftExp;
      
      this.nextToken();
      leftExp = infix(leftExp);
      if (!leftExp) return null;
    }
    
    return leftExp;
  }

  private parseIdentifier(): Identifier {
    return { type: 'Identifier', name: this.currentToken.literal };
  }

  private parseNumberLiteral(): Literal {
    return { type: 'Literal', value: parseFloat(this.currentToken.literal), raw: this.currentToken.literal };
  }

  private parseStringLiteral(): Literal {
    return { type: 'Literal', value: this.currentToken.literal, raw: `"${this.currentToken.literal}"` };
  }

  private parseBooleanLiteral(): Literal {
    return { type: 'Literal', value: this.currentToken.type === TokenType.Boolean && this.currentToken.literal === 'true', raw: this.currentToken.literal };
  }

  private parsePrefixExpression(): UnaryExpression | null {
    const operator = this.currentToken.literal;
    this.nextToken();
    const right = this.parseExpression(Precedence.PREFIX);
    if (!right) return null;
    return { type: 'UnaryExpression', operator, argument: right };
  }

  private parseGroupedExpression(): Expression | null {
    this.nextToken();
    const exp = this.parseExpression(Precedence.LOWEST);
    if (!this.expectPeek(TokenType.RParen)) return null;
    return exp;
  }

  private parseBinaryExpression(left: Expression): BinaryExpression | null {
    const operator = this.currentToken.literal;
    const precedence = this.currentPrecedence();
    this.nextToken();
    const right = this.parseExpression(precedence);
    if (!right) return null;
    return { type: 'BinaryExpression', operator, left, right };
  }

  private parseCallExpression(callee: Expression): FunctionCall | null {
    const args = this.parseExpressionList(TokenType.RParen);
    if (!args) return null;
    return { type: 'FunctionCall', callee, arguments: args };
  }

  private parseFunctionDeclarationExpr(left: Expression): any | null {
    // left is a FunctionCall e.g., f_trimLiq(float[] lvls, bool[] sw)
    if (left.type !== 'FunctionCall' || left.callee.type !== 'Identifier') {
      this.errors.push(`Expected function call before '=>' at line ${this.currentToken.line}`);
      return null;
    }
    
    this.nextToken(); // consume '=>'
    
    const parameters: Identifier[] = [];
    left.arguments.forEach(arg => {
      if (arg.type === 'Identifier') parameters.push(arg);
      // Our relaxed parseExpressionList might return other types if it failed to strip type annotations,
      // but in the ideal case we get Identifiers. We'll just grab any Identifier we find.
    });

    const body = this.parseBlockStatement();
    
    return { type: 'FunctionDeclaration', identifier: left.callee, parameters, body };
  }

  private parseArrayAccess(left: Expression): ArrayAccess | null {
    this.nextToken();
    if (this.currentToken.type === TokenType.RBracket) {
      return { type: 'ArrayAccess', object: left, index: { type: 'Literal', value: null, raw: '' } as any };
    }
    const index = this.parseExpression(Precedence.LOWEST);
    if (!index || !this.expectPeek(TokenType.RBracket)) return null;
    return { type: 'ArrayAccess', object: left, index };
  }

  private parseMemberExpression(left: Expression): MemberExpression | null {
    if (!this.expectPeek(TokenType.Identifier)) return null;
    return {
      type: 'MemberExpression',
      object: left,
      property: { type: 'Identifier', name: this.currentToken.literal }
    };
  }

  private parseTernaryExpression(left: Expression): TernaryExpression | null {
    this.nextToken(); // consume '?'
    const consequence = this.parseExpression(Precedence.LOWEST);
    if (!consequence) return null;
    
    if (!this.expectPeek(TokenType.Colon)) return null;
    this.nextToken(); // consume ':'
    
    const alternative = this.parseExpression(Precedence.LOWEST);
    if (!alternative) return null;
    
    return {
      type: 'TernaryExpression',
      condition: left,
      consequence,
      alternative
    };
  }

  private parseExpressionList(end: TokenType): Expression[] | null {
    const list: Expression[] = [];
    
    if (this.peekToken.type === end) {
      this.nextToken();
      return list;
    }
    
    this.nextToken();
    
    // Check if it's a type annotation like `float[] lvls` or `int x`
    let isTypeAnnotation = false;
    let typeIdent = null;
    let isArray = false;
    if (this.currentToken.type === TokenType.Identifier) {
       if (this.peekToken.type === TokenType.Identifier) {
          isTypeAnnotation = true;
       } else if (this.peekToken.type === TokenType.LBracket) {
          // might be int[] name
          const savedPos = this.currentToken; // hacky lookahead bypass
          isTypeAnnotation = true;
       }
    }
    
    // Very relaxed parsing: if we see multiple identifiers before a comma or end, we just keep the last one
    let expr = this.parseExpression(Precedence.LOWEST);
    if (expr) {
       // if next token is identifier, the previous was a type. Skip to the next identifier!
       if (this.peekToken.type === TokenType.Identifier) {
          this.nextToken();
          expr = this.parseExpression(Precedence.LOWEST);
       }
       if (expr) list.push(expr);
    }
    
    while (this.peekToken.type === TokenType.Comma) {
      this.nextToken(); // consume current token
      this.nextToken(); // consume comma
      
      expr = this.parseExpression(Precedence.LOWEST);
      if (expr) {
         if ((this.peekToken.type as any) === TokenType.Identifier) {
            this.nextToken();
            expr = this.parseExpression(Precedence.LOWEST);
         }
         if (expr) list.push(expr);
      }
    }
    
    if (!this.expectPeek(end)) return null;
    
    return list;
  }

  private expectPeek(t: TokenType): boolean {
    if (this.peekToken.type === t) {
      this.nextToken();
      return true;
    } else {
      this.peekError(t);
      return false;
    }
  }

  private peekError(t: TokenType) {
    this.errors.push(`Expected next token to be ${t}, got ${this.peekToken.type} instead at line ${this.peekToken.line}`);
  }

  private parseTypeDeclaration(): TypeDeclaration | null {
    this.nextToken(); // consume 'type'
    if (this.currentToken.type !== TokenType.Identifier) {
       this.errors.push(`Expected identifier after type at line ${this.currentToken.line}`);
       return null;
    }
    const identifier = { type: 'Identifier' as const, name: this.currentToken.literal };
    this.nextToken(); // consume identifier
    
    while ((this.currentToken.type as unknown as TokenType) === TokenType.Newline) {
      this.nextToken();
    }
    
    if ((this.currentToken.type as unknown as TokenType) !== TokenType.Indent) {
       this.errors.push(`Expected indented block for type declaration at line ${this.currentToken.line}`);
       return null;
    }
    this.nextToken(); // consume Indent
    
    const fields: { typeIdent?: Identifier; identifier: Identifier; defaultValue?: Expression }[] = [];
    
    while ((this.currentToken.type as unknown as TokenType) !== TokenType.Dedent && (this.currentToken.type as unknown as TokenType) !== TokenType.EOF) {
      if ((this.currentToken.type as unknown as TokenType) === TokenType.Newline) {
        this.nextToken();
        continue;
      }
      
      if ((this.currentToken.type as unknown as TokenType) !== TokenType.Identifier) {
         this.errors.push(`Expected identifier in type field at line ${this.currentToken.line}`);
         this.nextToken();
         continue;
      }
      
      let firstIdent = { type: 'Identifier' as const, name: this.currentToken.literal };
      this.nextToken();
      
      let typeIdent: Identifier | undefined;
      let fieldIdent: Identifier;
      
      if (this.currentToken.type === TokenType.Identifier) {
         typeIdent = firstIdent;
         fieldIdent = { type: 'Identifier' as const, name: this.currentToken.literal };
         this.nextToken();
      } else if (this.currentToken.type === TokenType.LBracket) {
         // handle array types e.g. float[] price
         this.nextToken(); // consume [
         if (this.currentToken.type as any === TokenType.RBracket) {
            this.nextToken(); // consume ]
         }
         if (this.currentToken.type === TokenType.Identifier) {
             typeIdent = firstIdent; // we just map 'float' as type identifier
             fieldIdent = { type: 'Identifier' as const, name: this.currentToken.literal };
             this.nextToken();
         } else {
             fieldIdent = firstIdent;
         }
      } else {
         fieldIdent = firstIdent;
      }
      
      let defaultValue: Expression | undefined;
      if ((this.currentToken.type as unknown as TokenType) === TokenType.Assign) {
         this.nextToken(); // consume '='
         const expr = this.parseExpression(Precedence.LOWEST);
         if (expr) defaultValue = expr;
      }
      
      fields.push({ typeIdent, identifier: fieldIdent, defaultValue });
      
      while ((this.currentToken.type as unknown as TokenType) !== TokenType.Newline && (this.currentToken.type as unknown as TokenType) !== TokenType.Dedent && (this.currentToken.type as unknown as TokenType) !== TokenType.EOF) {
         this.nextToken();
      }
    }
    
    // Do not consume Dedent here, let the outer loop's nextToken() handle it
    // if (this.currentToken.type === TokenType.Dedent) {
    //   this.nextToken(); 
    // }
    
    return { type: 'TypeDeclaration', identifier, fields };
  }
}
