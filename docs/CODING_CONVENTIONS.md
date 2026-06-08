# Coding Conventions Guide

A standard reference for code style, naming, and structure across projects. Apply these conventions consistently within each project unless local CLAUDE.md or project config specifies otherwise.

---

## HTML

### Structure & Semantics
- Use semantic HTML5 elements (`<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<footer>`, `<aside>`) over generic `<div>` where appropriate
- Always include `<!DOCTYPE html>` and proper `<html>`, `<head>`, `<body>` structure
- Use meaningful IDs and class names that describe purpose, not appearance (`data-status` not `red-box`)
- Use `data-*` attributes for JavaScript hooks: `data-i="0"`, `data-player="human"`

### Formatting
- Indent with 2 spaces
- Use double quotes for attributes: `<div class="board">`
- Self-closing tags: `<br>`, `<img src="">`, `<input>`
- One element per line for readability; inline only for short content
- Attributes: class, id, data-*, then aria-* and event handlers

### Accessibility
- Include `alt` text for all `<img>`: `<img alt="Player avatar" src="...">`
- Use `<label>` for form inputs with matching `for` attribute
- Include `role` and `aria-*` attributes for interactive components
- Ensure color is not the only means of conveying information

---

## CSS

### Naming & Organization
- Use kebab-case for class and id names: `.player-score`, `#game-board`
- Group styles by component/section with comments: `/* Board Styles */`
- Order properties: display/layout → sizing → spacing → color/font → effects/animation
- Avoid `!important`; use specificity instead

### Selectors
- Use classes for styling, not IDs (IDs are for JavaScript hooks)
- Avoid deep nesting (max 3 levels)
- Prefer `.parent > .child` over `.parent .child` when specificity matters
- Use attribute selectors for data attributes: `[data-status="active"]`

### Values & Units
- Use `rem` or `em` for font sizes (base 16px): `1.5rem` = 24px
- Use `px` for borders and absolute positioning
- Use `%` or `flex` for layout widths
- Use `var(--custom-property)` for reusable colors and sizes
- Avoid magic numbers; create spacing/sizing variables

### Responsive Design
- Mobile-first approach: base styles for mobile, then `@media (min-width: 768px)`
- Use `max-width` on containers instead of fixed widths
- Test at breakpoints: 320px (mobile), 768px (tablet), 1024px (desktop), 1920px (HD)

### Animations & Effects
- Use `transition` for simple state changes: `transition: background-color 0.3s ease`
- Use `@keyframes` for complex animations
- Keep animation durations under 500ms for UI feedback
- Always provide a non-animated fallback

### Example Structure
```css
:root {
  --color-primary: #6366f1;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
}

/* Board Styles */
.board {
  display: grid;
  grid-template-columns: repeat(3, 110px);
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
}

.cell {
  background: var(--color-primary);
  cursor: pointer;
  transition: transform 0.2s ease;
}

.cell:hover {
  transform: scale(1.05);
}
```

---

## JavaScript

### Naming Conventions
- **Functions**: `camelCase`, verb-first for actions: `checkWinner()`, `applyMove()`, `initGame()`
- **Variables**: `camelCase` for regular vars: `playerScore`, `boardState`
- **Constants**: `UPPER_SNAKE_CASE`: `BOARD_SIZE`, `MAX_DEPTH`
- **Objects/Classes**: `PascalCase`: `GameState`, `Player`
- **Booleans**: prefix with `is`, `has`, `should`: `isActive`, `hasWon`, `shouldReset`

### Structure
- One responsibility per function (single responsibility principle)
- Keep functions under 50 lines; extract helpers if longer
- Keep classes under 300 lines; split into focused collaborators if longer
- Use early returns to reduce nesting
- Group related functions together

### Logic & Patterns
- Use `const` by default, `let` for loop counters, avoid `var`
- Prefer array methods (`.map()`, `.filter()`, `.reduce()`) over loops when readable
- Check for existence before accessing: `if (obj && obj.property)`
- Use destructuring for function parameters: `function move({ x, y })`
- Return early from functions to reduce nesting

### Comments
- Explain *why*, not *what*: code shows what it does
- Use single-line comments `//` for brief notes
- Use block comments `/* */` for complex logic explanations
- Keep comments near the relevant code

### Example
```javascript
// Minimax algorithm: finds best move by evaluating all game states
// Returns score: +10 (AI wins), -10 (player wins), 0 (draw)
function minimax(board, depth, isMax) {
  const result = checkWinner(board);
  
  // Base cases
  if (result?.winner === 'X') return -10 + depth;
  if (result?.winner === 'O') return 10 - depth;
  if (result?.winner === 'draw') return 0;
  
  // Recursive case
  let bestScore = isMax ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue;
    
    board[i] = isMax ? 'O' : 'X';
    const score = minimax(board, depth + 1, !isMax);
    board[i] = null;
    
    bestScore = isMax ? Math.max(score, bestScore) : Math.min(score, bestScore);
  }
  return bestScore;
}
```

---

## TypeScript

### Type Annotations
- Annotate function parameters and return types: `function add(a: number, b: number): number`
- Use inline types for simple objects: `{ x: number; y: string }`
- Use `interface` for complex/reusable types, `type` for unions/primitives
- Export types publicly: `export interface GameState { ... }`
- Avoid `any`; use `unknown` if type is truly dynamic, then narrow it

### Naming
- Follow JavaScript naming conventions
- Interface names: `UserData`, `GameConfig`, `ResponsePayload` (no `I` prefix)
- Generic type parameters: `T`, `K`, `V` (single letter) or descriptive: `TUser`, `TResponse`

### Structure
```typescript
// enums for fixed sets
export enum PlayerMark {
  X = 'X',
  O = 'O',
}

// interfaces for data shapes
export interface GameState {
  board: Array<PlayerMark | null>;
  currentPlayer: PlayerMark;
  score: { player: number; cpu: number; draws: number };
}

// typed functions
function initGame(state: GameState): void {
  // implementation
}

// optional/union types
function move(index: number | null): GameState | null {
  return index !== null ? applyMove(index) : null;
}

// generics for reusable logic
function cache<T>(fn: () => T): () => T {
  let cached: T;
  return () => (cached ??= fn());
}
```

### Best Practices
- Enable `strict: true` in `tsconfig.json`
- Use `readonly` for immutable properties
- Prefer `const` assertions for literal types: `const status = 'active' as const`
- Use discriminated unions for type-safe state: `type Result = { status: 'win'; winner: Mark } | { status: 'draw' }`

---

## PHP

### Naming Conventions
- **Functions**: `camelCase`: `getUserData()`, `validateEmail()`
- **Classes**: `PascalCase`: `UserController`, `DatabaseConnection`
- **Constants**: `UPPER_SNAKE_CASE`: `DB_HOST`, `MAX_RETRIES`
- **Properties**: `camelCase`: `$userName`, `$emailAddress`
- **Private/protected**: optional underscore prefix (legacy convention, not PSR-12 requirement): `private $_internalState` or `private $internalState`

### Structure & Style
- Follow PSR-12 (PHP Standards Recommendation)
- Indent with 4 spaces (not 2)
- Opening braces on same line: `if ($condition) {`
- Use type declarations: `public function getName(): string`
- Use strict types: `declare(strict_types=1);` at file start

### Classes & OOP
```php
<?php
declare(strict_types=1);

namespace App\Models;

class User {
    private int $id;
    private string $email;
    
    public function __construct(int $id, string $email) {
        $this->id = $id;
        $this->email = $email;
    }
    
    public function getId(): int {
        return $this->id;
    }
    
    public function isAdmin(): bool {
        return str_ends_with($this->email, '@admin.local');
    }
}
```

### Functions & Logic
- Use type hints and return types: `function add(int $a, int $b): int`
- Use null coalescing `??` and spaceship `<=>` operators
- Validate input at boundaries (user input, external APIs)
- Use exceptions for errors, not return codes
- Keep functions under 30 lines

### Strings & Arrays
- Use double quotes for interpolation: `"User: {$name}"`
- Use single quotes for plain strings: `'SELECT * FROM users'`
- Use `array_map()`, `array_filter()` for transformations
- Use spread operator for unpacking: `...$array`

### Error Handling
```php
try {
    $user = User::findById($id);
    $user->update($data);
} catch (NotFoundException $e) {
    log_error($e->getMessage());
    http_response_code(404);
} catch (Exception $e) {
    log_error('Unexpected error: ' . $e->getMessage());
    http_response_code(500);
}
```

---

## General Principles (All Languages)

### Code Quality
- **DRY** (Don't Repeat Yourself): Extract repeated patterns into functions/components
- **KISS** (Keep It Simple, Stupid): Solve the problem at hand, avoid over-engineering
- **YAGNI** (You Aren't Gonna Need It): Don't add features you don't need yet
- **Single Responsibility**: One function/class = one job


### Dependencies
- Keep dependencies as low as possible. Don't import large packages if you need only some small functionality from it. Write it yourself
- Prefer minimal, focused libraries over monolithic frameworks
- Document why each dependency is needed

### Comments & Documentation
- Code should be self-documenting; comments explain *why* decisions were made
- Document edge cases and non-obvious logic
- Update comments when code changes
- Remove commented-out code; use version control history instead

### Testing Mindset
- Write testable code: pure functions, dependency injection, separation of concerns
- Test the "happy path" and edge cases
- Use descriptive test names: `test_should_return_zero_when_list_is_empty()`

### Performance Considerations
- Avoid premature optimization; measure first
- Use appropriate algorithms and data structures
- Cache expensive operations (API calls, computations)
- Minimize DOM/database queries in loops

### Security
- Validate all external input (user, API, files)
- Use parameterized queries to prevent SQL injection
- Sanitize output for the target context (HTML, URL, JavaScript)
- Never commit secrets; use environment variables
- Keep dependencies updated

### File Naming
- **HTML**: `index.html`, `contact-form.html` (kebab-case, descriptive)
- **CSS**: `style.css`, `board-styles.css` (kebab-case)
- **JavaScript**: `main.js`, `game-logic.js` (kebab-case for scripts and modules); `GameBoard.js`, `UserCard.js` (PascalCase for class files)
- **TypeScript**: `types.ts`, `game.service.ts` (kebab-case for modules); `GameBoard.ts`, `UserCard.ts` (PascalCase for class files)
- **PHP**: `UserController.php`, `Database.php`, `Config.php` (PascalCase, one class per file)
- **Components**: `Header.vue`, `GameBoard.tsx`, `UserCard.jsx` (PascalCase)

### Line Length & Formatting
- **Maximum line length**: 100–120 characters (aim for 100, hard limit 120)
- Break long lines at logical points (after operators, before function arguments)
- Use consistent indentation: 2 spaces (HTML, CSS, JS, TS) or 4 spaces (PHP)
- Wrap long function signatures:
  ```javascript
  function veryLongFunctionName(
    parameterOne,
    parameterTwo,
    parameterThree
  ) {
    // implementation
  }
  ```
- Single line if/while/for etc statements must use braces or equivalent for language. Logic should be on next line 
 ``` 
  if (something) {
    return true;
  }
  ```

### JavaScript: Semicolons & Syntax
- **Always use semicolons** — they are required in strict mode and prevent ASI (Automatic Semicolon Insertion) bugs
- **Trailing commas**: Use in multi-line objects/arrays (comma after last item helps diffs):
  ```javascript
  const config = {
    host: 'localhost',
    port: 3000,
    ssl: true, // trailing comma
  };
  ```
- **Arrow functions**: Parentheses around single parameter are optional (`x => x * 2` or `(x) => x * 2`), prefer consistent style

### Import & Module Organization
- **Order of imports** (top to bottom):
  1. Standard library / built-ins (`fs`, `path`, `react`)
  2. Third-party packages (`lodash`, `express`, `axios`)
  3. Local/internal modules (relative paths: `../utils`, `./components`)
  4. Blank line between each section
- **Named vs default imports**: Use named imports for utilities/helpers, default imports for components/classes
  ```javascript
  // Standard
  import React from 'react';
  import { useState, useEffect } from 'react';
  
  // Third-party
  import axios from 'axios';
  import { debounce } from 'lodash';
  
  // Local
  import { GameState } from '../types';
  import GameBoard from './GameBoard';
  ```
- **Avoid circular imports**: Structure code so A imports B, but B doesn't import A
- **Use absolute imports** when available (`src/utils` instead of `../../utils`)

### Logging Best Practices
- Use **log levels** consistently:
  - `error`: Unexpected failures, exceptions
  - `warn`: Potential issues, deprecations
  - `info`: Major events (startup, shutdown, deployments)
  - `debug`: Detailed state, variable values (dev/testing only)
- **Never log sensitive data**: passwords, tokens, API keys, PII
- **Structured logging**: Include context for debugging
  ```javascript
  // Bad
  console.log('Error occurred');
  
  // Good
  console.error('Failed to fetch user', { userId: 123, error: err.message });
  ```
- **Remove debug logs before committing** (or make them conditional on debug flag)
- **Use logging library** in production (Winston, Pino, Bunyan) instead of `console.log()`

### Environment Configuration
- **Structure**: Use `.env` for secrets/sensitive config, commit a `.env.example` with placeholder values
- **Naming**: `UPPER_SNAKE_CASE` for all env vars (`DATABASE_URL`, `API_KEY`, `NODE_ENV`)
- **Never hardcode**: Configuration should come from env vars, not source code
- **Environment-specific files**:
  - `.env` (local development, don't commit)
  - `.env.example` (template, commit to repo)
  - `.env.production` (production config, commit without secrets)
- **Access pattern**:
  ```javascript
  // JavaScript
  const dbUrl = process.env.DATABASE_URL || 'localhost:5432';
  
  // PHP
  $dbUrl = $_ENV['DATABASE_URL'] ?? 'localhost:5432';
  ```
- **Validation**: Validate env vars on startup, fail fast if required vars are missing

---

## Checklist Before Committing

- [ ] Code follows conventions in this guide
- [ ] Functions are under 50 lines (JS) / 30 lines (PHP)
- [ ] Classes are under 300 lines
- [ ] Variable names are clear and descriptive
- [ ] Comments explain *why*, not *what*
- [ ] No commented-out code left behind
- [ ] No `console.log()`, `var_dump()`, or debug output
- [ ] No hardcoded secrets or credentials
- [ ] Tests pass (if applicable)
- [ ] Code is DRY—no unnecessary duplication

---

**Last Updated**: 2026-04-16  
**Version**: 1.0
