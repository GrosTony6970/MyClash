import { describe, expect, it } from 'vitest';
import { describeCallback, isClaudeCallback, redirectsToClaude } from './claude-callbacks';

describe('isClaudeCallback', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'http://localhost:1/callback',
    'http://localhost:53682/callback',
    'http://localhost:65535/callback',
    'http://127.0.0.1:1/callback',
    'http://127.0.0.1:53682/callback',
    'http://127.0.0.1:65535/callback',
  ])('lets %s through', (uri) => {
    expect(isClaudeCallback(uri)).toBe(true);
  });

  it.each([
    'https://claude.ai/api/mcp/auth_callback?x=1',
    'https://claude.ai/api/mcp/auth_callback?',
    'https://claude.ai/api/mcp/auth_callback#x',
    'https://claude.ai/api/mcp/auth_callback/',
    'https://claude.ai@evil.example/api/mcp/auth_callback',
    'https://user@claude.ai/api/mcp/auth_callback',
    'https://evil.claude.ai/api/mcp/auth_callback',
    'https://claude.ai.evil.example/api/mcp/auth_callback',
    'http://claude.ai/api/mcp/auth_callback',
    'https://claude.ai:8443/api/mcp/auth_callback',
    'https://CLAUDE.AI/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/x/../auth_callback',
    'http://localhost:0/callback',
    'http://localhost/callback',
    'http://localhost:08080/callback',
    'http://localhost:65536/callback',
    'http://localhost:8080/callback/x',
    'http://localhost:8080/callback?x=1',
    'https://localhost:8080/callback',
    'http://192.168.1.2:80/callback',
    'http://127.0.0.2:8080/callback',
    'not a url',
    '',
  ])('refuses %s', (uri) => {
    expect(isClaudeCallback(uri)).toBe(false);
  });
});

describe('describeCallback', () => {
  it('names where each callback goes back to', () => {
    expect(describeCallback('https://claude.com/api/mcp/auth_callback')).toBe('claude');
    expect(describeCallback('http://127.0.0.1:53682/callback')).toBe('this-computer');
    expect(describeCallback('https://evil.example/cb')).toBeNull();
  });
});

describe('redirectsToClaude', () => {
  it("lets GoTrue's answer through to a Claude callback, with its code and state", () => {
    expect(redirectsToClaude('https://claude.ai/api/mcp/auth_callback?code=c&state=s')).toBe(true);
    expect(redirectsToClaude('http://localhost:53682/callback?error=access_denied')).toBe(true);
  });

  it.each([
    'https://evil.example/cb?code=x',
    'https://claude.ai@evil.example/api/mcp/auth_callback?code=x',
    'https://claude.ai/api/mcp/auth_callback/?code=x',
    'https://claude.ai/api/mcp/auth_callback?code=x#frag',
    'https://claude.ai/api/mcp/auth_callback?code=x#',
    'not a url',
  ])('refuses %s', (url) => {
    expect(redirectsToClaude(url)).toBe(false);
  });
});
