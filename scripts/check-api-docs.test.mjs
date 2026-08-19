import assert from 'node:assert/strict';
import test from 'node:test';

import { findApiDocGaps, scanControllers } from './check-api-docs.mjs';

const controller = (...lines) => lines.join('\n');

test('a controller with no @ApiTags is reported once for the file', () => {
  const source = controller('@Controller("x")', 'export class XController {', '}');

  assert.deepEqual(findApiDocGaps(source, 'x.controller.ts'), [
    'x.controller.ts: missing @ApiTags',
  ]);
});

test('an HTTP route with no @ApiOperation is reported with its line', () => {
  const source = controller(
    '@ApiTags("x")',
    '@Controller("x")',
    'export class XController {',
    '  @Get()',
    '  list() {}',
    '}',
  );

  assert.deepEqual(findApiDocGaps(source, 'x.controller.ts'), [
    'x.controller.ts:4: @Get() missing @ApiOperation',
  ]);
});

test('@ApiOperation counts whether it sits above or below the HTTP decorator', () => {
  const below = controller('@ApiTags("x")', '  @Get()', '  @ApiOperation({})', '  list() {}');
  const above = controller('@ApiTags("x")', '  @ApiOperation({})', '  @Get()', '  list() {}');

  assert.deepEqual(findApiDocGaps(below, 'x.controller.ts'), []);
  assert.deepEqual(findApiDocGaps(above, 'x.controller.ts'), []);
});

test('an @ApiOperation on the NEXT method does not cover this one', () => {
  // The forward scan stops at a method signature. Without that it would walk on
  // into the next route's decorators and call every route documented.
  const source = controller(
    '@ApiTags("x")',
    '  @Get()',
    '  list() {}',
    '',
    '  @ApiOperation({})',
    '  @Post()',
    '  create() {}',
  );

  assert.deepEqual(findApiDocGaps(source, 'x.controller.ts'), [
    'x.controller.ts:2: @Get() missing @ApiOperation',
  ]);
});

test('an @ApiOperation on the PREVIOUS method does not cover this one either', () => {
  // The backward scan walks past blanks, other decorators and comments, then
  // stops at the first line that is none of those — here the closing brace.
  const source = controller(
    '@ApiTags("x")',
    '  @ApiOperation({})',
    '  @Get()',
    '  list() {}',
    '',
    '  @Post()',
    '  create() {}',
  );

  assert.deepEqual(findApiDocGaps(source, 'x.controller.ts'), [
    'x.controller.ts:6: @Post() missing @ApiOperation',
  ]);
});

test('every HTTP verb is checked, not only @Get', () => {
  const source = controller(
    '@ApiTags("x")',
    '  @Post()',
    '  a() {}',
    '  @Put()',
    '  b() {}',
    '  @Patch()',
    '  c() {}',
    '  @Delete()',
    '  d() {}',
  );

  assert.equal(findApiDocGaps(source, 'x.controller.ts').length, 4);
});

test('the scan reports every controller it is given', () => {
  const read = (path) => (path === 'b.controller.ts' ? '@ApiTags("b")' : '@Controller("a")');

  assert.deepEqual(
    scanControllers(['a.controller.ts', 'b.controller.ts'], read, (path) => path),
    ['a.controller.ts: missing @ApiTags'],
  );
});
