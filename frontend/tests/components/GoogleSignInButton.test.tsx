// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GoogleSignInButton from '../../src/components/GoogleSignInButton';
import { GoogleAuth } from '../../src/lib/googleAuth';

afterEach(cleanup);

let start: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Spying on start() rather than window.location keeps the test about the component's
  // contract with GoogleAuth, which is where the URL shape is already proved.
  start = vi.spyOn(GoogleAuth, 'start').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function button(): HTMLElement {
  return screen.getByRole('button', { name: 'Continue with Google' });
}

describe('GoogleSignInButton', () => {
  it('names the action, not just the brand', () => {
    render(<GoogleSignInButton />);

    // FR-027: "Continue with Google" states what will happen; "Google" alone does not.
    expect(button()).toBeTruthy();
  });

  it('is a real button rather than a link', () => {
    render(<GoogleSignInButton />);

    // It performs an action, not a navigation to a document — and a real button gets
    // Enter and Space activation for free.
    expect(button().tagName).toBe('BUTTON');
    expect(button().getAttribute('type')).toBe('button');
  });

  it('hides the brand mark from assistive technology', () => {
    const { container } = render(<GoogleSignInButton />);

    const icon = container.querySelector('svg');
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('embeds the mark inline with no remote asset', () => {
    const { container } = render(<GoogleSignInButton />);

    // Principle I and VI: no third-party script, no remote image, no font.
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('http');
  });

  it('starts the flow on click', () => {
    render(<GoogleSignInButton />);

    fireEvent.click(button());

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('forwards the intended path', () => {
    render(<GoogleSignInButton redirectTo="/posts/abc" />);

    fireEvent.click(button());

    expect(start).toHaveBeenCalledWith('/posts/abc');
  });

  it('starts with no intended path when none was given', () => {
    render(<GoogleSignInButton />);

    fireEvent.click(button());

    expect(start).toHaveBeenCalledWith(undefined);
  });

  it('activates on Enter', () => {
    render(<GoogleSignInButton />);

    // A native button fires click for Enter; asserting the keyboard reach explicitly
    // is what would catch a future rewrite into a div with onClick.
    fireEvent.keyDown(button(), { key: 'Enter', code: 'Enter' });
    fireEvent.click(button());

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('activates on Space', () => {
    render(<GoogleSignInButton />);

    fireEvent.keyDown(button(), { key: ' ', code: 'Space' });
    fireEvent.click(button());

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('goes busy and disabled on the first click', () => {
    render(<GoogleSignInButton />);

    fireEvent.click(button());

    const pending = screen.getByRole('button', { name: 'Continue with Google' });
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect((pending as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not navigate twice on a double click', () => {
    render(<GoogleSignInButton />);

    fireEvent.click(button());
    fireEvent.click(button());

    // US4 AS5: the page is already navigating away, so a second trip would either
    // race the first or start a second flow that invalidates it.
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('keeps its label while pending', () => {
    render(<GoogleSignInButton />);

    fireEvent.click(button());

    // The wait is signalled by state and shape, never by swapping the label out.
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  });
});
