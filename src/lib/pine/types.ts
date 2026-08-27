export enum TokenType {
  // Literals
  Number = 'Number',
  String = 'String',
  Boolean = 'Boolean',
  Identifier = 'Identifier',

  // Keywords
  If = 'If',
  Else = 'Else',
  For = 'For',
  To = 'To',
  While = 'While',
  Break = 'Break',
  Var = 'Var',
  And = 'And',
  Or = 'Or',
  Not = 'Not',
  Type = 'Type',
  Switch = 'Switch',
  Return = 'Return',
  HexColor = 'HexColor',

  // Operators
  Plus = 'Plus', // +
  Minus = 'Minus', // -
  Multiply = 'Multiply', // *
  Divide = 'Divide', // /
  Modulo = 'Modulo', // %
  Assign = 'Assign', // =
  Reassign = 'Reassign', // :=
  PlusAssign = 'PlusAssign', // +=
  MinusAssign = 'MinusAssign', // -=
  MultiplyAssign = 'MultiplyAssign', // *=
  DivideAssign = 'DivideAssign', // /=
  Equals = 'Equals', // ==
  NotEquals = 'NotEquals', // !=
  LessThan = 'LessThan', // <
  GreaterThan = 'GreaterThan', // >
  LessThanOrEqual = 'LessThanOrEqual', // <=
  GreaterThanOrEqual = 'GreaterThanOrEqual', // >=
  Dot = 'Dot', // .
  Question = 'Question', // ?
  Colon = 'Colon', // :
  Arrow = 'Arrow', // =>

  // Punctuation
  LParen = 'LParen', // (
  RParen = 'RParen', // )
  LBrace = 'LBrace', // {
  RBrace = 'RBrace', // }
  LBracket = 'LBracket', // [
  RBracket = 'RBracket', // ]
  Comma = 'Comma', // ,
  Newline = 'Newline', // \n
  Indent = 'Indent',
  Dedent = 'Dedent',
  
  EOF = 'EOF',
  Illegal = 'Illegal'
}

export interface Token {
  type: TokenType;
  literal: string;
  line: number;
  column: number;
}

// AST Nodes
export type ASTNode = Statement | Expression | Program | BlockStatement;

export interface Program {
  type: 'Program';
  body: Statement[];
}

// Statements
export type Statement = 
  | VariableDeclaration
  | Assignment
  | ExpressionStatement
  | IfStatement
  | ForStatement
  | WhileStatement
  | BreakStatement
  | SwitchStatement
  | ReturnStatement
  | TupleAssignment
  | TupleDeclaration
  | TypeDeclaration
  | FunctionDeclaration;

export interface VariableDeclaration {
  type: 'VariableDeclaration';
  identifier: Identifier;
  value: Expression;
  varType?: Identifier;
  isArrayType?: boolean;
  isVar?: boolean;
}

export interface Assignment {
  type: 'Assignment';
  identifier: Identifier;
  value: Expression;
  operator?: string; // '=', ':=', '+=', etc.
}

export interface ExpressionStatement {
  type: 'ExpressionStatement';
  expression: Expression;
}

export interface IfStatement {
  type: 'IfStatement';
  condition: Expression;
  consequence: BlockStatement;
  alternative?: BlockStatement | IfStatement;
}

export interface BlockStatement {
  type: 'BlockStatement';
  statements: Statement[];
}

export interface ForStatement {
  type: 'ForStatement';
  identifier: Identifier;
  startValue: Expression;
  endValue: Expression;
  body: BlockStatement;
}

export interface WhileStatement {
  type: 'WhileStatement';
  condition: Expression;
  body: BlockStatement;
}

export interface BreakStatement {
  type: 'BreakStatement';
}

export interface FunctionDeclaration {
  type: 'FunctionDeclaration';
  identifier: Identifier;
  parameters: Identifier[];
  body: BlockStatement;
}

export interface TypeDeclaration {
  type: 'TypeDeclaration';
  identifier: Identifier;
  fields: { typeIdent?: Identifier; identifier: Identifier; defaultValue?: Expression }[];
}

export interface SwitchStatement {
  type: 'SwitchStatement';
  expression?: Expression;
  cases: { condition?: Expression; consequence: BlockStatement }[];
  defaultCase?: BlockStatement;
}

export interface ReturnStatement {
  type: 'ReturnStatement';
  argument?: Expression;
}

export interface TupleAssignment {
  type: 'TupleAssignment';
  identifiers: Identifier[];
  value: Expression;
}

export interface TupleDeclaration {
  type: 'TupleDeclaration';
  identifiers: Identifier[];
  value: Expression;
}

// Expressions
export type Expression =
  | BinaryExpression
  | UnaryExpression
  | Identifier
  | Literal
  | FunctionCall
  | MemberExpression
  | ArrayAccess
  | TernaryExpression;

export interface BinaryExpression {
  type: 'BinaryExpression';
  operator: string; // '+', '-', '==', etc.
  left: Expression;
  right: Expression;
}

export interface UnaryExpression {
  type: 'UnaryExpression';
  operator: string; // '-', 'not'
  argument: Expression;
}

export interface Identifier {
  type: 'Identifier';
  name: string;
}

export interface Literal {
  type: 'Literal';
  value: number | string | boolean;
  raw: string;
}

export interface FunctionCall {
  type: 'FunctionCall';
  callee: Expression;
  arguments: Expression[];
}

export interface MemberExpression {
  type: 'MemberExpression';
  object: Expression;
  property: Identifier;
}

export interface ArrayAccess {
  type: 'ArrayAccess';
  object: Expression;
  index: Expression; // e.g., close[1]
}

export interface TernaryExpression {
  type: 'TernaryExpression';
  condition: Expression;
  consequence: Expression;
  alternative: Expression;
}
